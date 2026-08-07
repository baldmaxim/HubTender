// Этап 2.5 focused frontend checks — run via tsx:
//   npx tsx scripts/checks/openRouterAdminFrontendPolicy.check.mjs
//
// Pure-хелперы страницы AI-администрирования OpenRouter (§26 задания):
// без сети и DOM — только политика отображения/фильтрации/активации.

import { readFileSync } from 'node:fs';
import {
  API_KEY_HINT, FREE_VARIANT_WARNING, LIMITS_READONLY_HINT, ROLLOUT_OFF_MESSAGE,
  activationEligibility, catalogStateDisplay, connectionStatusDisplay,
  expirationDisplay, filterModels, formatUsd, isDraftDirty, keyUsageRows,
  modelAuthors, pricePerMillionDisplay, rolloutDisplay, sortModels,
  testStatusDisplay,
} from '../../src/lib/quality/openRouterAdminPolicy.ts';

const failures = [];
const check = (name, cond) => { cond ? console.log('  ok — ' + name) : failures.push(name); };

const model = (over = {}) => ({
  id: 'prov/alpha', canonical_slug: 'prov/alpha', name: 'Alpha', description: 'test model',
  created_at: '2026-01-01T00:00:00Z', expiration_date: null,
  context_length: 128000, max_completion_tokens: 16000,
  input_modalities: ['text'], output_modalities: ['text'], modality: 'text->text', tokenizer: 'Other',
  prompt_price_per_token: '0.000001', completion_price_per_token: '0.000002', request_price: '0',
  price_per_1m_input_tokens: '1', price_per_1m_output_tokens: '2',
  supported_parameters: ['temperature', 'response_format', 'structured_outputs'],
  is_moderated: false, structured_outputs_indicated: true, is_free_variant: false, author: 'prov',
  ...over,
});
const settings = (over = {}) => ({
  feature_code: 'nomenclature_rerank', provider: 'openrouter', api_key_configured: true,
  selected_model: null, prompt_version: 'nomenclature-rerank-v1',
  schema_version: 'nomenclature-rerank-schema-v1', provider_policy_version: 'openrouter-policy-v1',
  adapter_version: 'openrouter-reranker-v1', require_zdr: true, data_collection_policy: 'deny',
  require_parameters: true, allow_provider_fallbacks: false,
  request_timeout_seconds: 30, max_output_tokens: 2000, temperature: 0, candidate_limit: 20,
  max_rows_per_request: 200, max_concurrency: 2, monthly_budget_usd: null, limits_editable: false,
  current_config_hash: 'abc', model_test: { status: 'required' }, enabled: false,
  model_availability: 'not_selected', can_activate: false, activation_blockers: ['model_not_selected'],
  rollout_status: 'off', updated_at: '2026-07-16T00:00:00Z', ...over,
});

// 1-4. Статусы подключения (§26.1-4).
check('1. not configured → warning + подсказка про server secret',
  connectionStatusDisplay({ connection: 'not_configured' }).tone === 'warning'
  && connectionStatusDisplay({ connection: 'not_configured' }).text.includes('OPENROUTER_API_KEY'));
check('2. connected → success', connectionStatusDisplay({ connection: 'connected' }).tone === 'success');
check('3. unauthorized → error', connectionStatusDisplay({ connection: 'unauthorized' }).tone === 'error');
check('4. payment required → error',
  connectionStatusDisplay({ connection: 'payment_required' }).tone === 'error'
  && connectionStatusDisplay({ connection: 'payment_required' }).text.includes('кредитов'));

// 5-7. Состояние каталога (§26.5-7).
check('5. catalog loading (нет данных) → info', catalogStateDisplay(null).tone === 'info');
check('6. catalog stale → warning + время кэша',
  catalogStateDisplay({ status: 'stale', fetched_at: '2026-07-16T10:00:00Z' }).tone === 'warning'
  && catalogStateDisplay({ status: 'stale', fetched_at: '2026-07-16T10:00:00Z' }).text.includes('кэш'));
check('7. catalog unavailable → error + выбор недоступен',
  catalogStateDisplay({ status: 'unavailable', fetched_at: null }).tone === 'error'
  && catalogStateDisplay({ status: 'unavailable', fetched_at: null }).text.includes('невозможен'));

