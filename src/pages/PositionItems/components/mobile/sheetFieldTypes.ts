import type { BoqItemFull, MaterialName, WorkName } from '../../../../lib/types';
import type { CostCategoryOption } from '../editFormShared';
import type { EditableFieldKey, FieldPatchCtx } from '../../utils/boqFieldPatch';

/** Секции листа (разделяются `<Divider plain>`). */
export type SheetGroup = 'classification' | 'quantity' | 'other';

export const SHEET_GROUP_LABEL: Record<SheetGroup, string> = {
  classification: 'Классификация',
  quantity: 'Количество и цена',
  other: 'Прочее',
};

/** Состояние одной строки листа. */
export type FieldState = 'idle' | 'editing' | 'saving' | 'saved';

export interface SheetCtx {
  /** ЖИВАЯ запись из items — лист не держит снапшот. */
  item: BoqItemFull;
  workItems: BoqItemFull[];
  materialNames: MaterialName[];
  workNames: WorkName[];
  costCategories: CostCategoryOption[];
  units: { code: string }[];
  gpVolume: number;
  currencyRates: { usd: number; eur: number; cny: number };
  hasChildren: boolean;
  /** Ленивая догрузка справочников: пока не 'ready', ✎ у полей с needsRefs disabled. */
  editDataState: 'idle' | 'loading' | 'ready' | 'error';
}

/**
 * Описание контрола — ДАННЫЕ, а не компонент. Рендерит их один <SheetControl>
 * (switch по kind), как MaterialsEditableCell в Библиотеке. Так дескрипторы
 * остаются сериализуемыми, не плодят новую identity компонента на каждый рендер
 * и не спорят с react-refresh/only-export-components.
 */
export type SheetControlSpec =
  // Без min/max НАМЕРЕННО: rc-input-number не эмитит onChange для значений вне
  // диапазона, поэтому валидатор их не увидел бы, а поле показывало бы введённое
  // «0,5» при драфте со старым значением. Единственный гейт — validateField.
  | { kind: 'number'; precision: number }
  | { kind: 'text'; textarea?: boolean }
  | { kind: 'select'; options: Array<{ value: string; label: string }> }
  | { kind: 'currency' }
  | { kind: 'name'; source: 'work' | 'material' }
  | { kind: 'cost' }
  | { kind: 'parent' };

export interface SheetField {
  /** Уникален внутри набора; для редактируемых совпадает с ключом патча. */
  key: string;
  label: string;
  group: SheetGroup;
  /** Есть карандаш ⇔ задан. Отсутствие = расчётное/производное поле. */
  editKey?: EditableFieldKey;
  /** Полю нужны догружаемые справочники (наименования / затраты). */
  needsRefs?: boolean;
  visible?: (ctx: SheetCtx) => boolean;
  /** Значение в режиме просмотра. */
  render: (ctx: SheetCtx) => React.ReactNode;
  /** Начальный драфт при входе в редактирование. */
  toDraft?: (ctx: SheetCtx) => unknown;
  control?: SheetControlSpec;
}

/** SheetCtx → FieldPatchCtx: buildFieldPatch не знает про UI-справочники. */
export const toPatchCtx = (ctx: SheetCtx): FieldPatchCtx => ({
  item: ctx.item,
  workItems: ctx.workItems,
  units: ctx.units,
  gpVolume: ctx.gpVolume,
  hasChildren: ctx.hasChildren,
  currencyRates: ctx.currencyRates,
});

export type { EditableFieldKey };
