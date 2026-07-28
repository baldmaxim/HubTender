import type {
  BoqItemFull,
  BoqItemType,
  CurrencyType,
  DeliveryPriceType,
  MaterialType,
} from '../../../lib/types';

/**
 * Точечный PATCH /api/v1/items/{id} для телефонного per-field редактора.
 *
 * Присутствующий ключ = запишется; отсутствующий = поле не меняется. НИКОГДА не
 * строить spread'ом состояния формы: undefined и null означают РАЗНОЕ (бэкенд
 * различает absent / null / value у шести tri-state полей, см. boq_write.go
 * updateBoqItemReq + repository/nullable.go OptionalNullable).
 *
 * total_amount здесь ОТСУТСТВУЕТ намеренно: его нет в updateBoqItemReq, сервер
 * пересчитывает сам на каждом touched-патче (boq_mutate.go), а присланное молча
 * дропает. Попытка положить ключ сюда = ошибка компиляции.
 */
export interface BoqItemFieldPatch {
  // Плоские *T на бэке: absent = не менять. Прислать null НЕЛЬЗЯ (колонка не
  // очищается через них) — поэтому в типе нет `| null`.
  boq_item_type?: BoqItemType;
  material_type?: MaterialType;
  unit_code?: string;
  quantity?: number;
  unit_rate?: number;
  currency_type?: CurrencyType;
  delivery_price_type?: DeliveryPriceType;
  delivery_amount?: number;
  consumption_coefficient?: number;
  quote_link?: string;
  description?: string;

  // Tri-state (OptionalNullable): null = ЯВНАЯ очистка колонки.
  base_quantity?: number | null;
  conversion_coefficient?: number | null;
  detail_cost_category_id?: string | null;
  material_name_id?: string | null;
  work_name_id?: string | null;
  parent_work_item_id?: string | null;
}

/** Ключи, у которых в листе есть карандаш. Расчётные (total_amount, unit_code,
 *  quantity привязанного материала) сюда не входят — они read-only. */
export type EditableFieldKey =
  | 'boq_item_type'
  | 'material_type'
  | 'work_name_id'
  | 'material_name_id'
  | 'parent_work_item_id'
  | 'conversion_coefficient'
  | 'consumption_coefficient'
  | 'quantity'
  | 'unit_rate'
  | 'currency_type'
  | 'delivery_price_type'
  | 'delivery_amount'
  | 'detail_cost_category_id'
  | 'quote_link'
  | 'description';

/** Выбранная опция номенклатуры (AutoComplete отдаёт id + единицу измерения). */
export interface NameOptionDraft {
  id: string;
  unit?: string | null;
}

export interface FieldPatchCtx {
  /** ЖИВАЯ запись из items (не снапшот) — иначе companion'ы считаются от протухших данных. */
  item: BoqItemFull;
  /** Работы этой позиции (кандидаты в родители). */
  workItems: BoqItemFull[];
  /** Справочник единиц — FK-guard для unit_code. */
  units: { code: string }[];
  /** Кол-во ГП позиции (база для непривязанного материала). */
  gpVolume: number;
  /** У работы есть привязанные материалы → после правки Кол-ва нужен recompute. */
  hasChildren: boolean;
  /** Курсы тендера — валюта без курса не даёт сохранить (сервер вернёт 400). */
  currencyRates: { usd: number; eur: number; cny: number };
}

export type BuildResult =
  | { ok: true; patch: BoqItemFieldPatch; recomputeWorkId?: string }
  | { ok: false; error: string };

const WORK_TYPES: BoqItemType[] = ['раб', 'суб-раб', 'раб-комп.'];

export const isWorkItemType = (t: BoqItemType): boolean => WORK_TYPES.includes(t);

export const getCurrencyRate = (
  currency: CurrencyType,
  rates: { usd: number; eur: number; cny: number },
): number => {
  switch (currency) {
    case 'USD':
      return rates.usd;
    case 'EUR':
      return rates.eur;
    case 'CNY':
      return rates.cny;
    default:
      return 1;
  }
};

/** Материал привязан к работе. Определяет и математику, и состав полей листа. */
export const isLinked = (item: BoqItemFull): boolean => !!item.parent_work_item_id;

