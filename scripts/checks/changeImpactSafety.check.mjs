// Этап 1.5 source guard — run via tsx:
//   npx tsx scripts/checks/changeImpactSafety.check.mjs
//
// Инварианты сравнения версий:
//   1. analytics строго read-only (RR READ ONLY, без DB-мутаций);
//   2. никаких calculation_runs/новых snapshot/diff-таблиц;
//   3. никакого fuzzy/embedding/LLM matching (включая similarity);
//   4. client totals не используются;
//   5. только authoritative total_amount/commercial поля;
//   6. current и baseline financial state проверяются;
//   7. baseline — тот же tender_number и строго более ранняя версия;
//   8. дубли exact-ключа не связываются случайно (группа);
//   9. bridge включает страхование РОВНО один раз;
//  10. redistribution prepared values не входят в bridge;
//  11. config changes не получают вымышленной денежной дельты;
//  12. reconciliation residual не скрывается в «прочее»;
//  13. endpoint не запускает recalc;
//  14. frontend не изменяет BOQ;
//  15. UI не выдаёт field change за доказанную финансовую причину.

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

const ENGINE_FILES = [
  'backend/internal/analytics/changeimpact/types.go',
  'backend/internal/analytics/changeimpact/keys.go',
  'backend/internal/analytics/changeimpact/engine.go',
  'backend/internal/analytics/changeimpact/summary.go',
  'backend/internal/analytics/changeimpact/fields.go',
  'backend/internal/analytics/changeimpact/baseline.go',
];
const BACKEND_FILES = [
  ...ENGINE_FILES,
  'backend/internal/repository/change_impact.go',
  'backend/internal/services/change_impact.go',
  'backend/internal/handlers/change_impact.go',
];

// ─── 1/2/13: read-only, без новых таблиц, без recalc ─────────────────────────
{
  const repo = read('backend/internal/repository/change_impact.go');
  if (repo != null) {
    const code = stripComments(repo);
    if (!code.includes('AccessMode: pgx.ReadOnly') || !code.includes('IsoLevel: pgx.RepeatableRead')) {
      violations.push('repository/change_impact.go — снапшот больше не REPEATABLE READ READ ONLY');
    }
  }
  for (const rel of BACKEND_FILES) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|CREATE\s+TABLE|calculation_runs)\b/i.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — read-only нарушен (${m[1]})`);
    }
    const rc = /RecalcTenderCommercial|MarkTenderFinancialInputsChanged|ApproveFinancial/.exec(code);
    if (rc) {
      violations.push(`${rel}:${lineOf(code, rc.index)} — recalc/approval из аналитики запрещён`);
    }
  }
}

// ─── 3: без fuzzy/similarity/LLM ─────────────────────────────────────────────
{
  for (const rel of BACKEND_FILES) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /levenshtein|similarity|embedding|openai|anthropic|\bllm\b|fuzzy/i.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — fuzzy/LLM matching запрещён (только exact)`);
    }
  }
}

