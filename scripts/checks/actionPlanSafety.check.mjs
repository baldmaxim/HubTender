// Этап 1.4 source guard — run via tsx:
//   npx tsx scripts/checks/actionPlanSafety.check.mjs
//
// Инварианты плана действий:
//   1. Action Plan строго read-only (RR READ ONLY, без DB-мутаций);
//   2. никаких INSERT/UPDATE/DELETE action/task-записей и mutation-роутов;
//   3. никакого LLM/embedding/fuzzy merge;
//   4. не запускается financial recalc;
//   5. не меняется approval;
//   6. blocking приходит ТОЛЬКО из quality blocker-семантики;
//   7. price anomaly не становится blocker;
//   8. source freshness не становится blocker;
//   9. amount summary не использует commercial/markup/insurance;
//  10. одна BOQ-строка не суммируется дважды (union-семантика);
//  11. frontend не сохраняет action completion;
//  12. frontend использует server rank (никакого клиентского score);
//  13. существующие движки переиспользуются, их математика не копируется;
//  14. никаких HTTP-вызовов собственных analytics endpoints из backend;
//  15. никакого N+1 detail loading для списка действий.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const violations = [];
const lineOf = (t, i) => t.slice(0, i).split('\n').length;

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
function read(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    violations.push(`${rel} — file missing (guard must be kept in sync)`);
    return null;
  }
  return readFileSync(abs, 'utf8');
}

const BACKEND_FILES = [
  'backend/internal/analytics/actionplan/types.go',
  'backend/internal/analytics/actionplan/engine.go',
  'backend/internal/repository/action_plan.go',
  'backend/internal/services/action_plan.go',
  'backend/internal/handlers/action_plan.go',
];

// ─── 1/2: read-only, никаких мутаций и mutation-роутов ───────────────────────
{
  const repo = read('backend/internal/repository/action_plan.go');
  if (repo != null) {
    const code = stripComments(repo);
    if (!code.includes('AccessMode: pgx.ReadOnly') || !code.includes('IsoLevel: pgx.RepeatableRead')) {
      violations.push('repository/action_plan.go — снапшот больше не REPEATABLE READ READ ONLY');
    }
  }
  for (const rel of BACKEND_FILES) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|CREATE\s+TABLE)\b/i.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — Action Plan должен быть read-only (${m[1]})`);
    }
  }
  const routes = read('backend/cmd/server/routes.go');
  if (routes != null) {
    const m = /r\.(Post|Patch|Put|Delete)\([^)]*action-plan/i.exec(stripComments(routes));
    if (m) {
      violations.push(`routes.go:${lineOf(stripComments(routes), m.index)} — mutation-роут для action plan запрещён`);
    }
  }
}

// ─── 3: никакого LLM/fuzzy merge ─────────────────────────────────────────────
{
  for (const rel of BACKEND_FILES) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /levenshtein|similarity\(|embedding|openai|anthropic|\bllm\b|fuzzy/i.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — LLM/fuzzy merge запрещён (только явные правила)`);
    }
  }
}

// ─── 4/5: не запускается recalc, не меняется approval ───────────────────────
{
  for (const rel of BACKEND_FILES) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const rc = /RecalcTenderCommercial|MarkTenderFinancialInputsChanged|MarkTenderCalculation/.exec(code);
    if (rc) {
      violations.push(`${rel}:${lineOf(code, rc.index)} — Action Plan не может запускать recalc/двигать ревизию`);
    }
    const appr = /ApproveFinancial|financial_approved\s*=/.exec(code);
    if (appr) {
      violations.push(`${rel}:${lineOf(code, appr.index)} — Action Plan не может менять approval`);
    }
  }
}

// ─── 6/7/8: blocking только от quality ───────────────────────────────────────
{
  const engine = read('backend/internal/analytics/actionplan/engine.go');
  if (engine != null) {
    const code = stripComments(engine);
    const fnOutlier = /func benchmarkOutlierAction[\s\S]*?\n}/.exec(code);
    if (!fnOutlier || fnOutlier[0].includes('PriorityBlocking')) {
      violations.push('engine.go — price anomaly не может быть blocking (правило §5)');
    }
    const fnIdentity = /func benchmarkIdentityAction[\s\S]*?\n}/.exec(code);
    if (fnIdentity && fnIdentity[0].includes('PriorityBlocking')) {
      violations.push('engine.go — benchmark identity action не может быть blocking');
    }
    const srcPlan = /var sourceStatusPlan[\s\S]*?\n}/.exec(code);
    if (!srcPlan || srcPlan[0].includes('PriorityBlocking')) {
      violations.push('engine.go — source freshness не может быть blocking (правило §5)');
    }
    const fnSource = /func sourceAction[\s\S]*?\n}/.exec(code);
    if (fnSource && fnSource[0].includes('PriorityBlocking')) {
      violations.push('engine.go — sourceAction не может назначать blocking');
    }
    // blocking назначается только в quality-ветке (SeverityBlocker).
    if (!/case quality\.SeverityBlocker:\s*\n\s*prio = PriorityBlocking/.test(code)) {
      violations.push('engine.go — blocking больше не привязан к quality.SeverityBlocker');
    }
  }
}

