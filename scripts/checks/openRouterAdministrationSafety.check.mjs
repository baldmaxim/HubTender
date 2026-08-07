// Этап 2.5 source guard — run via tsx:
//   npx tsx scripts/checks/openRouterAdministrationSafety.check.mjs
//
// 26 инвариантов OpenRouter-администрирования (§27 задания) + негативные
// self-check: каждый сценарий ослабления мутирует исходник В ПАМЯТИ и
// обязан быть пойман соответствующим правилом (файлы на диске не меняются).

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const F = {
  client: 'backend/internal/ai/openrouter/client.go',
  types: 'backend/internal/ai/openrouter/types.go',
  catalog: 'backend/internal/ai/openrouter/catalog.go',
  reranker: 'backend/internal/ai/openrouter/reranker.go',
  modeltest: 'backend/internal/ai/openrouter/modeltest.go',
  confighash: 'backend/internal/ai/openrouter/confighash.go',
  service: 'backend/internal/services/ai_admin.go',
  actions: 'backend/internal/services/ai_admin_actions.go',
  repo: 'backend/internal/repository/ai_settings.go',
  handler: 'backend/internal/handlers/ai_admin.go',
  routes: 'backend/cmd/server/routes.go',
  wire: 'backend/cmd/server/wire.go',
  config: 'backend/internal/config/config.go',
  migration: 'db/yandex/incremental/2026_07_ai_feature_settings.sql',
  suggest: 'backend/internal/ai/nomenclature/suggest.go',
  smartImport: 'backend/internal/services/smart_import.go',
  page: 'src/pages/AdminAiSettings/AdminAiSettings.tsx',
  catalogSection: 'src/pages/AdminAiSettings/components/CatalogSection.tsx',
  apiHelper: 'src/lib/api/adminAi.ts',
  transport: 'backend/internal/ai/openrouter/transport.go',
  proxyCatalog: 'backend/internal/ai/openrouter/proxycatalog.go',
  adminPolicy: 'src/lib/quality/openRouterAdminPolicy.ts',
};

// makeReader(overrides) — файловый доступ с in-memory подменами (self-check).
// Line endings нормализуются: checkout/stash на Windows может дать CRLF, а
// правила используют \n-границы.
function makeReader(overrides = {}) {
  return (rel) => {
    if (rel in overrides) return overrides[rel];
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) return null;
    return readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  };
}

