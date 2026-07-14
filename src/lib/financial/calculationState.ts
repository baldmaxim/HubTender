// Этап 0-F2: ЕДИНАЯ политика статуса финансового расчёта тендера.
// Все страницы/кнопки (согласование, финальные Excel-экспорты, Commerce,
// FinancialIndicators, CostRedistribution) обязаны решать «можно ли доверять
// текущим суммам» ТОЛЬКО через resolveFinancialCalculationState — никакой
// собственной интерпретации status/revision в компонентах.

export type FinancialCalculationStatus = 'calculated' | 'stale' | 'calculating' | 'failed';

export interface FinancialCalculationInput {
  financial_input_revision?: number | null;
  financial_calculation_revision?: number | null;
  financial_calculation_status?: string | null;
  financial_calculated_at?: string | null;
  financial_calculation_error_code?: string | null;
  financial_calculation_error_message?: string | null;
}

export interface FinancialCalculationState {
  kind: FinancialCalculationStatus;
  /** Согласование разрешено (только calculated + совпадающие ревизии). */
  canApprove: boolean;
  /** Финальные финансовые экспорты разрешены. */
  canExportFinal: boolean;
  /** Показ сумм: true → подписывать «Последний рассчитанный итог». */
  totalsAreLastCalculated: boolean;
  /** Текст Alert для UI (null для calculated). */
  alertMessage: string | null;
  /** Тип Alert antd. */
  alertType: 'info' | 'warning' | 'error' | null;
  inputRevision: number;
  calculationRevision: number;
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * Fail-closed: неизвестный/отсутствующий статус трактуется как stale
 * (никогда как calculated), несовпадение ревизий понижает calculated до stale.
 */
export function resolveFinancialCalculationState(
  t: FinancialCalculationInput | null | undefined,
): FinancialCalculationState {
  const inputRev = t?.financial_input_revision ?? 0;
  const calcRev = t?.financial_calculation_revision ?? 0;
  const rawStatus = t?.financial_calculation_status ?? 'stale';
  const errorCode = t?.financial_calculation_error_code ?? null;
  const errorMessage = t?.financial_calculation_error_message ?? null;

  let kind: FinancialCalculationStatus;
  if (rawStatus === 'calculated' && calcRev === inputRev && !errorCode) {
    kind = 'calculated';
  } else if (rawStatus === 'calculating') {
    kind = 'calculating';
  } else if (rawStatus === 'failed') {
    kind = 'failed';
  } else {
    // stale, неизвестный статус или calculated с отставшей ревизией.
    kind = 'stale';
  }

  const base = {
    inputRevision: inputRev,
    calculationRevision: calcRev,
    errorCode,
    errorMessage,
  };

  switch (kind) {
    case 'calculated':
      return {
        ...base, kind,
        canApprove: true, canExportFinal: true, totalsAreLastCalculated: false,
        alertMessage: null, alertType: null,
      };
    case 'calculating':
      return {
        ...base, kind,
        canApprove: false, canExportFinal: false, totalsAreLastCalculated: true,
        alertMessage: 'Расчёт выполняется. Согласование и финальный экспорт будут доступны после завершения.',
        alertType: 'info',
      };
    case 'failed':
      return {
        ...base, kind,
        canApprove: false, canExportFinal: false, totalsAreLastCalculated: true,
        alertMessage: errorMessage
          ? `Расчёт завершился ошибкой: ${errorMessage}. Исправьте входные данные и повторите.`
          : 'Расчёт завершился ошибкой. Исправьте входные данные и повторите.',
        alertType: 'error',
      };
    case 'stale':
    default:
      return {
        ...base, kind,
        canApprove: false, canExportFinal: false, totalsAreLastCalculated: true,
        alertMessage: 'Данные изменены. Выполняется повторный расчёт — показан последний рассчитанный итог.',
        alertType: 'warning',
      };
  }
}

/** Подпись к сумме, когда расчёт не актуален. */
export const LAST_CALCULATED_TOTAL_LABEL = 'Последний рассчитанный итог';

/** Сообщение об автоматической отмене согласования (0-F2 §8). */
export const APPROVAL_INVALIDATED_MESSAGE =
  'Финансовое согласование отменено: расчёт изменён и требует повторной проверки.';
