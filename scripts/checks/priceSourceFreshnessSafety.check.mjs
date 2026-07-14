// Этап 1.3 source guard — run via tsx:
//   npx tsx scripts/checks/priceSourceFreshnessSafety.check.mjs
//
// Инварианты актуальности источников цен:
//   1. created_at/updated_at НЕ используются как дата цены;
//   2. endpoint строго read-only (RR READ ONLY, никаких INSERT/UPDATE/DELETE);
//   3. правка source-метаданных не пишет unit_rate/total_amount/quantity;
//   4. metadata-only patch НЕ двигает financial_input_revision (gate вокруг Mark);
//   5. as-of date — только серверная (CURRENT_DATE в repo, без client-параметра);
//   6. unsafe URL (javascript:/data:/file:) блокируются на бэке и фронте;
//   7. amount-метрики закрыты при stale/несовпадении ревизий;
//   8. ни один статус источника не blocker;
//   9. никакого OCR/AI/LLM/внешних цен в production-коде этапа;
//  10. никакой новой универсальной таблицы источников (вариант B: boq_items).

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

// ─── 1/2/5: repo — read-only, server as-of, без created_at/updated_at ────────
{
  const rel = 'backend/internal/repository/price_source_quality.go';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    const ts = /\b(created_at|updated_at)\b/.exec(code);
    if (ts) {
      violations.push(`${rel}:${lineOf(code, ts.index)} — created_at/updated_at не могут быть датой цены`);
    }
    const wr = /\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i.exec(code);
    if (wr) {
      violations.push(`${rel}:${lineOf(code, wr.index)} — analytics endpoint должен быть read-only`);
    }
    if (!code.includes('AccessMode: pgx.ReadOnly') || !code.includes('IsoLevel: pgx.RepeatableRead')) {
      violations.push(`${rel} — снапшот больше не REPEATABLE READ READ ONLY`);
    }
    if (!code.includes('CURRENT_DATE')) {
      violations.push(`${rel} — as-of date больше не серверная (CURRENT_DATE потерян)`);
    }
  }
  const engine = read('backend/internal/analytics/pricesource/engine.go');
  if (engine != null) {
    const code = stripComments(engine);
    const ts = /\b(CreatedAt|UpdatedAt|created_at|updated_at)\b/.exec(code);
    if (ts) {
      violations.push(`engine.go:${lineOf(code, ts.index)} — движок читает created_at/updated_at как дату цены`);
    }
  }
  // 5b: handler не принимает клиентскую as-of дату
  const handler = read('backend/internal/handlers/price_source.go');
  if (handler != null) {
    const code = stripComments(handler);
    const m = /Query\(\)\.Get\("(as_of|as_of_date|date|today)"\)|time\.Now\(\)/.exec(code);
    if (m) {
      violations.push(`price_source.go(handler):${lineOf(code, m.index)} — клиентское «сегодня» не может быть authority`);
    }
  }
}

// ─── 3: правка source-метаданных не трогает деньги ───────────────────────────
{
  const rel = 'src/lib/api/priceSource.ts';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    const fn = /function updateBoqQuoteSource[\s\S]*?\n}/.exec(code);
    if (!fn) {
      violations.push(`${rel} — updateBoqQuoteSource пропал (guard must be kept in sync)`);
    } else if (/unit_rate|total_amount|quantity|currency/.test(fn[0])) {
      violations.push(`${rel} — правка источника отправляет финансовые поля`);
    }
  }
}

// ─── 4: metadata-only patch не двигает ревизию ───────────────────────────────
{
  const rel = 'backend/internal/repository/boq_mutate.go';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    if (!/if\s+!isQuoteMetadataOnlyPatch\(&in\)\s*\{[\s\S]{0,200}?MarkTenderFinancialInputsChangedTx/.test(code)) {
      violations.push(`${rel} — MarkTenderFinancialInputsChangedTx больше не обёрнут в !isQuoteMetadataOnlyPatch`);
    }
    if (!code.includes('func isQuoteMetadataOnlyPatch') || !code.includes('func validateQuoteDates')) {
      violations.push(`${rel} — helpers metadata-only patch / валидации дат отсутствуют`);
    }
  }
}