// ─── Валидация ───────────────────────────────────────────────────────────────

/**
 * Возвращает текст ошибки либо null. Кнопка «Сохранить» у поля disabled, пока
 * не null → невалидное значение физически не уходит на сервер. DB CHECK и 400 —
 * второй рубеж, а не основной UX.
 */
/**
 * Пустой InputNumber отдаёт NaN (parser: parseFloat('')), а ЛЮБОЕ сравнение с NaN
 * даёт false — поэтому проверки вида `v < 1` его пропускали, и в патч уходил NaN
 * (JSON сериализует его в null). Число обязано быть конечным.
 */
const notFinite = (v: unknown): v is null => typeof v !== 'number' || !Number.isFinite(v);

export function validateField(
  key: EditableFieldKey,
  draft: unknown,
  ctx: FieldPatchCtx,
): string | null {
  switch (key) {
    case 'quantity': {
      const q = draft as number | null;
      // БД строже бэкенда: boq_items_quantity_positive требует > 0, а validator
      // на gte=0 c omitempty пропускает 0 вовсе.
      if (notFinite(q) || q <= 0) return 'Количество должно быть больше 0';
      return null;
    }
    case 'unit_rate':
    case 'delivery_amount': {
      const v = draft as number | null;
      if (notFinite(v) || v < 0) return 'Введите число не менее 0';
      return null;
    }
    case 'consumption_coefficient': {
      const v = draft as number | null;
      if (notFinite(v) || v < 1) return 'Значение коэффициента расхода не может быть менее 1,00';
      return null;
    }
    case 'conversion_coefficient': {
      const v = draft as number | null;
      if (notFinite(v) || v <= 0) return 'Коэффициент перевода должен быть больше 0';
      return null;
    }
    case 'work_name_id':
    case 'material_name_id': {
      const opt = draft as NameOptionDraft | null;
      if (!opt?.id) return 'Выберите наименование из списка';
      return null;
    }
    case 'detail_cost_category_id': {
      const v = draft as string | null;
      // Паритет с десктопом (WorkEditForm / useMaterialEditForm требуют затрату):
      // иначе телефон плодит строки, которые десктопная форма не сохранит.
      if (!v) return 'Выберите затрату на строительство';
      return null;
    }
    case 'currency_type': {
      const c = draft as CurrencyType;
      if (getCurrencyRate(c, ctx.currencyRates) <= 0) return 'Курс валюты не задан в тендере';
      return null;
    }
    case 'parent_work_item_id': {
      const next = draft as string | null;
      if (!next) {
        // Отвязка: quantity станет gpVolume, а CHECK требует > 0.
        if (!ctx.gpVolume || ctx.gpVolume <= 0) return 'Введите количество ГП';
        return null;
      }
      const w = ctx.workItems.find((x) => x.id === next);
      if (!w) return 'Работа не найдена';
      // Иначе recompute запишет детям quantity = 0 → boq_items_quantity_positive → 500.
      if (!w.quantity || w.quantity <= 0) return 'У работы не задано количество';
      return null;
    }
    default:
      return null;
  }
}

// ─── Сборка патча ────────────────────────────────────────────────────────────

/** unit_code — плоский *string: null = тихий no-op, а несуществующий код роняет
 *  boq_items_unit_code_fkey. Поэтому пишем только валидный непустой код. */
function unitCodePatch(unit: string | null | undefined, ctx: FieldPatchCtx): { unit_code?: string } {
  const u = unit?.trim();
  if (!u) return {};
  return ctx.units.some((x) => x.code === u) ? { unit_code: u } : {};
}

/**
 * Чистая функция: switch по тронутому ключу, каждый case возвращает СВЕЖИЙ
 * литерал только с тронутым полем и его companion'ами. Спреда состояния формы
 * здесь нет и быть не должно.
 */
