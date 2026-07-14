// Stage 0.1.2.3b.1 — ЕДИНАЯ политика потребления redistribution-статусов для
// Commerce, FinancialIndicators, CostRedistribution и всех exports. Consumers
// не пишут собственные if-ветки по status и НИКОГДА не различают состояния по
// тексту сообщения — только по status/reason.
//
// Семантика:
//  - calculated: server prepared rows/summary авторитетны; экспорт final
//    redistributed values разрешён.
//  - not_configured: перераспределение не задано; базовые commercial values
//    можно показывать ТОЛЬКО как базовые (не как результат перераспределения);
//    redistribution-specific export недоступен, общий base-export допустим.
//  - requires_recalculation: snapshot существует, но устарел/неполон/legacy;
//    final values недоступны («—»), база НЕ подставляется как final, любой
//    export с final redistributed values блокируется. Никакого fallback на
//    preview или live/base как final.

export type RedistributionStatus =
  | 'calculated'
  | 'requires_recalculation'
  | 'not_configured';

export type RedistributionReason =
  | 'LEGACY_SNAPSHOT'
  | 'SNAPSHOT_SET_MISMATCH'
  | 'PREPARED_INPUT_CHANGED'
  | 'INSURANCE_ALLOCATION_INVALID'
  | 'PREPARED_CALCULATION_FAILED'
  | string;

export interface RedistributionConsumptionState {
  status: RedistributionStatus;
  // Server prepared final values применимы (rows/summary).
  finalValuesAvailable: boolean;
  // Базовые (до перераспределения) значения можно показывать — но только с
  // ролью «база», не как final.
  baseValuesVisibleAsBaseOnly: boolean;
  // Экспорт, содержащий final redistributed values.
  exportFinalAllowed: boolean;
  // Общий base-export без redistribution-итогов.
  exportBaseAllowed: boolean;
  // Inline Alert (null = не показывать).
  alert: string | null;
  // Стабильный код блокировки экспорта (null = разрешён).
  exportBlockedCode: 'REDISTRIBUTION_RECALCULATION_REQUIRED' | 'REDISTRIBUTION_NOT_CONFIGURED' | null;
}

const REASON_MESSAGES: Record<string, string> = {
  LEGACY_SNAPSHOT:
    'Сохранённый расчёт создан старой версией и требует пересчёта на сервере.',
  SNAPSHOT_SET_MISMATCH:
    'Сохранённый расчёт не соответствует текущему составу BOQ. Выполните пересчёт.',
  PREPARED_INPUT_CHANGED:
    'Входные данные перераспределения изменились. Выполните пересчёт.',
  INSURANCE_ALLOCATION_INVALID:
    'Страхование не может быть распределено для текущего состояния. Проверьте конфигурацию и выполните пересчёт.',
  PREPARED_CALCULATION_FAILED:
    'Расчёт перераспределения устарел или неполон. Выполните пересчёт.',
};

// resolveRedistributionConsumptionState — pure mapping status/reason →
// consumption policy. serverMessage (если сервер прислал) имеет приоритет над
// локальным словарём, но выбор ветки ВСЕГДА по status/reason.
export function resolveRedistributionConsumptionState(
  status: RedistributionStatus | undefined | null,
  reason?: RedistributionReason | null,
  serverMessage?: string | null,
): RedistributionConsumptionState {
  switch (status) {
    case 'calculated':
      return {
        status,
        finalValuesAvailable: true,
        baseValuesVisibleAsBaseOnly: false,
        exportFinalAllowed: true,
        exportBaseAllowed: true,
        alert: null,
        exportBlockedCode: null,
      };
    case 'requires_recalculation':
      return {
        status,
        finalValuesAvailable: false,
        baseValuesVisibleAsBaseOnly: true,
        exportFinalAllowed: false,
        exportBaseAllowed: false,
        alert:
          serverMessage ||
          (reason ? REASON_MESSAGES[reason] : undefined) ||
          'Расчёт перераспределения устарел или неполон. Выполните пересчёт.',
        exportBlockedCode: 'REDISTRIBUTION_RECALCULATION_REQUIRED',
      };
    case 'not_configured':
    default:
      // Неизвестный/отсутствующий статус трактуем как not_configured ТОЛЬКО в
      // смысле «перераспределение не задано»: база видима как база,
      // redistribution-specific export недоступен.
      return {
        status: 'not_configured',
        finalValuesAvailable: false,
        baseValuesVisibleAsBaseOnly: true,
        exportFinalAllowed: false,
        exportBaseAllowed: true,
        alert: null,
        exportBlockedCode: 'REDISTRIBUTION_NOT_CONFIGURED',
      };
  }
}
