// Этап 2.6 source guard — run via tsx:
//   npx tsx scripts/checks/controlledAiRolloutSafety.check.mjs
//
// 30 инвариантов controlled rollout (§31) + негативные self-check
// (мутации в памяти; файлы на диске не изменяются).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const F = {
  migration: 'db/yandex/incremental/2026_07_ai_rollout_controlled.sql',
  settingsRepo: 'backend/internal/repository/ai_settings.go',
  rolloutRepo: 'backend/internal/repository/ai_rollout.go',
  usageRepo: 'backend/internal/repository/ai_usage.go',
  rolloutSvc: 'backend/internal/services/ai_rollout.go',
  opsSvc: 'backend/internal/services/ai_rollout_ops.go',
  gateway: 'backend/internal/services/ai_rollout_gateway.go',
  maintenance: 'backend/internal/services/ai_rollout_maintenance.go',
  evalSvc: 'backend/internal/services/ai_evaluation.go',
  evalRunner: 'backend/internal/ai/aieval/runner.go',
  smartImport: 'backend/internal/services/smart_import.go',
  smartImportAI: 'backend/internal/services/smart_import_ai.go',
  handler: 'backend/internal/handlers/ai_rollout.go',
  routes: 'backend/cmd/server/routes.go',
  wire: 'backend/cmd/server/wire.go',
  policy: 'src/lib/quality/aiRolloutPolicy.ts',
  panel: 'src/pages/ClientPositions/components/NomenclatureSuggestPanel.tsx',
};

function makeReader(overrides = {}) {
  return (rel) => {
    if (rel in overrides) return overrides[rel];
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) return null;
    return readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  };
}

