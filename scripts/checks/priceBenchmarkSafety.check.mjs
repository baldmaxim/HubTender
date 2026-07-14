// Этап 1.2 source guard — run via tsx:
//   npx tsx scripts/checks/priceBenchmarkSafety.check.mjs
//
// Инварианты ценового бенчмарка:
//   1. метрика — authoritative total_amount (никакого client total);
//   2. commercial_markup / total_commercial_* НЕ участвуют в исторической цене;
//   3. никакого fuzzy/embedding/LLM matching в production-коде;
//   4. текущий тендер исключён из истории;
//   5. история: approved + calculated + current revision;
//   6. одна версия логического тендера (DISTINCT ON tender_number, version DESC);
//   7. detail endpoint не вызывается из каждой строки таблицы автоматически;
//   8. price anomaly не является blocker (движок не выдаёт severity/blocker);
//   9. frontend не меняет unit_rate по данным бенчмарка;
//  10. stale текущий расчёт → fail-closed (не классифицируется как актуальный).

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

// ─── 1/2/4/5/6: исторический SQL ─────────────────────────────────────────────
{
  const rel = 'backend/internal/repository/price_benchmark.go';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    // 1. метрика от total_amount
    if (!/total_amount\s*\/\s*bi\.quantity|bi\.total_amount\s*\/\s*bi\.quantity/.test(code)) {
      violations.push(`${rel} — метрика больше не total_amount/quantity`);
    }
    // 2. commercial поля не участвуют
    const comm = /commercial_markup|total_commercial_material_cost|total_commercial_work_cost/.exec(code);
    if (comm) {
      violations.push(`${rel}:${lineOf(code, comm.index)} — commercial-поле в исторической цене`);
    }
    // 4. текущий тендер исключён
    if (!/t\.id\s*<>\s*\$1/.test(code)) {
      violations.push(`${rel} — текущий тендер не исключён из истории (t.id <> $1)`);
    }
    // 5. approved + calculated + current revision
    for (const needle of [
      'financial_approved = true',
      "financial_calculation_status = 'calculated'",
      'financial_calculation_revision = t.financial_input_revision',
    ]) {
      if (!code.includes(needle)) {
        violations.push(`${rel} — история потеряла фильтр: ${needle}`);
      }
    }
    // 6. одна версия логического тендера
    if (!/DISTINCT ON \(t\.tender_number\)/.test(code)) {
      violations.push(`${rel} — версии логического тендера больше не схлопываются (DISTINCT ON tender_number)`);
    }
  }
}

// ─── 3: никакого fuzzy/LLM в production-коде бенчмарка ──────────────────────
{
  for (const rel of [
    'backend/internal/analytics/pricebenchmark/engine.go',
    'backend/internal/analytics/pricebenchmark/types.go',
    'backend/internal/repository/price_benchmark.go',
    'backend/internal/services/price_benchmark.go',
  ]) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /levenshtein|similarity\(|embedding|openai|anthropic|fuzzy|pg_trgm/i.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — fuzzy/LLM matching в MVP запрещён`);
    }
    // description-only fallback запрещён: ключ обязан требовать nameID
  }
  const engine = read('backend/internal/analytics/pricebenchmark/engine.go');
  if (engine != null) {
    const code = stripComments(engine);
    const fn = /func BuildPriceBenchmarkKey[\s\S]*?\n}/.exec(code);
    if (!fn || !fn[0].includes('нет номенклатурной привязки')) {
      violations.push('backend/internal/analytics/pricebenchmark/engine.go — ключ больше не требует номенклатурный ID (description-fallback?)');
    }
  }
}

// ─── 8: аномалия не blocker ──────────────────────────────────────────────────
{
  const engine = read('backend/internal/analytics/pricebenchmark/engine.go');
  if (engine != null && /blocker/i.test(stripComments(engine).replace(/НИКОГДА не blocker|не blocker/gi, ''))) {
    // допускаем только упоминание в отрицании; любое присваивание blocker — нарушение
    const code = stripComments(engine);
    const m = /Severity\s*[:=]\s*"?blocker|StatusBlocker/i.exec(code);
    if (m) {
      violations.push(`engine.go:${lineOf(code, m.index)} — бенчмарк выдаёт blocker`);
    }
  }
  const policy = read('src/lib/quality/benchmarkPolicy.ts');
  if (policy != null) {
    const code = stripComments(policy);
    if (!/isBlockingStatus[\s\S]{0,120}?false/.test(code)) {
      violations.push('src/lib/quality/benchmarkPolicy.ts — isBlockingStatus больше не всегда false');
    }
  }
}

// ─── 7/9: frontend — нет per-row auto detail, нет мутаций ставки ────────────
{
  const rel = 'src/pages/PriceBenchmark/PriceBenchmark.tsx';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    // 7. detail загружается ТОЛЬКО по клику (не в render/effect списка)
    const eff = /useEffect\([\s\S]{0,400}?fetchBenchmarkHistory/.exec(code);
    if (eff) {
      violations.push(`${rel}:${lineOf(code, eff.index)} — detail endpoint вызывается автоматически (N+1)`);
    }
    // 9. никакого изменения ставки
    const mut = /updateBoqItem|patch.*unit_rate|unit_rate\s*[:=][^=]/i.exec(code);
    if (mut) {
      violations.push(`${rel}:${lineOf(code, mut.index)} — frontend меняет unit_rate по бенчмарку`);
    }
  }
}

// ─── 10: stale current → fail-closed в сервисе ───────────────────────────────
{
  const rel = 'backend/internal/services/price_benchmark.go';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    if (!/CalcStatus != "calculated" \|\| snap\.CalcRev != snap\.InputRev/.test(code)) {
      violations.push(`${rel} — stale текущий расчёт больше не отклоняется (fail-closed gate потерян)`);
    }
    if (!code.includes('FinancialCalculationNotReadyError')) {
      violations.push(`${rel} — 409-gate не использует typed not-ready ошибку`);
    }
  }
}

console.log('priceBenchmarkSafety.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: инварианты ценового бенчмарка нарушены.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — метрика authoritative total_amount/quantity; commercial-поля исключены');
console.log('  ok — история: без текущего тендера, approved+calculated+current, одна версия');
console.log('  ok — точный catalog-key (без fuzzy/LLM/description-fallback)');
console.log('  ok — аномалия не blocker; frontend не меняет ставки; detail только по клику');
console.log('  ok — stale текущий расчёт → fail-closed 409');
console.log('\npriceBenchmarkSafety.check: passed');
