// Общая построчная валидация импорта BOQ — используется обоими путями импорта
// (single-position: PositionItems, и mass: ClientPositions).
//
// Источники правил:
//  • CHECK-ограничения runtime-БД (Yandex, db/yandex/sql/06_indexes_constraints.sql):
//    quantity / base_quantity / consumption_coefficient / conversion_coefficient —
//    «IS NULL OR > 0». То есть ноль/отрицательное запрещены, NULL допустим.
//  • Бизнес-правило карточки материала (MaterialEditForm): коэффициент расхода
//    не может быть менее 1,00.
//
// Severity:
//  • 'error'   — блокирует импорт: количество ≤ 0 / отсутствует (для работ и
//    непривязанных материалов), расход < 1, перевод ≤ 0. Эти строки БД отвергнет
//    или они дают заведомо неверный расчёт.
//  • 'warning' — НЕ блокирует, но показывается пользователю: коэффициент не указан
//    (БД допускает NULL, расчёт примет его за 1,00) — чтобы «отсутствует» было видно.

const MATERIAL_TYPES = ['мат', 'суб-мат', 'мат-комп.'];

export type BoqRowSeverity = 'error' | 'warning';

export interface BoqRowIssue {
  field: string;
  message: string;
  severity: BoqRowSeverity;
}

// Минимальная форма строки, общая для обоих ParsedBoqItem.
export interface BoqRowForValidation {
  boq_item_type: string;
  bindToWork?: boolean;
  base_quantity?: number;
  quantity?: number;
  consumption_coefficient?: number;
  conversion_coefficient?: number;
}

const isAbsent = (v: number | undefined | null): boolean => v === undefined || v === null;

/**
 * Проверяет одну строку BOQ на корректность количества и коэффициентов.
 * Возвращает список нарушений с severity (пустой — если всё в порядке).
 */
export function validateBoqRowBasics(item: BoqRowForValidation): BoqRowIssue[] {
  const issues: BoqRowIssue[] = [];
  const isMat = MATERIAL_TYPES.includes(item.boq_item_type);
  // Привязанный к работе материал: его количество вычисляется из работы и
  // коэффициентов, поэтому собственное «количество» у него не проверяем.
  const boundMaterial = isMat && item.bindToWork === true;

  // Количество > 0 — для работ и непривязанных материалов (введённое значение).
  if (!boundMaterial) {
    const qty = item.base_quantity ?? item.quantity;
    if (isAbsent(qty) || (qty as number) <= 0) {
      issues.push({ field: 'quantity', message: 'количество должно быть больше нуля', severity: 'error' });
    }
  }

  if (isMat) {
    // Коэффициент расхода: отсутствие — предупреждение (примем за 1,00);
    // явное значение < 1 — ошибка (как в карточке материала).
    const cons = item.consumption_coefficient;
    if (isAbsent(cons)) {
      issues.push({ field: 'consumption_coefficient', message: 'коэффициент расхода не указан — будет принят за 1,00', severity: 'warning' });
    } else if ((cons as number) < 1) {
      issues.push({ field: 'consumption_coefficient', message: 'коэффициент расхода не может быть менее 1,00', severity: 'error' });
    }

    // Коэффициент перевода (только у привязанного материала): отсутствие —
    // предупреждение (примем за 1,00); явный ноль/отрицательное — ошибка.
    if (boundMaterial) {
      const conv = item.conversion_coefficient;
      if (isAbsent(conv)) {
        issues.push({ field: 'conversion_coefficient', message: 'коэффициент перевода не указан — будет принят за 1,00', severity: 'warning' });
      } else if ((conv as number) <= 0) {
        issues.push({ field: 'conversion_coefficient', message: 'коэффициент перевода должен быть больше нуля', severity: 'error' });
      }
    }
  }

  return issues;
}