// ─── Правила: (read) → [violations] ─────────────────────────────────────────
const RULES = [
  ['1. модели только с OpenRouter, без hardcoded списков', (read) => {
    const v = [];
    const cat = read(F.catalog);
    if (cat == null || !stripComments(cat).includes('ListUserModels')) {
      v.push('catalog.go — каталог обязан строиться из ListUserModels');
    }
    for (const rel of [F.catalog, F.service, F.actions, F.handler, F.apiHelper]) {
      const src = read(rel);
      if (src == null) continue;
      const code = stripComments(src);
      // hardcoded productionmodel-ID-лист = массив/слайс со строками моделей.
      if (/\[\][ \t]*string\s*\{[^}]*"(anthropic|openai|google|meta-llama|mistralai)\//.test(code)
        || /=[ \t]*\[[^\]]*"(anthropic|openai|google|meta-llama|mistralai)\/[^"]+"[^\]]*\]/.test(code)) {
        v.push(`${rel} — hardcoded список моделей запрещён (§27.1)`);
      }
    }
    return v;
  }],
  ['2. используется user-filtered endpoint /models/user', (read) => {
    const src = read(F.client);
    if (src == null) return ['client.go отсутствует'];
    const code = stripComments(src);
    return /"\/models\/user"/.test(code) ? [] : ['client.go — обязателен GET /models/user (каталог текущего ключа), а не глобальный /models (§27.2)'];
  }],
  ['3. API key только backend env (OPENROUTER_API_KEY)', (read) => {
    const v = [];
    const cfg = read(F.config);
    if (cfg == null || !cfg.includes('OPENROUTER_API_KEY')) {
      v.push('config.go — ключ обязан читаться из server env OPENROUTER_API_KEY');
    }
    if (cfg != null && /VITE_OPENROUTER/i.test(cfg)) {
      v.push('config.go — VITE_-префикс для секрета запрещён');
    }
    return v;
  }],
  ['4. API key не хранится в БД', (read) => {
    const v = [];
    const mig = read(F.migration);
    if (mig == null) {
      v.push('миграция ai_feature_settings отсутствует');
    } else if (/api_key|apikey|secret/i.test(mig.replace(/--[^\n]*/g, ''))) {
      v.push('миграция — колонка с ключом/секретом запрещена (§27.4)');
    }
    const repo = read(F.repo);
    if (repo != null && /APIKey|api_key/i.test(stripComments(repo))) {
      v.push('ai_settings.go — API key в репозитории/строке настроек запрещён (§27.4)');
    }
    return v;
  }],
  ['5. API key не передаётся frontend', (read) => {
    const v = [];
    const svc = read(F.service);
    if (svc != null) {
      const code = stripComments(svc);
      if (!code.includes('APIKeyConfigured')) {
        v.push('ai_admin.go — наружу допустим только api_key_configured (§27.5)');
      }
      if (/json:"api_key"|Key\s+string\s+`json:"key"`|cfg\.APIKey/.test(code)) {
        v.push('ai_admin.go — сам ключ в view/JSON запрещён (§27.5)');
      }
    }
    for (const rel of [F.apiHelper, F.page]) {
      const src = read(rel);
      if (src != null && /sk-or-v1|OPENROUTER_API_KEY\s*[=:]/.test(stripComments(src))) {
        v.push(`${rel} — ключ во frontend запрещён (§27.5)`);
      }
    }
    return v;
  }],
  ['6. admin model input не free-text', (read) => {
    const src = read(F.catalogSection);
    if (src == null) return ['CatalogSection.tsx отсутствует'];
    const code = stripComments(src);
    const v = [];
    if (!/rowSelection/.test(code) || !/type: 'radio'/.test(code)) {
      v.push('CatalogSection.tsx — выбор модели обязан быть radio-строкой каталога (§27.6)');
    }
    if (/Input[^.]*placeholder=.{0,50}(model id|модель id|введите модель)/i.test(code)) {
      v.push('CatalogSection.tsx — free-text ввод model ID запрещён (§27.6)');
    }
    return v;
  }],
  ['7. exact model ID сохраняется из каталога', (read) => {
    const src = read(F.actions);
    if (src == null) return ['ai_admin_actions.go отсутствует'];
    const code = stripComments(src);
    const save = code.slice(code.indexOf('func (s *AIAdminService) SaveDraft'));
    const body = save.slice(0, save.indexOf('\n}\n') + 2);
    const v = [];
    if (!/FindModel\(modelID\)/.test(body)) {
      v.push('SaveDraft — model ID обязан проверяться по server-каталогу (FindModel) (§27.7)');
    }
    if (!/ErrAIModelNotAvailable/.test(body)) {
      v.push('SaveDraft — модель вне каталога обязана отклоняться (§27.7)');
    }
    return v;
  }],
  ['8. auto/free router не выбирается', (read) => {
    const src = read(F.catalog);
    if (src == null) return ['catalog.go отсутствует'];
    const code = stripComments(src);
    const v = [];
    if (!/func IsRouterModel/.test(code)) {
      v.push('catalog.go — детект router-моделей (IsRouterModel) потерян (§27.8)');
    }
    const filter = code.slice(code.indexOf('func FilterCatalog'));
    if (!/IsRouterModel\(m\)/.test(filter.slice(0, filter.indexOf('\n}\n') + 2))) {
      v.push('catalog.go — FilterCatalog обязан исключать router/alias (§27.8)');
    }
    if (!code.includes('routerAuthor = "openrouter"') || !/isNegativePrice/.test(code)) {
      v.push('catalog.go — router-детект обязан опираться на metadata (author + отрицательные цены) (§27.8)');
    }
    return v;
  }],
  ['9. model test обязателен до activation', (read) => {
    const v = [];
    const act = read(F.actions);
    if (act != null) {
      const code = stripComments(act);
      const fn = code.slice(code.indexOf('func (s *AIAdminService) Activate'));
      const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
      if (!/AITestPassed/.test(body) || !/ErrAIModelTestRequired/.test(body)) {
        v.push('Activate — активация без PASSED-теста обязана отклоняться (§27.9)');
      }
    }
    const repo = read(F.repo);
    if (repo != null) {
      const code = stripComments(repo);
      const fn = code.slice(code.indexOf('func (r *AISettingsRepo) Activate'));
      if (!/model_test_status = 'passed'/.test(fn.slice(0, fn.indexOf('\n}\n') + 2))) {
        v.push('repo Activate — SQL-гейт model_test_status=passed потерян (§27.9)');
      }
    }
    const mig = read(F.migration);
    if (mig != null && !/NOT enabled OR \(/.test(mig)) {
      v.push('миграция — CHECK-страховка enabled↔passed потеряна (§27.9)');
    }
    return v;
  }],
  ['10. activation требует совпадения test config hash', (read) => {
    const v = [];
    const act = read(F.actions);
    if (act != null) {
      const code = stripComments(act);
      const fn = code.slice(code.indexOf('func (s *AIAdminService) Activate'));
      const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
      if (!/ModelTestConfigHash\s*!=\s*currentHash|\*row\.ModelTestConfigHash != currentHash/.test(body)) {
        v.push('Activate — сверка config hash теста с текущим потеряна (§27.10)');
      }
    }
    const repo = read(F.repo);
    if (repo != null) {
      const code = stripComments(repo);
      const fn = code.slice(code.indexOf('func (r *AISettingsRepo) Activate'));
      if (!/model_test_config_hash = \$3/.test(fn.slice(0, fn.indexOf('\n}\n') + 2))) {
        v.push('repo Activate — SQL-сверка hash потеряна (§27.10)');
      }
    }
    return v;
  }],
  ['11. config change сбрасывает тест', (read) => {
    const v = [];
    const act = read(F.actions);
    if (act != null) {
      const code = stripComments(act);
      if (!/resetTest := oldHash != newHash/.test(code)) {
        v.push('SaveDraft — смена config hash обязана сбрасывать тест (§27.11)');
      }
    }
    const repo = read(F.repo);
    if (repo != null) {
      const code = stripComments(repo);
      if (!/model_test_status = 'required'/.test(code)) {
        v.push('repo SaveDraftModel — сброс model_test_status=required потерян (§27.11)');
      }
    }
    return v;
  }],
  ['12. structured output strict', (read) => {
    const src = read(F.reranker);
    if (src == null) return ['reranker.go отсутствует'];
    const v = [];
    if (!/Type: "json_schema"/.test(src) || !/Strict: true/.test(src)) {
      v.push('reranker.go — response_format json_schema/strict потерян (§27.12)');
    }
    // Схема двухуровневая (объект + items): ОБА уровня обязаны быть strict.
    const strictCount = (src.match(/"additionalProperties": false/g) || []).length;
    if (strictCount < 2 || /"additionalProperties": true/.test(src)) {
      v.push('reranker.go — additionalProperties=false обязателен на всех уровнях схемы (§27.12)');
    }
    return v;
  }],
  ['13. privacy routing policy (deny/zdr/require/no-fallbacks)', (read) => {
    const v = [];
    const mig = read(F.migration);
    if (mig != null) {
      if (!/require_zdr boolean NOT NULL DEFAULT true/.test(mig)
        || !/data_collection_policy text NOT NULL DEFAULT 'deny'/.test(mig)
        || !/require_parameters boolean NOT NULL DEFAULT true/.test(mig)
        || !/allow_provider_fallbacks boolean NOT NULL DEFAULT false/.test(mig)) {
        v.push('миграция — safe policy defaults ослаблены (§27.13)');
      }
    }
    const handler = read(F.handler);
    if (handler != null) {
      const code = stripComments(handler);
      const put = code.slice(code.indexOf('func (h *AIAdminHandler) PutNomenclatureSettings'));
      const body = put.slice(0, put.indexOf('\n}\n') + 2);
      if (/zdr|data_collection|fallback|require_parameters/i.test(body)) {
        v.push('PUT settings — policy-поля не должны приниматься из запроса (§27.13)');
      }
    }
    return v;
  }],
  ['14. tools не отправляются', (read) => {
    const v = [];
    for (const rel of [F.types, F.reranker]) {
      const src = read(rel);
      if (src == null) continue;
      const code = stripComments(src);
      if (/json:"tools"|Tools\s+\[\]|tool_choice|ToolChoice/.test(code)) {
        v.push(`${rel} — tools в OpenRouter-запросе запрещены (§27.14)`);
      }
    }
    return v;
  }],
  ['15. external fetch/plugins/web search отсутствуют', (read) => {
    const v = [];
    for (const rel of [F.types, F.reranker, F.client]) {
      const src = read(rel);
      if (src == null) continue;
      const code = stripComments(src);
      if (/json:"plugins"|web_search|"web"|WebSearch|external_fetch/.test(code)) {
        v.push(`${rel} — plugins/web search/external fetch запрещены (§27.15)`);
      }
    }
    return v;
  }],
  ['16. candidate IDs локально валидируются после ответа', (read) => {
    const src = read(F.reranker);
    if (src == null) return ['reranker.go отсутствует'];
    const code = stripComments(src);
    return /ValidateRowResult\(/.test(code) && /allowedByRef/.test(code)
      ? []
      : ['reranker.go — локальная повторная валидация candidate set потеряна (§27.16)'];
  }],
  ['17. raw prompt/response не логируются и не сохраняются', (read) => {
    const v = [];
    for (const rel of [F.service, F.actions]) {
      const src = read(rel);
      if (src == null) continue;
      const code = stripComments(src);
      for (const m of code.matchAll(/log\.(Info|Warn|Error)\(\)[\s\S]*?Msg\(/g)) {
        if (/Explanation|Content|prompt[^_v]|RawValue|Description/.test(m[0])) {
          v.push(`${rel} — raw-текст в логах запрещён (§27.17)`);
        }
      }
    }
    const repo = read(F.repo);
    if (repo != null && /raw_prompt|raw_response|content_json/i.test(stripComments(repo))) {
      v.push('ai_settings.go — raw prompt/response в БД запрещены (§27.17)');
    }
    const mt = read(F.modeltest);
    if (mt != null && /RawResponse|RawPrompt|Content\s+string/.test(stripComments(mt))) {
      v.push('modeltest.go — отчёт не должен нести raw-ответ модели (§27.17)');
    }
    return v;
  }],
  ['18. user suggest остаётся rollout-off', (read) => {
    const v = [];
    const wire = read(F.wire);
    if (wire != null) {
      const code = stripComments(wire);
      if (!code.includes('ainom.DisabledProvider{}')) {
        v.push('wire.go — user-путь Smart Import обязан остаться на DisabledProvider (§27.18)');
      }
      if (/WithNomenclatureAI\([^)]*(orClient|openrouter\.)/.test(code)) {
        v.push('wire.go — OpenRouter reranker нельзя подключать к user-пути до этапа 2.6 (§27.18)');
      }
    }
    const svc = read(F.service);
    if (svc != null && !/AIRolloutStatus = "off"/.test(stripComments(svc))) {
      v.push('ai_admin.go — rollout-константа off потеряна (§27.18)');
    }
    return v;
  }],
  ['19. exact/alias/execute не вызывают OpenRouter', (read) => {
    const v = [];
    const si = read(F.smartImport);
    if (si != null) {
      const code = stripComments(si);
      const exec = code.slice(code.indexOf('func (s *SmartImportService) Execute'));
      if (/openrouter\.|Reranker|CreateChatCompletion/.test(exec.slice(0, exec.indexOf('\n}\n') + 2))) {
        v.push('smart_import.go — Execute не должен касаться OpenRouter (§27.19)');
      }
      if (/openrouter\./.test(code)) {
        v.push('smart_import.go — импорт openrouter-пакета в import-контуре запрещён (§27.19)');
      }
    }
    return v;
  }],
  ['20. OpenRouter failure не блокирует manual import', (read) => {
    const src = read(F.suggest);
    if (src == null) return ['suggest.go отсутствует'];
    return src.includes('partial assistance, candidates остаются')
      ? []
      : ['suggest.go — отказ провайдера обязан оставлять deterministic candidates (§27.20)'];
  }],
  ['21. base URL нельзя передать через request', (read) => {
    const v = [];
    const handler = read(F.handler);
    if (handler != null && /base_url|baseURL|endpoint/i.test(stripComments(handler))) {
      v.push('ai_admin.go (handler) — base URL/endpoint из запроса запрещён (§27.21)');
    }
    const client = read(F.client);
    if (client != null) {
      const code = stripComments(client);
      if (!/AllowedBaseURLs = map\[string\]bool/.test(code)) {
        v.push('client.go — allowlist официальных base URL потерян (§27.21)');
      }
      if (!/CheckRedirect/.test(code)) {
        v.push('client.go — запрет redirect потерян (§27.21)');
      }
    }
    const wire = read(F.wire);
    if (wire != null && !/openrouter\.AllowedBaseURLs\[orBase\]/.test(stripComments(wire))) {
      v.push('wire.go — production-проверка base URL по allowlist потеряна (§27.21)');
    }
    return v;
  }],
  ['22. provider/model нельзя передать через user request', (read) => {
    const v = [];
    const handler = read(F.handler);
    if (handler != null) {
      const code = stripComments(handler);
      const test = code.slice(code.indexOf('func (h *AIAdminHandler) TestNomenclatureModel'));
      const testBody = test.slice(0, test.indexOf('\n}\n') + 2);
      if (/Decode|Unmarshal|FormValue/.test(testBody)) {
        v.push('test-model — не должен принимать модель/prompt из body (§27.22)');
      }
      const act = code.slice(code.indexOf('func (h *AIAdminHandler) ActivateNomenclature'));
      const actBody = act.slice(0, act.indexOf('\n}\n') + 2);
      if (/Decode|Unmarshal|FormValue/.test(actBody)) {
        v.push('activate — model ID из body запрещён (§27.22)');
      }
    }
    return v;
  }],
  ['23. admin endpoints admin-only (server-side)', (read) => {
    const v = [];
    const routes = read(F.routes);
    if (routes != null) {
      const code = stripComments(routes);
      const idx = code.indexOf('/api/v1/admin/ai/');
      if (idx < 0) {
        v.push('routes.go — admin AI-маршруты отсутствуют');
      } else {
        const before = code.slice(Math.max(0, idx - 600), idx);
        if (!/RequireRoles\(handlers\.AIAdminRoles\)/.test(before)) {
          v.push('routes.go — /admin/ai/* обязаны быть под RequireRoles (§27.23)');
        }
      }
    }
    const handler = read(F.handler);
    if (handler != null) {
      const m = stripComments(handler).match(/AIAdminRoles = map\[string\]bool\{([^}]*)\}/);
      if (!m) {
        v.push('ai_admin.go — AIAdminRoles потерян (§27.23)');
      } else {
        const roles = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort().join(',');
        if (roles !== 'administrator,developer') {
          v.push(`ai_admin.go — состав AIAdminRoles изменён: ${roles} (§27.23)`);
        }
      }
    }
    return v;
  }],
  ['24. catalog cache имеет TTL и manual refresh', (read) => {
    const v = [];
    const cat = read(F.catalog);
    if (cat != null) {
      const code = stripComments(cat);
      if (!/CatalogTTL = 15 \* time\.Minute/.test(code)) {
        v.push('catalog.go — TTL 15 минут изменён/потерян (§27.24)');
      }
      if (!/singleflight/.test(code)) {
        v.push('catalog.go — singleflight-дедупликация refresh потеряна (§27.24)');
      }
    }
    const routes = read(F.routes);
    if (routes != null && !stripComments(routes).includes('/api/v1/admin/ai/openrouter/models/refresh')) {
      v.push('routes.go — manual refresh endpoint потерян (§27.24)');
    }
    return v;
  }],
  ['25. исчезнувшая модель — без auto-switch', (read) => {
    const v = [];
    const svc = read(F.service);
    if (svc != null) {
      const code = stripComments(svc);
      if (!/SetNeedsReview/.test(code)) {
        v.push('ai_admin.go — needs_review при исчезновении модели потерян (§27.25)');
      }
    }
    for (const rel of [F.service, F.actions]) {
      const src = read(rel);
      if (src == null) continue;
      if (/SaveDraftModel\([^)]*snap\.Models\[0\]|автоматически выбираем|fallbackModel/i.test(stripComments(src))) {
        v.push(`${rel} — автопереход на другую модель запрещён (§27.25)`);
      }
    }
    return v;
  }],
  ['26. Review Pack / frontend без API key', (read) => {
    const v = [];
    const rp = 'backend/internal/services/review_pack.go';
    const src = read(rp);
    if (src != null && /openrouter|OPENROUTER/i.test(stripComments(src))) {
      v.push('review_pack.go — OpenRouter/ключ в Review Pack запрещён (§27.26)');
    }
    // frontend: значение/чтение ключа в src/** запрещены. Упоминание ИМЕНИ
    // переменной в UI-подсказке («задаётся как server secret …») легально
    // и требуется заданием (§18.A).
    const scan = (dir) => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { scan(rel); continue; }
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        const code = readFileSync(join(ROOT, rel), 'utf8');
        if (/sk-or-v1-[A-Za-z0-9]/.test(code)
          || /VITE_OPENROUTER/.test(code)
          || /(import\.meta\.env|process\.env)\.[A-Z_]*OPENROUTER/.test(code)
          || /OPENROUTER_API_KEY\s*[=:]\s*['"`]/.test(code)) {
          v.push(`${rel} — OpenRouter-ключ во frontend запрещён (§27.26)`);
        }
      }
    };
    scan('src');
    return v;
  }],

  // §27.27 База LLM-прокси приходит ТОЛЬКО из server env и валидируется в
  // config-слое. Правило 21 охраняет allowlist OpenRouter; без этого правила
  // proxy-база стала бы дырой в том же инварианте.
  ['proxy base url — только server config', (read) => {
    const v = [];
    const cfg = read(F.config);
    if (!/PROXY_LLM_BASE_URL/.test(cfg) || !/NormalizeProxyBaseURL/.test(cfg)) {
      v.push(`${F.config} — PROXY_LLM_BASE_URL обязан читаться и валидироваться в config-слое (§27.27)`);
    }
    const tr = read(F.transport);
    if (!/requireHTTPS/.test(tr) || !/must use https in production/.test(tr)) {
      v.push(`${F.transport} — https обязателен для базы прокси в production (§27.27)`);
    }
    for (const f of [F.handler, F.service, F.apiHelper]) {
      if (/PROXY_LLM_BASE_URL|PROXY_LLM_TOKEN/.test(read(f))) {
        v.push(`${f} — параметры прокси не должны приходить через handler/frontend (§27.27)`);
      }
    }
    return v;
  }],

  // §27.28 Синтетический каталог обязан быть помечен как синтетический и не
  // содержать вендорных слагов: иначе пустые цены прочитаются как данные модели.
  ['синтетический каталог помечен', (read) => {
    const v = [];
    const pc = read(F.proxyCatalog);
    if (!/ProxyModelID\s*=\s*"proxy"/.test(pc)) {
      v.push(`${F.proxyCatalog} — заглушка модели обязана быть литералом "proxy" (§27.28)`);
    }
    if (/"(anthropic|openai|google|meta-llama|mistralai)\//.test(pc)) {
      v.push(`${F.proxyCatalog} — вендорные слаги моделей хардкодить запрещено (§27.28)`);
    }
    if (!/PROXY_CATALOG_SYNTHETIC/.test(read(F.adminPolicy))) {
      v.push(`${F.adminPolicy} — синтетический каталог обязан раскрываться оператору (§27.28)`);
    }
    return v;
  }],

  // §27.29 X-Idempotency-Key: ретраи существуют, и без ключа каждый повтор
  // оплачивается заново. Проверяем и отправку, и отсутствие второго места вызова.
  ['idempotency key отправляется из единственной точки', (read) => {
    const v = [];
    if (!/X-Idempotency-Key/.test(read(F.client))) {
      v.push(`${F.client} — X-Idempotency-Key обязан отправляться (§27.29)`);
    }
    if (!/idempotencyKey\(/.test(read(F.reranker))) {
      v.push(`${F.reranker} — ключ обязан вычисляться в единственной точке сборки запроса (§27.29)`);
    }
    const backendHits = [];
    const scan = (dir) => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { scan(rel); continue; }
        if (!/\.go$/.test(e.name) || /_test\.go$/.test(e.name)) continue;
        if (/"\/chat\/completions"/.test(readFileSync(join(ROOT, rel), 'utf8'))) backendHits.push(rel);
      }
    };
    scan('backend');
    if (backendHits.length > 1) {
      v.push(`несколько мест вызова chat/completions (${backendHits.join(', ')}) — ключ обойдут в одном из них (§27.29)`);
    }
    return v;
  }],

  // §27.30 Делегирование privacy-политики раскрыто. Прокси вырезает provider,
  // поэтому ZDR/data_collection не применяются — молчать об этом нельзя.
  ['делегирование privacy раскрыто', (read) => {
    const v = [];
    const pol = read(F.adminPolicy);
    if (!/PROXY_PRIVACY_DISCLOSURE/.test(pol) || !/НЕ применяются/.test(pol)) {
      v.push(`${F.adminPolicy} — потеря privacy-гарантии обязана раскрываться явным текстом (§27.30)`);
    }
    const svc = read(F.service);
    if (!/ProviderPolicyEnforced/.test(svc) || !/effectivePolicyVersion/.test(svc)) {
      v.push(`${F.service} — эффективная версия политики и факт её применения обязаны быть во view (§27.30)`);
    }
    if (!/ProviderPolicyVersionProxy/.test(read(F.reranker))) {
      v.push(`${F.reranker} — режим прокси обязан иметь отдельную provider_policy_version (§27.30)`);
    }
    return v;
  }],
];

