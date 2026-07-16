// Этап 2.6: pure-хелперы controlled rollout (Smart Import pilot UI +
// админ-вкладка «Контролируемый запуск»). Без сети/side effects — всё
// проверяется focused-тестами (scripts/checks/aiRolloutFrontendPolicy.check.mjs).
import type {
  AiCapabilityView,
  AiCircuitState,
  AiGateCheck,
  AiRolloutView,
} from '../api/adminAi';
import type { Tone } from './openRouterAdminPolicy';

// ── Rollout modes ────────────────────────────────────────────────────────────

/** Отображение режимов. Режима general availability НЕ существует. */
export const ROLLOUT_MODE_LABELS: Record<string, string> = {
  off: 'Выключен',
  evaluation: 'Evaluation (только админ)',
  pilot_individual: 'Пилот: одиночные подтверждения',
  pilot_bulk: 'Пилот: + bulk-подтверждение',
};

/** Разрешённые следующие переходы (зеркало server state machine, §4). */
export function nextTransitionTargets(mode: AiRolloutView['rollout_mode']): string[] {
  switch (mode) {
    case 'off':
      return ['evaluation'];
    case 'evaluation':
      return ['pilot_individual', 'off'];
    case 'pilot_individual':
      return ['pilot_bulk', 'off'];
    case 'pilot_bulk':
      return ['off'];
    default:
      return ['off'];
  }
}

export function rolloutModeDisplay(mode: string): { tone: Tone; text: string } {
  switch (mode) {
    case 'off':
      return { tone: 'info', text: ROLLOUT_MODE_LABELS.off };
    case 'evaluation':
      return { tone: 'warning', text: ROLLOUT_MODE_LABELS.evaluation };
    case 'pilot_individual':
      return { tone: 'success', text: ROLLOUT_MODE_LABELS.pilot_individual };
    case 'pilot_bulk':
      return { tone: 'success', text: ROLLOUT_MODE_LABELS.pilot_bulk };
    default:
      return { tone: 'error', text: mode };
  }
}

/** Checklist гейтов: все пройдены? */
export function allGatesPassed(gates: AiGateCheck[] | undefined | null): boolean {
  if (!gates || gates.length === 0) return false;
  return gates.every((g) => g.passed);
}

// ── Capability → Smart Import pilot UI (§19) ────────────────────────────────

export const PILOT_DISCLOSURE_TEXT =
  'Пилот AI-подбора: предложение никогда не выбирается автоматически и требует вашего подтверждения. ' +
  'Подтверждения пользователей — прокси-сигнал качества, а не доказанная точность.';

const CAPABILITY_TEXT: Record<string, { tone: Tone; text: string }> = {
  rollout_off: { tone: 'info', text: 'AI-подбор выключен. Доступны детерминированные кандидаты и ручной выбор.' },
  evaluation_only: { tone: 'info', text: 'Идёт evaluation: AI доступен только администратору.' },
  not_allowed: { tone: 'info', text: 'Вы не входите в пилотную группу AI-подбора. Ручной путь полностью доступен.' },
  available: { tone: 'success', text: 'AI-подбор доступен (пилот).' },
  user_quota_exhausted: { tone: 'warning', text: 'Дневной лимит AI-запросов исчерпан. Ручной путь доступен.' },
  row_quota_exhausted: { tone: 'warning', text: 'Дневной лимит строк AI-подбора исчерпан. Ручной путь доступен.' },
  budget_exhausted: { tone: 'warning', text: 'Месячный бюджет AI исчерпан. Ручной путь доступен.' },
  key_limit_exhausted: { tone: 'warning', text: 'Лимит ключа OpenRouter исчерпан. Ручной путь доступен.' },
  circuit_open: { tone: 'warning', text: 'AI временно отключён из-за сбоев провайдера (circuit breaker). Ручной путь доступен.' },
  provider_unavailable: { tone: 'warning', text: 'Провайдер AI недоступен. Ручной путь доступен.' },
  rate_limited: { tone: 'warning', text: 'Провайдер ограничил частоту запросов. Повторите позже; ручной путь доступен.' },
};