// ─── 4/5/10: authoritative money, без client totals/redistribution ───────────
{
  for (const rel of ENGINE_FILES.concat(['backend/internal/repository/change_impact.go'])) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /client_total|clientTotal|redistribution_result|prepared_redistribution|cost_redistribution/i.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — client totals/redistribution prepared в bridge запрещены`);
    }
  }
  const repo = read('backend/internal/repository/change_impact.go');
  if (repo != null) {
    const code = stripComments(repo);
    for (const needle of ['total_amount', 'total_commercial_material_cost', 'total_commercial_work_cost', 'cached_grand_total']) {
      if (!code.includes(needle)) {
        violations.push(`repository/change_impact.go — authoritative поле потеряно: ${needle}`);
      }
    }
  }
}

// ─── 6/7: financial state + baseline policy ──────────────────────────────────
{
  const svc = read('backend/internal/services/change_impact.go');
  if (svc != null) {
    const code = stripComments(svc);
    if (!/CalcStatus != "calculated" \|\| curT\.CalcRev != curT\.InputRev/.test(code)) {
      violations.push('services/change_impact.go — gate готовности current потерян');
    }
  }
  const baseline = read('backend/internal/analytics/changeimpact/baseline.go');
  if (baseline != null) {
    const code = stripComments(baseline);
    if (!/cand\.TenderNumber != cur\.TenderNumber/.test(code) ||
      !/cand\.Version >= cur\.Version/.test(code) ||
      !/!cand\.Approved/.test(code) ||
      !/cand\.CalcStatus != "calculated" \|\| cand\.CalcRev != cand\.InputRev/.test(code)) {
      violations.push('baseline.go — правила baseline (same number / earlier / approved / ready) потеряны');
    }
  }
}

// ─── 8: дубли не связываются случайно ────────────────────────────────────────
{
  const engine = read('backend/internal/analytics/changeimpact/engine.go');
  if (engine != null) {
    const code = stripComments(engine);
    if (!/len\(cs\) == 1 && len\(bs\) == 1/.test(code) || !code.includes('ambiguousGroup')) {
      violations.push('engine.go — matched-пары больше не ограничены 1↔1 (дубли могут связываться случайно)');
    }
    if (!code.includes('StatusAmbiguousGroup')) {
      violations.push('engine.go — AMBIGUOUS_GROUP потерян');
    }
  }
}

// ─── 9: страхование в bridge ровно один раз ──────────────────────────────────
{
  const engine = read('backend/internal/analytics/changeimpact/engine.go');
  if (engine != null) {
    const code = stripComments(engine);
    const matches = code.match(/Code: "INSURANCE"/g) || [];
    if (matches.length !== 1) {
      violations.push(`engine.go — insurance bridge-компонент встречается ${matches.length} раз (нужен ровно 1)`);
    }
    const ins = code.match(/insuranceDelta\(/g) || [];
    if (ins.length !== 1) { // ровно один вызов в Compare (объявление — summary.go)
      violations.push(`engine.go — insuranceDelta вызывается ${ins.length} раз (нужен ровно 1)`);
    }
  }
}

// ─── 11: config без вымышленной денежной дельты ─────────────────────────────
{
  const types = read('backend/internal/analytics/changeimpact/types.go');
  if (types != null) {
    const code = stripComments(types);
    const block = /type ConfigChange struct[\s\S]*?\n}/.exec(code);
    if (!block || /Delta|Amount|Impact/i.test(block[0])) {
      violations.push('types.go — ConfigChange не может нести денежную дельту (§8)');
    }
  }
  const fields = read('backend/internal/analytics/changeimpact/fields.go');
  if (fields != null && /ConfigChange\{[\s\S]{0,300}?(Delta|Amount)\s*:/.test(stripComments(fields))) {
    violations.push('fields.go — config change получает денежную дельту');
  }
}

// ─── 12: residual не прячется ────────────────────────────────────────────────
{
  const engine = read('backend/internal/analytics/changeimpact/engine.go');
  if (engine != null) {
    const code = stripComments(engine);
    if (!code.includes('ReconciliationResidual') || !code.includes('ReconciliationMismatch')) {
      violations.push('engine.go — residual/mismatch статус потерян');
    }
    if (/Code: "OTHER"|Label: "Прочее"/i.test(code)) {
      violations.push('engine.go — residual прячется в категорию «прочее»');
    }
  }
}

// ─── 14/15: frontend read-only + без causal attribution ─────────────────────
{
  const api = read('src/lib/api/changeImpact.ts');
  if (api != null) {
    const code = stripComments(api);
    const m = /method:\s*'(POST|PATCH|PUT|DELETE)'/i.exec(code);
    if (m) {
      violations.push(`changeImpact.ts:${lineOf(code, m.index)} — frontend не может изменять данные`);
    }
  }
  const page = read('src/pages/ChangeImpact/ChangeImpact.tsx');
  if (page != null) {
    const code = stripComments(page);
    const m = /updateBoqItem|updateBoqQuoteSource|apiFetch\([^)]*method/i.exec(code);
    if (m) {
      violations.push(`ChangeImpact.tsx:${lineOf(code, m.index)} — страница изменяет BOQ`);
    }
  }
  const policy = read('src/lib/quality/changeImpactPolicy.ts');
  if (policy != null) {
    const code = stripComments(policy);
    if (!code.includes('Одновременно изменено')) {
      violations.push('changeImpactPolicy.ts — формулировка «одновременно изменено» потеряна (§13)');
    }
    if (/причина изменения|увеличил итог ровно/i.test(code)) {
      violations.push('changeImpactPolicy.ts — недоказанная causal-формулировка');
    }
  }
}

console.log('changeImpactSafety.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: инварианты сравнения версий нарушены.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — read-only (RR READ ONLY); без calculation_runs/новых таблиц; без recalc');
console.log('  ok — exact matching без fuzzy/LLM; дубли только группой');
console.log('  ok — authoritative money; без client totals/redistribution prepared');
console.log('  ok — current/baseline готовность проверяются; baseline того же номера и раньше');
console.log('  ok — insurance в bridge один раз; residual не прячется; config без вымышленных дельт');
console.log('  ok — frontend read-only; без недоказанной causal attribution');
console.log('\nchangeImpactSafety.check: passed');
