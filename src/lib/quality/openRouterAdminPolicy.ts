// Этап 2.5: pure-хелперы страницы AI-администрирования OpenRouter.
// Никаких сетевых вызовов/side effects: всё проверяется focused-тестами
// (scripts/checks/openRouterAdminFrontendPolicy.check.mjs).
import type {
  AiCatalogModel,
  AiCatalogView,
  AiConnectionView,
  AiKeyStatus,
  AiSettingsView,
} from '../api/adminAi';

export type Tone = 'success' | 'info' | 'warning' | 'error';

// ── Connection ───────────────────────────────────────────────────────────────

/** Отображение статуса подключения OpenRouter. Ключ здесь НЕ фигурирует. */
export function connectionStatusDisplay(view: Pick<AiConnectionView, 'connection'> | null | undefined): {
  tone: Tone;
  text: string;
} {
  switch (view?.connection) {
    case 'connected':
      return { tone: 'success', text: 'Подключение к OpenRouter подтверждено' };
    case 'not_configured':
      return {
        tone: 'warning',
        text: 'API key не настроен. Ключ задаётся как server secret OPENROUTER_API_KEY.',
      };
    case 'unauthorized':
      return { tone: 'error', text: 'OpenRouter отклонил API key (unauthorized). Проверьте ключ.' };
    case 'payment_required':
      return { tone: 'error', text: 'Недостаточно кредитов OpenRouter (payment required).' };
    case 'rate_limited':
      return { tone: 'warning', text: 'OpenRouter ограничил частоту запросов. Повторите позже.' };
    default:
      return { tone: 'warning', text: 'OpenRouter временно недоступен.' };
  }
}

/** USD-формат без NaN/Infinity: некорректные значения → «—». */
export function formatUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `$${v.toFixed(2)}`;
}

/** Строки usage/limits ключа для admin-карточки (§8). Без секретных полей. */
export function keyUsageRows(key: AiKeyStatus | null | undefined): Array<{ label: string; value: string }> {
  if (!key) return [];
  return [
    { label: 'Метка ключа', value: key.label || '—' },
    { label: 'Лимит', value: key.limit === null ? 'Без лимита' : formatUsd(key.limit) },
    { label: 'Остаток лимита', value: key.limit_remaining === null ? '—' : formatUsd(key.limit_remaining) },
    { label: 'Сброс лимита', value: key.limit_reset || '—' },
    { label: 'Расход всего', value: formatUsd(key.usage) },
    { label: 'Расход за день', value: formatUsd(key.usage_daily) },
    { label: 'Расход за неделю', value: formatUsd(key.usage_weekly) },
    { label: 'Расход за месяц', value: formatUsd(key.usage_monthly) },
    ...(key.byok_usage > 0 ? [{ label: 'BYOK-расход', value: formatUsd(key.byok_usage) }] : []),
    ...(key.is_free_tier ? [{ label: 'Тариф', value: 'Free tier' }] : []),
  ];
}

// ── Catalog ──────────────────────────────────────────────────────────────────

/** Состояние кэша каталога (§7): fresh/stale/unavailable. */
export function catalogStateDisplay(
  catalog: Pick<AiCatalogView, 'status' | 'fetched_at'> | null | undefined
): { tone: Tone; text: string } {
  if (!catalog) return { tone: 'info', text: 'Каталог моделей ещё не загружен' };
  const fetched = catalog.fetched_at ? new Date(catalog.fetched_at).toLocaleString('ru-RU') : '';
  switch (catalog.status) {
    case 'fresh':
      return { tone: 'success', text: fetched ? `Каталог обновлён: ${fetched}` : 'Каталог обновлён' };
    case 'stale':
      return {
        tone: 'warning',
        text: fetched
          ? `OpenRouter недоступен — показан кэш от ${fetched}`
          : 'OpenRouter недоступен — показан устаревший кэш',
      };
    default:
      return {
        tone: 'error',
        text: 'Каталог недоступен: OpenRouter не отвечает, кэш отсутствует. Выбор новой модели невозможен.',
      };
  }
}

/** Цена /1M токенов: server-calculated строка; пусто/мусор → «—» (без NaN). */
export function pricePerMillionDisplay(serverValue: string | null | undefined): string {
  const v = (serverValue ?? '').trim();
  if (!v || v === 'NaN' || v === 'Infinity' || v === '-Infinity') return '—';
  return `$${v}`;
}