// ─── 9: amount без commercial/markup/insurance ───────────────────────────────
{
  for (const rel of BACKEND_FILES) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /total_commercial|commercial_markup|TotalCommercial|insurance|markup_percent/i.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — amount не может считаться из commercial/markup/insurance`);
    }
  }
}

// ─── 10: union-семантика summary (строка один раз) ───────────────────────────
{
  const engine = read('backend/internal/analytics/actionplan/engine.go');
  if (engine != null) {
    const code = stripComments(engine);
    const fn = /func Summarize[\s\S]*?\n}/.exec(code);
    if (!fn ||
      !/for _, id := range a\.BoqItemIDs \{\s*\n\s*itemSet\[id\] = true/.test(fn[0]) ||
      !/for id := range itemSet \{\s*\n\s*sum \+= itemAmount\[id\]/.test(fn[0])) {
      violations.push('engine.go — union-семантика summary amount потеряна (строка может суммироваться дважды)');
    }
  }
}

// ─── 11/12: frontend — без completion, server rank без score ────────────────
{
  const api = read('src/lib/api/actionPlan.ts');
  if (api != null) {
    const code = stripComments(api);
    const m = /method:\s*'(POST|PATCH|PUT|DELETE)'|complete|dismiss|acknowledge/i.exec(code);
    if (m) {
      violations.push(`actionPlan.ts:${lineOf(code, m.index)} — frontend не может сохранять completion/мутировать план`);
    }
  }
  const policy = read('src/lib/quality/actionPlanPolicy.ts');
  const page = read('src/pages/ActionPlan/ActionPlan.tsx');
  for (const [rel, raw] of [['actionPlanPolicy.ts', policy], ['ActionPlan.tsx', page]]) {
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /score/i.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — клиентский score запрещён (server rank)`);
    }
    const cb = /Checkbox|выполнено/i.exec(code);
    if (cb) {
      violations.push(`${rel}:${lineOf(code, cb.index)} — completion-элементы запрещены`);
    }
  }
  if (policy != null && !stripComments(policy).includes('a.rank < best.rank')) {
    violations.push('actionPlanPolicy.ts — nextAction больше не выбирается по server rank');
  }
}

// ─── 13: движки переиспользуются, математика не копируется ───────────────────
{
  const svc = read('backend/internal/services/action_plan.go');
  if (svc != null) {
    const code = stripComments(svc);
    for (const needle of ['quality.Evaluate(', 'pb.Evaluate(', 'ps.Evaluate(', 'ap.Compose(']) {
      if (!code.includes(needle)) {
        violations.push(`services/action_plan.go — переиспользование движка потеряно: ${needle}`);
      }
    }
  }
  const engine = read('backend/internal/analytics/actionplan/engine.go');
  if (engine != null) {
    const code = stripComments(engine);
    const m = /percentile|IQR|[Ff]ence|Tukey|time\.Parse|CURRENT_DATE/.exec(code);
    if (m) {
      violations.push(`engine.go:${lineOf(code, m.index)} — аналитическая математика скопирована в композицию`);
    }
  }
}

// ─── 14: без HTTP-to-HTTP orchestration ──────────────────────────────────────
{
  for (const rel of [
    'backend/internal/analytics/actionplan/engine.go',
    'backend/internal/repository/action_plan.go',
    'backend/internal/services/action_plan.go',
  ]) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /http\.(Get|Post|NewRequest)|\/api\/v1\//.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — backend не может вызывать собственные HTTP endpoints`);
    }
  }
}

// ─── 15: без N+1 detail loading ──────────────────────────────────────────────
{
  const svc = read('backend/internal/services/action_plan.go');
  const handler = read('backend/internal/handlers/action_plan.go');
  for (const [rel, raw] of [['services/action_plan.go', svc], ['handlers/action_plan.go', handler]]) {
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /ItemHistory|fetchBenchmarkHistory|LoadSnapshot\(/.exec(code);
    if (m && m[0] !== 'LoadSnapshots(') {
      violations.push(`${rel}:${lineOf(code, m.index)} — detail/per-item загрузка в списке плана запрещена (N+1)`);
    }
  }
  const repo = read('backend/internal/repository/action_plan.go');
  if (repo != null) {
    const code = stripComments(repo);
    if (/for\s[\s\S]{0,200}?tx\.Query/.test(code)) {
      violations.push('repository/action_plan.go — запрос в цикле (N+1) запрещён');
    }
  }
}

console.log('actionPlanSafety.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: инварианты плана действий нарушены.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — read-only (RR READ ONLY), без мутаций и mutation-роутов');
console.log('  ok — без LLM/fuzzy merge; без recalc; approval не трогается');
console.log('  ok — blocking только из quality; outlier/source не blocker');
console.log('  ok — amount из authoritative total_amount, union без двойного учёта');
console.log('  ok — frontend без completion/клиентского score; server rank');
console.log('  ok — движки переиспользуются; без HTTP-to-HTTP; без N+1 detail');
console.log('\nactionPlanSafety.check: passed');