export function buildFieldPatch(
  key: EditableFieldKey,
  draft: unknown,
  ctx: FieldPatchCtx,
): BuildResult {
  const invalid = validateField(key, draft, ctx);
  if (invalid) return { ok: false, error: invalid };

  const { item } = ctx;
  const linked = isLinked(item);

  switch (key) {
    case 'boq_item_type':
      return { ok: true, patch: { boq_item_type: draft as BoqItemType } };

    case 'material_type':
      return { ok: true, patch: { material_type: draft as MaterialType } };

    case 'work_name_id': {
      const opt = draft as NameOptionDraft;
      return { ok: true, patch: { work_name_id: opt.id, ...unitCodePatch(opt.unit, ctx) } };
    }

    case 'material_name_id': {
      const opt = draft as NameOptionDraft;
      return { ok: true, patch: { material_name_id: opt.id, ...unitCodePatch(opt.unit, ctx) } };
    }

    case 'quantity': {
      const q = draft as number;
      if (isWorkItemType(item.boq_item_type)) {
        // Кол-во работы: детей пересчитает сервер, свежим родителем под FOR UPDATE.
        return {
          ok: true,
          patch: { quantity: q },
          recomputeWorkId: ctx.hasChildren ? item.id : undefined,
        };
      }
      // Кол-во непривязанного материала (у привязанного карандаша нет — это
      // выход формулы). base_quantity идёт следом: порт useMaterialEditForm.
      return { ok: true, patch: { quantity: q, base_quantity: q } };
    }

    case 'conversion_coefficient':
      // Строка рендерится только у привязанного материала.
      return {
        ok: true,
        patch: { conversion_coefficient: draft as number },
        recomputeWorkId: item.parent_work_item_id ?? undefined,
      };

    case 'consumption_coefficient': {
      const cons = draft as number;
      if (!linked) {
        // У НЕпривязанного К расх бьёт по ИТОГУ, а не по количеству (сервер форсит
        // consumption = 1 при parent != null). Companion quantity был бы БАГОМ.
        return { ok: true, patch: { consumption_coefficient: cons } };
      }
      return {
        ok: true,
        patch: { consumption_coefficient: cons },
        recomputeWorkId: item.parent_work_item_id ?? undefined,
      };
    }

    case 'parent_work_item_id': {
      const next = (draft as string | null) || null;
      if (!next) {
        // Отвязка: комбинация полей должна стать валидной для standalone-материала.
        return {
          ok: true,
          patch: {
            parent_work_item_id: null,
            conversion_coefficient: null,
            base_quantity: ctx.gpVolume,
            quantity: ctx.gpVolume,
          },
        };
      }
      // Привязка. quantity НЕ шлём — его посчитает recomputeLinkedMaterials из
      // свежего родителя. conversion_coefficient никогда не null: CHECK требует
      // > 0 либо NULL, а validateTriState отвергает <= 0.
      return {
        ok: true,
        patch: {
          parent_work_item_id: next,
          conversion_coefficient: item.conversion_coefficient ?? 1,
          base_quantity: null,
        },
        recomputeWorkId: next,
      };
    }

    case 'unit_rate':
      return { ok: true, patch: { unit_rate: draft as number } };

    case 'currency_type':
      return { ok: true, patch: { currency_type: draft as CurrencyType } };

    case 'delivery_price_type': {
      // boq_items_delivery_amount_check — кросс-полевой: раздельные карандаши
      // физически дают 500. Значение 100 при «суммой» — паритет с десктопом.
      const t = draft as DeliveryPriceType;
      return {
        ok: true,
        patch: { delivery_price_type: t, delivery_amount: t === 'суммой' ? 100 : 0 },
      };
    }

    case 'delivery_amount':
      return { ok: true, patch: { delivery_amount: draft as number } };

    case 'detail_cost_category_id':
      return { ok: true, patch: { detail_cost_category_id: draft as string } };

    case 'quote_link':
      // Патч ТОЛЬКО с quote_link попадает под isQuoteMetadataOnlyPatch на бэке и
      // не двигает ревизию / не снимает approval — не группировать ни с чем.
      return { ok: true, patch: { quote_link: (draft as string) ?? '' } };

    case 'description':
      return { ok: true, patch: { description: (draft as string) ?? '' } };

    default: {
      const exhaustive: never = key;
      return { ok: false, error: `Неизвестное поле: ${String(exhaustive)}` };
    }
  }
}