// 8-13. Фильтры каталога (§26.8-13).
const catalog = [
  model(),
  model({ id: 'prov/beta', name: 'Beta', author: 'prov', context_length: 8000, price_per_1m_input_tokens: '10', price_per_1m_output_tokens: '30', structured_outputs_indicated: false }),
  model({ id: 'other/gamma', name: 'Gamma кабель', author: 'other', description: 'для смет' }),
];
check('8. поиск по name/ID/description',
  filterModels(catalog, { search: 'кабель' }).length === 1
  && filterModels(catalog, { search: 'prov/beta' }).length === 1
  && filterModels(catalog, { search: 'для смет' }).length === 1);
check('9. фильтр по организации (author)',
  filterModels(catalog, { author: 'other' }).length === 1
  && modelAuthors(catalog).join(',') === 'other,prov');
check('10. фильтр min context', filterModels(catalog, { minContext: 100000 }).length === 2);
check('11. фильтр max input price /1M', filterModels(catalog, { maxInputPricePer1M: 5 }).length === 2);
check('12. фильтр max output price /1M', filterModels(catalog, { maxOutputPricePer1M: 5 }).length === 2);
check('13. фильтр structured outputs (catalog indication)',
  filterModels(catalog, { structuredOutputsOnly: true }).length === 2);

// 14. Exact ID отображается как есть (сортировка стабильна).
check('14. sortModels стабильна и сохраняет exact ID',
  sortModels(catalog)[0].id === 'other/gamma'
  && sortModels(catalog).map((m) => m.id).join(',') === 'other/gamma,prov/alpha,prov/beta');

// 15. Router-модели в каталоге отсутствуют по построению (сервер фильтрует);
// free-text ввода модели нет — выбранной может стать только строка каталога.
check('15. free-text модель не проходит фильтр selectedOnly',
  filterModels(catalog, { selectedOnly: true }, settings({ selected_model: { id: 'prov/alpha' } })).length === 1
  && filterModels(catalog, { selectedOnly: true }, settings({ selected_model: { id: 'evil/manual' } })).length === 0);

// 16. Expired/expiring отображение.
check('16. expiration: пусто → «—», дата → expiring',
  expirationDisplay(null).text === '—' && expirationDisplay(null).expiring === false
  && expirationDisplay('2027-01-01').expiring === true);

// 17-18. Выбранная модель + dirty draft.
check('17. isDraftDirty: таблица ≠ сохранённый draft',
  isDraftDirty(settings({ selected_model: { id: 'prov/alpha' } }), 'prov/beta') === true
  && isDraftDirty(settings({ selected_model: { id: 'prov/alpha' } }), 'prov/alpha') === false);
check('18. isDraftDirty: без выбора в таблице — не dirty',
  isDraftDirty(settings(), null) === false);

// 19-22. Статусы теста (§26.19-22).
check('19. test required → warning', testStatusDisplay({ status: 'required' }).tone === 'warning');
check('20. test running == required (кнопка в loading)',
  testStatusDisplay({ status: 'required' }).text.includes('Требуется'));
check('21. test passed → success', testStatusDisplay({ status: 'passed' }).tone === 'success');
check('22. test failed → error + safe-код',
  testStatusDisplay({ status: 'failed', error_code: 'invalid_response' }).tone === 'error'
  && testStatusDisplay({ status: 'failed', error_code: 'invalid_response' }).text.includes('invalid_response'));

// 23-25. Активация (§26.23-25) — server-authoritative.
check('23. activate disabled до теста',
  activationEligibility(settings({ activation_blockers: ['model_test_required'], can_activate: false })).canActivate === false
  && activationEligibility(settings({ activation_blockers: ['model_test_required'] })).reasons[0].includes('проверка'));
check('24. activate enabled после matching test',
  activationEligibility(settings({ can_activate: true, activation_blockers: [] })).canActivate === true);
check('25. config change сбрасывает право активации',
  activationEligibility(settings({ can_activate: false, activation_blockers: ['config_hash_mismatch'] }))
    .reasons[0].includes('повторите тест'));

// 26. Deactivate: активная конфигурация не может активироваться повторно.
check('26. enabled → активировать нельзя (только отключить)',
  activationEligibility(settings({ enabled: true, can_activate: false, activation_blockers: [] })).canActivate === false);

// 27. Rollout off message (§26.27).
check('27. rollout off всегda + текст про контролируемый запуск',
  rolloutDisplay(settings()).text === ROLLOUT_OFF_MESSAGE
  && ROLLOUT_OFF_MESSAGE.includes('контролируемого запуска'));