/** Числовое значение server-цены для ФИЛЬТРОВ (не для отображения). */
function priceNumber(serverValue: string | null | undefined): number | null {
  const v = (serverValue ?? '').trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Состояние expiration (§6): дата в будущем = «истекает», без даты = ∞. */
export function expirationDisplay(expiration: string | null | undefined): {
  text: string;
  expiring: boolean;
} {
  const raw = (expiration ?? '').trim();
  if (!raw) return { text: '—', expiring: false };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { text: raw, expiring: true };
  return { text: d.toLocaleDateString('ru-RU'), expiring: true };
}

/** Пометка free-варианта (§6): показывается, но не рекомендуется. */
export const FREE_VARIANT_WARNING =
  'Не рекомендуется для production pilot: ограниченная доступность/rate limits';

export interface ModelFilters {
  search?: string;
  author?: string;
  structuredOutputsOnly?: boolean;
  minContext?: number | null;
  maxInputPricePer1M?: number | null;
  maxOutputPricePer1M?: number | null;
  testState?: 'all' | 'tested' | 'untested' | 'failed';
  selectedOnly?: boolean;
}

/** Список организаций (author) для фильтра, отсортированный. */
export function modelAuthors(models: AiCatalogModel[] | null | undefined): string[] {
  const set = new Set<string>();
  for (const m of models ?? []) {
    if (m.author) set.add(m.author);
  }
  return Array.from(set).sort();
}

/**
 * Фильтрация каталога (§6 UI). Каталог приходит уже без router/alias и
 * истёкших моделей — здесь только пользовательские фильтры.
 */
export function filterModels(
  models: AiCatalogModel[] | null | undefined,
  filters: ModelFilters,
  settings?: Pick<AiSettingsView, 'selected_model' | 'model_test'> | null
): AiCatalogModel[] {
  const search = (filters.search ?? '').trim().toLowerCase();
  const selectedId = settings?.selected_model?.id;
  const testedId = settings?.model_test?.tested_model_id ?? null;
  const testStatus = settings?.model_test?.status ?? 'required';

  return (models ?? []).filter((m) => {
    if (search) {
      const hay = `${m.name}\n${m.id}\n${m.description}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (filters.author && m.author !== filters.author) return false;
    if (filters.structuredOutputsOnly && !m.structured_outputs_indicated) return false;
    if (filters.minContext != null && filters.minContext > 0) {
      if (m.context_length === null || m.context_length < filters.minContext) return false;
    }
    if (filters.maxInputPricePer1M != null) {
      const p = priceNumber(m.price_per_1m_input_tokens);
      if (p === null || p > filters.maxInputPricePer1M) return false;
    }
    if (filters.maxOutputPricePer1M != null) {
      const p = priceNumber(m.price_per_1m_output_tokens);
      if (p === null || p > filters.maxOutputPricePer1M) return false;
    }
    if (filters.selectedOnly && m.id !== selectedId) return false;
    switch (filters.testState) {
      case 'tested':
        if (!(m.id === testedId && testStatus === 'passed')) return false;
        break;
      case 'failed':
        if (!(m.id === testedId && testStatus === 'failed')) return false;
        break;
      case 'untested':
        if (m.id === testedId && testStatus !== 'required') return false;
        break;
      default:
        break;
    }
    return true;
  });
}

/** Стабильная сортировка каталога: по организации, затем по имени, затем ID. */
export function sortModels(models: AiCatalogModel[]): AiCatalogModel[] {
  return [...models].sort((a, b) => {
    if (a.author !== b.author) return a.author < b.author ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ── Test / activation ────────────────────────────────────────────────────────

/** Отображение статуса HUBTender-теста модели. */
export function testStatusDisplay(
  test: Pick<AiSettingsView['model_test'], 'status' | 'error_code'> | null | undefined
): { tone: Tone; text: string } {
  switch (test?.status) {
    case 'passed':
      return { tone: 'success', text: 'Проверка модели пройдена' };
    case 'failed':
      return {
        tone: 'error',
        text: test.error_code
          ? `Проверка модели провалена (${test.error_code})`
          : 'Проверка модели провалена',
      };
    default:
      return { tone: 'warning', text: 'Требуется проверка модели' };
  }
}

/** Русские причины блокировки активации (server-authoritative список). */
const BLOCKER_LABELS: Record<string, string> = {
  api_key_not_configured: 'API key не настроен (OPENROUTER_API_KEY)',
  model_not_selected: 'Модель не выбрана',
  model_missing_in_catalog: 'Модель недоступна в каталоге OpenRouter',
  model_expired: 'Срок действия модели истёк',
  catalog_unavailable: 'Каталог моделей недоступен',
  model_test_required: 'Требуется проверка модели',
  model_test_failed: 'Проверка модели провалена',
  config_hash_mismatch: 'Конфигурация изменилась после проверки — повторите тест',
  test_model_mismatch: 'Тест относится к другой модели — повторите тест',
};

/**
 * Право активации (§12.C): решение принимает сервер (can_activate +
 * activation_blockers); UI только отображает причины.
 */
export function activationEligibility(
  view: Pick<AiSettingsView, 'can_activate' | 'activation_blockers' | 'enabled'> | null | undefined
): { canActivate: boolean; reasons: string[] } {
  if (!view) return { canActivate: false, reasons: ['Настройки не загружены'] };
  if (view.enabled) return { canActivate: false, reasons: ['Конфигурация уже активирована'] };
  const reasons = (view.activation_blockers ?? []).map((code) => BLOCKER_LABELS[code] ?? code);
  return { canActivate: view.can_activate && reasons.length === 0, reasons };
}

/** Черновик отличается от сохранённого: выбранная в таблице модель ≠ draft. */
export function isDraftDirty(
  view: Pick<AiSettingsView, 'selected_model'> | null | undefined,
  selectedInTable: string | null
): boolean {
  if (!selectedInTable) return false;
  return (view?.selected_model?.id ?? null) !== selectedInTable;
}

// ── Rollout (этап 2.5: всегда off) ───────────────────────────────────────────

export const ROLLOUT_OFF_MESSAGE =
  'Модель настроена. Пользовательские AI-запросы будут включены на этапе контролируемого запуска (2.6).';

export function rolloutDisplay(view: Pick<AiSettingsView, 'rollout_status'> | null | undefined): {
  tone: Tone;
  text: string;
} {
  // В 2.5 rollout всегда off — независимо от enabled.
  if (!view || view.rollout_status === 'off') {
    return { tone: 'info', text: ROLLOUT_OFF_MESSAGE };
  }
  return { tone: 'info', text: `Статус запуска: ${view.rollout_status}` };
}

/** Пояснение про server secret (§18.A): поля ввода ключа в UI НЕТ. */
export const API_KEY_HINT =
  'Ключ задаётся как server secret OPENROUTER_API_KEY. Через интерфейс ключ не вводится и не отображается.';

export const LIMITS_READONLY_HINT =
  'Пилотные лимиты настраиваются на этапе контролируемого запуска (2.6). Сейчас показаны безопасные значения по умолчанию.';