// ─── 6: unsafe URL блокируются на бэке и фронте ──────────────────────────────
{
  const engine = read('backend/internal/analytics/pricesource/engine.go');
  if (engine != null) {
    const code = stripComments(engine);
    const fn = /func SafeSourceURL[\s\S]*?\n}/.exec(code);
    if (!fn || !/case "https", "http":/.test(fn[0]) || /javascript|"data"|"file"/.test(fn[0])) {
      violations.push('engine.go — SafeSourceURL больше не allow-list https/http');
    }
  }
  const policy = read('src/lib/quality/sourcePolicy.ts');
  if (policy != null) {
    const code = stripComments(policy);
    if (!/protocol === 'https:' \|\| u\.protocol === 'http:'/.test(code)) {
      violations.push('sourcePolicy.ts — safeSourceUrl больше не allow-list https/http');
    }
  }
  const page = read('src/pages/PriceSourceQuality/PriceSourceQuality.tsx');
  if (page != null) {
    const code = stripComments(page);
    if (!code.includes('rel="noopener noreferrer"') || !code.includes('safeSourceUrl(')) {
      violations.push('PriceSourceQuality.tsx — внешняя ссылка без safeSourceUrl/noopener noreferrer');
    }
  }
}

// ─── 7: amount-метрики закрыты при неактуальном расчёте ──────────────────────
{
  const engine = read('backend/internal/analytics/pricesource/engine.go');
  if (engine != null) {
    const code = stripComments(engine);
    if (!/amountAvailable\s*:=\s*calcStatus == "calculated" && calcRev == inputRev/.test(code)) {
      violations.push('engine.go — gate amount-метрик (calculated + revisions match) потерян');
    }
    if (!/AmountMetricsStatus\s*=\s*"unavailable"/.test(code)) {
      violations.push('engine.go — unavailable-ветка amount-метрик потеряна');
    }
  }
}

// ─── 8: статус источника никогда не blocker ──────────────────────────────────
{
  const engine = read('backend/internal/analytics/pricesource/engine.go');
  if (engine != null) {
    const code = stripComments(engine);
    const m = /Severity\s*[:=]\s*"?blocker|SeverityBlocker/i.exec(code);
    if (m) {
      violations.push(`engine.go:${lineOf(code, m.index)} — источник цены выдаёт blocker`);
    }
  }
  const policy = read('src/lib/quality/sourcePolicy.ts');
  if (policy != null) {
    const code = stripComments(policy);
    if (!/isSourceBlockingStatus[\s\S]{0,160}?return false/.test(code)) {
      violations.push('sourcePolicy.ts — isSourceBlockingStatus больше не всегда false');
    }
  }
}

// ─── 9: никакого OCR/AI/LLM/внешних цен ──────────────────────────────────────
{
  for (const rel of [
    'backend/internal/analytics/pricesource/engine.go',
    'backend/internal/repository/price_source_quality.go',
    'backend/internal/services/price_source.go',
    'backend/internal/handlers/price_source.go',
    'src/lib/api/priceSource.ts',
    'src/lib/quality/sourcePolicy.ts',
    'src/pages/PriceSourceQuality/PriceSourceQuality.tsx',
  ]) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /\bocr\b|pdf.?pars|tesseract|openai|anthropic|llm|embedding|market.?price|внешн\w* цен/i.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — OCR/AI/внешние цены запрещены в MVP`);
    }
  }
}

// ─── 10: никакой новой универсальной таблицы источников ──────────────────────
{
  const rel = 'db/yandex/incremental/2026_07_boq_quote_source_dates.sql';
  const raw = read(rel);
  if (raw != null) {
    const m = /CREATE\s+TABLE/i.exec(raw);
    if (m) {
      violations.push(`${rel}:${lineOf(raw, m.index)} — новая таблица источников запрещена (вариант B: boq_items)`);
    }
    for (const col of ['quote_price_date', 'quote_valid_until', 'boq_items_quote_dates_check']) {
      if (!raw.includes(col)) {
        violations.push(`${rel} — миграция потеряла ${col}`);
      }
    }
  }
}

console.log('priceSourceFreshnessSafety.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: инварианты источников цен нарушены.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — created_at/updated_at не подменяют дату цены; as-of только серверная');
console.log('  ok — endpoint read-only (REPEATABLE READ READ ONLY)');
console.log('  ok — source-метаданные не пишут деньги; metadata-only patch не двигает ревизию');
console.log('  ok — unsafe URL блокируются (бэк + фронт + noopener noreferrer)');
console.log('  ok — amount-метрики закрыты при неактуальном расчёте; статусы не blocker');
console.log('  ok — без OCR/AI/внешних цен; без новой таблицы источников');
console.log('\npriceSourceFreshnessSafety.check: passed');