// 28-29. Отсутствие API key поля и free-text model input (§26.28-29).
const pageSources = [
  '../../src/pages/AdminAiSettings/AdminAiSettings.tsx',
  '../../src/pages/AdminAiSettings/components/ConnectionSection.tsx',
  '../../src/pages/AdminAiSettings/components/CatalogSection.tsx',
  '../../src/pages/AdminAiSettings/components/SelectedModelSection.tsx',
].map((p) => readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
// 28 (feature/ai-key-ui): ввод ключа разрешён ТОЛЬКО write-only модалом в
// ConnectionSection: Input.Password, значение немедленно сбрасывается после
// submit и никогда не рендерится назад.
const connectionSrc = readFileSync(new URL('../../src/pages/AdminAiSettings/components/ConnectionSection.tsx', import.meta.url), 'utf8');
const nonConnectionSources = pageSources.replace(connectionSrc, '');
check('28. ввод ключа — только write-only модал в ConnectionSection',
  /Input\.Password/.test(connectionSrc)
  && !/Input\.Password/.test(nonConnectionSources)
  && /setKeyDraft\(''\)/.test(connectionSrc)          // ключ забывается после submit/cancel
  && !/>\s*\{keyDraft\}/.test(connectionSrc)          // значение не рендерится как текст
  && /key_suffix/.test(connectionSrc)                    // назад — только суффикс
  && API_KEY_HINT.includes('OPENROUTER_API_KEY'));
// 29. Каталог остаётся radio-выбором. Единственное исключение — ручной ввод
// слага в режиме proxy_llm: каталога у прокси нет, списка моделей взять
// неоткуда. Исключение обязано быть за гардом isProxy и обязано проверять
// формат до отправки (proxyModelSlugError), иначе опечатка вернётся ошибкой
// OpenRouter из-за прокси — диагностика на часы.
const manualModelInput = /ai-manual-model-input/.test(pageSources);
check('29. выбор модели — radio из таблицы; ручной слаг только за гардом proxy',
  /rowSelection/.test(pageSources) && /type: 'radio'/.test(pageSources)
  && (!manualModelInput || (/isProxy\s*&&/.test(pageSources) && /proxyModelSlugError/.test(pageSources)))
  && (manualModelInput || !/Input[^.]*placeholder=.{0,40}(model|модел)/i.test(pageSources)));

// 30. Цены без NaN (§26.30).
check('30. pricePerMillionDisplay: мусор → «—», значение → $',
  pricePerMillionDisplay('') === '—' && pricePerMillionDisplay('NaN') === '—'
  && pricePerMillionDisplay('1.5') === '$1.5'
  && formatUsd(Number.NaN) === '—' && formatUsd(2.5) === '$2.50');

// 31. Секреты не попадают во frontend-конфиг (§26.31).
const apiFiles = [
  '../../src/lib/api/adminAi.ts',
  '../../src/lib/quality/openRouterAdminPolicy.ts',
].map((p) => readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
check('31. frontend-код не содержит OPENROUTER_API_KEY/VITE_OPENROUTER',
  !/VITE_OPENROUTER/.test(apiFiles + pageSources)
  && !/OPENROUTER_API_KEY\s*[=:]/.test(apiFiles + pageSources)
  && !/sk-or-v1/.test(apiFiles + pageSources));

// 32. Non-admin: страница в ALL_PAGES → гейтится hasPageAccess; ключевые
// usage-строки не содержат самого ключа.
check('32. keyUsageRows без секретов + null-лимит → «Без лимита»',
  keyUsageRows({
    label: 'prod', limit: null, limit_remaining: null, limit_reset: null,
    usage: 1, usage_daily: 0.1, usage_weekly: 0.5, usage_monthly: 1,
    byok_usage: 0, is_free_tier: true, expires_at: null,
  }).some((r) => r.value === 'Без лимита')
  && keyUsageRows(null).length === 0
  && LIMITS_READONLY_HINT.includes('контролируемого запуска')
  && FREE_VARIANT_WARNING.includes('Не рекомендуется'));

if (failures.length) {
  console.error('\nFAILED openRouterAdminFrontendPolicy checks:');
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('\nopenRouterAdminFrontendPolicy: все проверки пройдены (' + 32 + ')');