function runRules(read) {
  const all = [];
  for (const [name, rule] of RULES) {
    for (const viol of rule(read)) all.push({ name, viol });
  }
  return all;
}

// ─── Позитивный прогон ───────────────────────────────────────────────────────
const baseline = runRules(makeReader());
console.log('openRouterAdministrationSafety.check:');
if (baseline.length > 0) {
  console.error('\n  ✗ FORBIDDEN: инварианты OpenRouter-администрирования нарушены.\n');
  for (const { name, viol } of baseline) console.error(`    - [${name}] ${viol}`);
  console.error('');
  process.exit(1);
}
for (const [name] of RULES) console.log('  ok — ' + name);

// ─── Негативные self-check (§27): мутации в памяти, файлы не трогаются ──────
const realRead = makeReader();
const SELF_CHECKS = [
  ['hardcoded model list', F.service,
    (s) => s + '\nvar defaultModels = []string{"openai/gpt-4o", "anthropic/claude-3"}\n'],
  ['API key в status response', F.service,
    (s) => s.replace('APIKeyConfigured bool', 'APIKeyConfigured bool `json:"x"`\n\tRawKey string `json:"api_key"`')],
  ['free-text model field', F.catalogSection,
    (s) => s.replace('rowSelection={{', 'x={<Input placeholder="Введите модель ID вручную" />}\n          rowSelection={{').replace("type: 'radio'", "type: 'checkbox'")],
  ['model test gate удалён', F.repo,
    (s) => s.replace("AND model_test_status = 'passed'", '')],
  ['allow_fallbacks включён', F.migration,
    (s) => s.replace('allow_provider_fallbacks boolean NOT NULL DEFAULT false', 'allow_provider_fallbacks boolean NOT NULL DEFAULT true')],
  ['ZDR удалён', F.migration,
    (s) => s.replace('require_zdr boolean NOT NULL DEFAULT true', 'require_zdr boolean NOT NULL DEFAULT false')],
  ['tools добавлены', F.types,
    (s) => s.replace('Provider       *ProviderPrefs  `json:"provider,omitempty"`', 'Provider       *ProviderPrefs  `json:"provider,omitempty"`\n\tTools          []any           `json:"tools"`')],
  ['normal suggest live call', F.wire,
    (s) => s.replace('ainom.DisabledProvider{}', 'openrouter.NewReranker(orClient, openrouter.RerankSettings{})')],
  ['auto-switch модели', F.actions,
    (s) => s.replace('func (s *AIAdminService) SaveDraft', 'var fallbackModel = "openrouter/auto"\n\nfunc (s *AIAdminService) SaveDraft')],
  ['strict schema ослаблен', F.reranker,
    (s) => s.replace('"additionalProperties": false', '"additionalProperties": true')],
  ['config change без сброса теста', F.actions,
    (s) => s.replace('resetTest := oldHash != newHash', 'resetTest := false')],
  ['admin-гейт снят', F.routes,
    (s) => s.replace('r.Use(middleware.RequireRoles(handlers.AIAdminRoles))', '')],
  ['idempotency key убран', F.client,
    (s) => s.replaceAll('X-Idempotency-Key', 'X-Ignored-Key')],
  ['раскрытие privacy убрано', F.adminPolicy,
    (s) => s.replaceAll('НЕ применяются', 'применяются')],
  ['вендорный слаг в заглушке каталога', F.proxyCatalog,
    (s) => s.replace('ProxyModelID = "proxy"', 'ProxyModelID = "openai/gpt-4o"')],
  ['валидация базы прокси ослаблена', F.config,
    (s) => s.replace('NormalizeProxyBaseURL', 'strings.TrimSpace')],
];

let selfCheckFailures = 0;
console.log('\n  негативные self-check (§27):');
for (const [label, file, mutate] of SELF_CHECKS) {
  const original = realRead(file);
  if (original == null) {
    console.error(`    ✗ ${label}: файл ${file} не найден`);
    selfCheckFailures++;
    continue;
  }
  const mutated = mutate(original);
  if (mutated === original) {
    console.error(`    ✗ ${label}: мутация не применилась (guard рассинхронизирован с исходником)`);
    selfCheckFailures++;
    continue;
  }
  const caught = runRules(makeReader({ [file]: mutated }));
  if (caught.length === 0) {
    console.error(`    ✗ ${label}: ослабление НЕ поймано ни одним правилом`);
    selfCheckFailures++;
  } else {
    console.log(`    ok — ${label} → пойман (${caught[0].name})`);
  }
}

if (selfCheckFailures > 0) {
  console.error(`\nopenRouterAdministrationSafety.check: self-check failures: ${selfCheckFailures}`);
  process.exit(1);
}
console.log('\nopenRouterAdministrationSafety.check: passed (30 rules + ' + SELF_CHECKS.length + ' negative self-checks)');