const RULES = [
  ['1. rollout по умолчанию off', (read) => {
    const v = [];
    const mig = read(F.migration);
    if (mig == null || !/rollout_mode text NOT NULL DEFAULT 'off'/.test(mig)) {
      v.push('миграция — default rollout_mode должен быть off');
    }
    return v;
  }],
  ['2. режима general availability не существует', (read) => {
    const v = [];
    const mig = read(F.migration);
    if (mig != null && !/IN \('off', 'evaluation', 'pilot_individual', 'pilot_bulk'\)/.test(mig)) {
      v.push('миграция — CHECK режимов изменён (§31.2)');
    }
    for (const rel of [F.rolloutSvc, F.policy]) {
      const src = read(rel);
      if (src == null) continue;
      const code = stripComments(src);
      if (/general_availability|AIRolloutAll|'all'\s*:|rollout.*"public"/i.test(code)) {
        v.push(`${rel} — general availability запрещён (§31.2)`);
      }
    }
    return v;
  }],
  ['3. pilot allowlist server-side', (read) => {
    const src = read(F.rolloutRepo);
    if (src == null) return ['ai_rollout.go отсутствует'];
    const code = stripComments(src);
    return /GetActivePilotMembership/.test(code) && /is_active/.test(code) && /expires_at/.test(code)
      ? [] : ['ai_rollout.go — server-side membership (active+expiry) потерян (§31.3)'];
  }],
  ['4. non-pilot не вызывает провайдера', (read) => {
    const src = read(F.gateway);
    if (src == null) return ['gateway отсутствует'];
    const code = stripComments(src);
    const fn = code.slice(code.indexOf('func (s *AIAdminService) AcquireLiveSession'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
    const v = [];
    if (!/GetActivePilotMembership/.test(body) || !/AICapNotAllowed/.test(body)) {
      v.push('gateway — membership-гейт до provider-вызова потерян (§31.4)');
    }
    return v;
  }],
  ['5. exact/alias не вызывают провайдера', (read) => {
    // Suggest получает ТОЛЬКО unresolved-строки (2.2 §10) — exact/alias не
    // доходят до gateway; инвариант 2.2 guard'а + фильтр в smart_import_ai.
    const src = read(F.smartImportAI);
    if (src == null) return ['smart_import_ai.go отсутствует'];
    const code = stripComments(src);
    return code.includes('"NOMENCLATURE_NOT_FOUND"') && code.includes('"NOMENCLATURE_AMBIGUOUS"')
      ? [] : ['smart_import_ai.go — suggest обязан отбирать только unresolved (§31.5)'];
  }],
  ['6. execute не вызывает провайдера', (read) => {
    const src = read(F.smartImport);
    if (src == null) return ['smart_import.go отсутствует'];
    const code = stripComments(src);
    const exec = code.slice(code.indexOf('func (s *SmartImportService) Execute'));
    const body = exec.slice(0, exec.indexOf('\n}\n') + 2);
    return /AcquireLiveSession|CreateChatCompletion|Rerank\(/.test(body)
      ? ['Execute — provider-вызовы запрещены (§31.6)'] : [];
  }],
  ['7. suggestion только по явному действию пользователя', (read) => {
    const src = read(F.panel);
    if (src == null) return ['panel отсутствует'];
    const code = stripComments(src);
    for (const m of code.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)) {
      if (/runSuggest\(|suggestNomenclature\(/.test(m[1])) {
        return ['panel — авто-запуск suggest запрещён (§31.7)'];
      }
    }
    return [];
  }],
  ['8. no auto-select', (read) => {
    const src = read(F.panel);
    if (src == null) return ['panel отсутствует'];
    const code = stripComments(src);
    for (const m of code.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)) {
      if (/confirmRow|onSelectionsChange/.test(m[1])) {
        return ['panel — авто-подтверждение запрещено (§31.8)'];
      }
    }
    return [];
  }],
  ['9. распределённые квоты существуют', (read) => {
    const src = read(F.usageRepo);
    if (src == null) return ['ai_usage.go отсутствует'];
    const code = stripComments(src);
    const v = [];
    if (!/pg_advisory_xact_lock/.test(code)) {
      v.push('ai_usage.go — advisory-lock сериализация reservation потеряна (§31.9)');
    }
    if (!/ErrAIUserQuotaExhausted/.test(code) || !/ErrAIRowQuotaExhausted/.test(code)) {
      v.push('ai_usage.go — квотные отказы потеряны (§31.9)');
    }
    return v;
  }],
  ['10. месячный бюджетный гейт существует', (read) => {
    const src = read(F.usageRepo);
    if (src == null) return ['ai_usage.go отсутствует'];
    return /ErrAIBudgetExhausted/.test(stripComments(src)) && /date_trunc\('month'/.test(src)
      ? [] : ['ai_usage.go — месячный бюджетный гейт потерян (§31.10)'];
  }],
  ['11. exact decimal учёт (без float в деньгах)', (read) => {
    const v = [];
    for (const rel of [F.usageRepo, F.gateway, F.opsSvc]) {
      const src = read(rel);
      if (src == null) continue;
      const code = stripComments(src);
      if (!/big\.Rat/.test(code)) {
        v.push(`${rel} — big.Rat учёт потерян (§31.11)`);
      }
      if (/ParseFloat\([^)]*(cost|spent|budget|amount|reserv)/i.test(code)
        || /float64\([^)]*(cost|spent|budget|amount)/i.test(code)) {
        v.push(`${rel} — float-парсинг денежных значений запрещён (§31.11)`);
      }
    }
    const mig = read(F.migration);
    if (mig != null && !/numeric\(14, 8\)/.test(mig)) {
      v.push('миграция — деньги обязаны быть numeric (§31.11)');
    }
    return v;
  }],
  ['12. reservation/reconciliation существуют', (read) => {
    const src = read(F.usageRepo);
    if (src == null) return ['ai_usage.go отсутствует'];
    const code = stripComments(src);
    const v = [];
    if (!/func \(r \*AISettingsRepo\) ReserveUsage/.test(code)) v.push('ReserveUsage потерян (§31.12)');
    if (!/func \(r \*AISettingsRepo\) ReconcileUsage/.test(code)) v.push('ReconcileUsage потерян (§31.12)');
    if (!/reservation_underestimate/.test(code)) v.push('underestimate-пометка потеряна (§31.12)');
    return v;
  }],
  ['13. reservation recovery существует', (read) => {
    const v = [];
    if (read(F.usageRepo) == null || !/RecoverExpiredReservations/.test(stripComments(read(F.usageRepo)))) {
      v.push('recovery потерян (§31.13)');
    }
    const maint = read(F.maintenance);
    if (maint == null || !/RecoverExpiredReservations/.test(stripComments(maint))) {
      v.push('maintenance-воркер recovery потерян (§31.13)');
    }
    return v;
  }],
  ['14. circuit breaker существует', (read) => {
    const src = read(F.rolloutRepo);
    if (src == null) return ['ai_rollout.go отсутствует'];
    const code = stripComments(src);
    return /CircuitAllowProbe/.test(code) && /CircuitRecordFailure/.test(code) && /half_open/.test(code)
      ? [] : ['circuit breaker примитивы потеряны (§31.14)'];
  }],
  ['15. emergency off существует', (read) => {
    const v = [];
    const repo = read(F.settingsRepo) ?? '';
    const rollout = read(F.rolloutRepo) ?? '';
    if (!/func \(r \*AISettingsRepo\) EmergencyOff/.test(stripComments(repo + rollout))) {
      v.push('EmergencyOff repo-метод потерян (§31.15)');
    }
    const routes = read(F.routes);
    if (routes == null || !routes.includes('/rollout/emergency-off')) {
      v.push('emergency-off endpoint потерян (§31.15)');
    }
    return v;
  }],
  ['16. stale provider response отбрасывается', (read) => {
    const src = read(F.gateway);
    if (src == null) return ['gateway отсутствует'];
    const code = stripComments(src);
    const v = [];
    if (!/func \(ls \*AILiveSession\) isStale/.test(code)) {
      v.push('gateway — isStale-проверка потеряна (§31.16)');
    }
    if (!/staleDiscarded = true/.test(code)) {
      v.push('gateway — отбрасывание stale-результата потеряно (§31.16)');
    }
    if (!/stale_discarded/.test(code)) {
      v.push('gateway — usage-учёт stale потерян (§31.16)');
    }
    return v;
  }],
  ['17. model/config change форсирует off', (read) => {
    const src = read(F.settingsRepo);
    if (src == null) return ['ai_settings.go отсутствует'];
    return /rollout_mode = 'off',\s*\n\s*rollout_config_version = rollout_config_version \+ 1/.test(src)
      ? [] : ['SaveDraftModel — config change обязан форсировать rollout off (§31.17)'];
  }],
  ['18. live evaluation gate обязателен для pilot', (read) => {
    const src = read(F.rolloutSvc);
    if (src == null) return ['ai_rollout.go (svc) отсутствует'];
    const code = stripComments(src);
    return /live_eval_passed/.test(code) && /live_eval_current/.test(code)
      ? [] : ['transitionGates — live-eval гейты потеряны (§31.18)'];
  }],
  ['19. pilot_bulk quality gate обязателен', (read) => {
    const src = read(F.rolloutSvc);
    if (src == null) return ['ai_rollout.go (svc) отсутствует'];
    const code = stripComments(src);
    return /SuccessfulOutcomes >= 50/.test(code) && /0\.02/.test(code)
      ? [] : ['pilot_bulk гейт (≥50 outcomes, ≤2%) потерян (§31.19)'];
  }],
  ['20. critical false-positive порог остаётся нулевым', (read) => {
    const src = read(F.evalRunner);
    if (src == null) return ['aieval/runner.go отсутствует'];
    const code = stripComments(src);
    return /CriticalFalsePos == 0/.test(code)
      ? [] : ['EvaluateGates — порог critical FP != 0 запрещён (§31.20)'];
  }],
  ['21. raw prompt/response не сохраняются', (read) => {
    const v = [];
    const mig = read(F.migration);
    if (mig != null) {
      const sql = mig.replace(/--[^\n]*/g, '');
      if (/raw_prompt|raw_response|prompt_text|response_text|source_text[^_]/i.test(sql)) {
        v.push('миграция — raw-поля запрещены (§31.21)');
      }
    }
    return v;
  }],
  ['22. чувствительные поля не персистятся', (read) => {
    const mig = read(F.migration);
    if (mig == null) return ['миграция отсутствует'];
    const sql = mig.replace(/--[^\n]*/g, '');
    return /tender_id|quantity|unit_rate|total_amount|candidate_label|api_key/i.test(sql)
      ? ['миграция — financial/identity поля в ledger/feedback запрещены (§31.22)'] : [];
  }],
  ['23. financial-поля не уходят провайдеру', (read) => {
    // Инвариант 2.2: payload-типы без денег; здесь — gateway не строит свой
    // payload (только ainom.RerankBatchRequest).
    const src = read(F.gateway);
    if (src == null) return ['gateway отсутствует'];
    const code = stripComments(src);
    return /ainom\.RerankBatchRequest/.test(code) && !/Quantity|UnitRate|TotalAmount/.test(code)
      ? [] : ['gateway — посторонние поля в provider-путь запрещены (§31.23)'];
  }],
  ['24. provider/model override из запроса невозможен', (read) => {
    const src = read(F.handler);
    if (src == null) return ['handler отсутствует'];
    const code = stripComments(src);
    const v = [];
    const trans = code.slice(code.indexOf('func (h *AIAdminHandler) RolloutTransition'));
    if (/model|provider|prompt/i.test(trans.slice(0, trans.indexOf('\n}\n')).match(/var req struct \{[\s\S]*?\}/)?.[0] ?? '')) {
      v.push('transition — model/provider/prompt в теле запрещены (§31.24)');
    }
    return v;
  }],
  ['25. второго провайдера/fallback нет', (read) => {
    const v = [];
    for (const rel of [F.gateway, F.evalSvc, F.opsSvc]) {
      const src = read(rel);
      if (src == null) continue;
      const code = stripComments(src);
      if (/openai\.|anthropic\.|fallbackProvider|secondProvider/.test(code)) {
        v.push(`${rel} — второй провайдер/fallback запрещён (§31.25)`);
      }
    }
    return v;
  }],
  ['26. manual fallback всегда доступен', (read) => {
    const src = read(F.smartImportAI);
    if (src == null) return ['smart_import_ai.go отсутствует'];
    const code = stripComments(src);
    // Отказ gateway не прерывает suggest: deterministic Suggest выполняется всегда.
    return /deterministic|res := ainom\.Suggest/.test(code) && /aiGateway != nil/.test(code)
      ? [] : ['smart_import_ai.go — deterministic путь обязан выполняться при любом отказе gateway (§31.26)'];
  }],
  ['27. feedback только после успешного импорта', (read) => {
    const src = read(F.smartImport);
    if (src == null) return ['smart_import.go отсутствует'];
    const code = stripComments(src);
    const idxImport = code.indexOf('s.importer.BulkImport');
    const idxFeedback = code.indexOf('finishAIFeedback');
    return idxImport >= 0 && idxFeedback > idxImport
      ? [] : ['smart_import.go — feedback обязан идти ПОСЛЕ успешного импорта (§31.27)'];
  }],
  ['28. usage ledger без raw row text', (read) => {
    const src = read(F.usageRepo);
    if (src == null) return ['ai_usage.go отсутствует'];
    const code = stripComments(src);
    return /row_context_hash/.test(code) && !/source_description|row_text|description\s+text/i.test(code)
      ? [] : ['ai_usage.go — только hash контекста строки, без raw text (§31.28)'];
  }],
  ['29. AI key отсутствует во frontend/review pack', (read) => {
    const v = [];
    const policy = read(F.policy);
    if (policy != null && /sk-or-v1-[A-Za-z0-9]|VITE_OPENROUTER/.test(policy)) {
      v.push('aiRolloutPolicy.ts — ключ во frontend запрещён (§31.29)');
    }
    const rp = read('backend/internal/services/review_pack.go');
    if (rp != null && /openrouter|OPENROUTER/i.test(stripComments(rp))) {
      v.push('review_pack.go — OpenRouter в Review Pack запрещён (§31.29)');
    }
    return v;
  }],
  ['30. production rollout не выполняется скриптами', (read) => {
    const v = [];
    for (const rel of ['scripts/readiness/run-browser-smoke.sh', 'scripts/readiness/run-production-rehearsal.sh']) {
      const src = read(rel);
      if (src == null) continue;
      const code = src.replace(/#[^\n]*/g, '');
      // Transition-вызовы в скриптах запрещены (rollout — ручная операция).
      if (/rollout\/transition/.test(code)) {
        v.push(`${rel} — автоматический rollout transition запрещён (§31.30)`);
      }
      // mdb.yandexcloud допустим ТОЛЬКО в защитном FATAL-guard'e.
      for (const line of code.split('\n')) {
        if (line.includes('mdb.yandexcloud') && !/FATAL|запрещ/i.test(line)) {
          v.push(`${rel} — production DSN вне защитного guard'а (§31.30)`);
        }
      }
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

const baseline = runRules(makeReader());
console.log('controlledAiRolloutSafety.check:');
if (baseline.length > 0) {
  console.error('\n  ✗ FORBIDDEN: инварианты controlled rollout нарушены.\n');
  for (const { name, viol } of baseline) console.error(`    - [${name}] ${viol}`);
  process.exit(1);
}
for (const [name] of RULES) console.log('  ok — ' + name);

// ─── Негативные self-check (§31): мутации в памяти ──────────────────────────
const realRead = makeReader();
const SELF_CHECKS = [
  ['rollout default pilot', F.migration,
    (s) => s.replace("rollout_mode text NOT NULL DEFAULT 'off'", "rollout_mode text NOT NULL DEFAULT 'pilot_individual'")],
  ['general availability mode', F.migration,
    (s) => s.replace("IN ('off', 'evaluation', 'pilot_individual', 'pilot_bulk')", "IN ('off', 'evaluation', 'pilot_individual', 'pilot_bulk', 'all')")],
  ['allowlist удалён', F.gateway,
    (s) => s.replace('member, err := s.rollout.GetActivePilotMembership(ctx, row.FeatureCode, userID)', 'var member = &repository.AIPilotUser{IsActive: true}\n\tvar err error').replace('if member == nil {\n\t\treturn nil, AICapNotAllowed, nil\n\t}', '_ = member')],
  ['budget reservation удалена', F.usageRepo,
    (s) => s.replace('func (r *AISettingsRepo) ReserveUsage', 'func (r *AISettingsRepo) reserveUsageDisabled')],
  ['float accounting', F.usageRepo,
    (s) => s.replace('spentRat, ok1 := new(big.Rat).SetString(spent)', 'spentF, _ := strconv.ParseFloat(spent, 64); costFloat := spentF; _ = costFloat\n\tspentRat, ok1 := new(big.Rat).SetString(spent)').replace('new(big.Rat).Add(spentRat, amountRat).Cmp(budgetRat) > 0', 'float64(0) > 1 /* ParseFloat(cost */')],
  ['circuit удалён', F.rolloutRepo,
    (s) => s.replace('func (r *AISettingsRepo) CircuitAllowProbe', 'func (r *AISettingsRepo) circuitProbeDisabled')],
  ['emergency off удалён', F.routes,
    (s) => s.replace('r.Post("/api/v1/admin/ai/nomenclature/rollout/emergency-off", d.aiAdminH.RolloutEmergencyOff)', '')],
  ['stale response возвращается', F.gateway,
    (s) => s.replace('func (ls *AILiveSession) isStale', 'func (ls *AILiveSession) isStaleDisabled').replace('ls.staleDiscarded = true', 'ls.batches += 0')],
  ['execute вызывает провайдера', F.smartImport,
    (s) => s.replace('result, err := s.importer.BulkImport(ctx, repository.ImportInput{', 'if s.aiGateway != nil { _, _, _ = s.aiGateway.AcquireLiveSession(ctx, userID, 1, 1, "x") }\n\tresult, err := s.importer.BulkImport(ctx, repository.ImportInput{')],
  ['auto-select suggestion', F.panel,
    (s) => s.replace('useEffect(() => {\n    fetchAiNomenclatureCapability()', 'useEffect(() => {\n    if (suggest) { const r = suggest.rows[0]; if (r) confirmRow(r, r.candidates[0]?.id ?? \'\', \'ai_confirmed\', \'\'); }\n    fetchAiNomenclatureCapability()')],
  ['critical FP gate ослаблен', F.evalRunner,
    (s) => s.replace('m.CriticalFalsePos == 0', 'm.CriticalFalsePos <= 3')],
  ['raw prompt персистится', F.migration,
    (s) => s.replace('row_context_hash text NOT NULL', 'row_context_hash text NOT NULL,\n    raw_prompt text')],
];

let selfCheckFailures = 0;
console.log('\n  негативные self-check (§31):');
for (const [label, file, mutate] of SELF_CHECKS) {
  const original = realRead(file);
  if (original == null) {
    console.error(`    ✗ ${label}: файл ${file} не найден`);
    selfCheckFailures++;
    continue;
  }
  const mutated = mutate(original);
  if (mutated === original) {
    console.error(`    ✗ ${label}: мутация не применилась (guard рассинхронизирован)`);
    selfCheckFailures++;
    continue;
  }
  const caught = runRules(makeReader({ [file]: mutated }));
  if (caught.length === 0) {
    console.error(`    ✗ ${label}: ослабление НЕ поймано`);
    selfCheckFailures++;
  } else {
    console.log(`    ok — ${label} → пойман (${caught[0].name})`);
  }
}

if (selfCheckFailures > 0) {
  console.error(`\ncontrolledAiRolloutSafety.check: self-check failures: ${selfCheckFailures}`);
  process.exit(1);
}
console.log('\ncontrolledAiRolloutSafety.check: passed (30 rules + ' + SELF_CHECKS.length + ' negative self-checks)');