export function capabilityDisplay(cap: Pick<AiCapabilityView, 'status'> | null | undefined): {
  tone: Tone;
  text: string;
} {
  if (!cap) return CAPABILITY_TEXT.rollout_off;
  return CAPABILITY_TEXT[cap.status] ?? { tone: 'warning', text: cap.status };
}

/** Кнопка «Подобрать номенклатуру» с live AI: только available-пилоту. */
export function aiSuggestEnabled(cap: AiCapabilityView | null | undefined): boolean {
  return !!cap && cap.is_pilot && cap.individual_suggestions_allowed && cap.status === 'available';
}

/** Bulk-подтверждение: только pilot_bulk + личное разрешение (§19). */
export function bulkConfirmVisible(cap: AiCapabilityView | null | undefined): boolean {
  return !!cap && cap.rollout_mode === 'pilot_bulk' && cap.bulk_confirmation_allowed;
}

/** Счётчики остатка для пилота. */
export function quotaLine(cap: AiCapabilityView | null | undefined): string {
  if (!cap || !cap.is_pilot) return '';
  return `Осталось сегодня: ${cap.requests_remaining_today} запрос(ов), ${cap.rows_remaining_today} строк(и)`;
}

/** Безопасная подпись модели для пилота. */
export function pilotModelLabel(cap: AiCapabilityView | null | undefined): string {
  if (!cap || !cap.model_label) return '';
  return `Модель: ${cap.model_label}`;
}

// ── Стоимость/единицы (§8) ───────────────────────────────────────────────────

export const AI_COST_UNIT_LABEL = 'USD (кредиты OpenRouter)';

/** Decimal-строка стоимости → отображение без NaN; '' → «—». */
export function formatCost(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v || v === 'NaN' || v === 'Infinity' || v === '-Infinity') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `$${v}`;
}

// ── Circuit (§10) ────────────────────────────────────────────────────────────

export function circuitDisplay(c: AiCircuitState | null | undefined): { tone: Tone; text: string } {
  switch (c?.state) {
    case 'closed':
      return { tone: 'success', text: 'Circuit: closed (провайдер здоров)' };
    case 'half_open':
      return { tone: 'warning', text: 'Circuit: half-open (пробный запрос)' };
    case 'open': {
      const until = c.open_until ? new Date(c.open_until).toLocaleTimeString('ru-RU') : '';
      return { tone: 'error', text: `Circuit: open — AI-вызовы приостановлены${until ? ` до ${until}` : ''}` };
    }
    default:
      return { tone: 'info', text: 'Circuit: неизвестно' };
  }
}

// ── Emergency off (§11) ──────────────────────────────────────────────────────

export const EMERGENCY_OFF_LABEL = 'Экстренно отключить AI-подбор';
export const EMERGENCY_OFF_CONFIRM =
  'AI-подбор будет немедленно выключен для всех. Настройки, evaluation и учёт сохранятся; ' +
  'детерминированный и ручной импорт продолжат работать. Продолжить?';

// ── Feedback outcomes (§13) ──────────────────────────────────────────────────

export const FEEDBACK_OUTCOME_LABELS: Record<string, string> = {
  accepted: 'Принято (рекомендация подтверждена)',
  changed: 'Изменено (выбран другой вариант)',
  manual: 'Ручной выбор (AI не дал варианта)',
  abstained: 'AI воздержался',
  unresolved: 'Строка не разрешена',
};

/** Метрики пилота называются честно: acceptance ≠ доказанная accuracy. */
export const ACCEPTANCE_IS_PROXY_TEXT =
  'Подтверждение пользователя — прокси-сигнал качества (recommendation acceptance rate), не математически доказанная точность.';

/** High-confidence change-rate для гейта pilot_bulk (≤ 2%). */
export function highConfChangeRate(changed: number, total: number): number | null {
  if (!Number.isFinite(changed) || !Number.isFinite(total) || total <= 0) return null;
  return changed / total;
}

export function bulkGateByChangeRate(changed: number, total: number): boolean {
  const rate = highConfChangeRate(changed, total);
  return rate !== null && rate <= 0.02;
}
