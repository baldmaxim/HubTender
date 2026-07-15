// Этап 1.6 source guard — run via tsx:
//   npx tsx scripts/checks/reviewPackSafety.check.mjs
//
// Инварианты «Отчёта для проверки»:
//   1-3. read-only: без persistence-таблиц отчётов и DB-мутаций;
//   4. без HTTP-to-HTTP backend orchestration;
//   5. переиспользуются существующие engines/loaders;
//   6-7. renderer без финансовых формул и без SetCellFormula;
//   8. XLSX строится на backend (frontend не собирает Excel);
//   9. calculation-state gate перед download;
//  10. quality blockers НЕ блокируют download;
//  11. baseline unavailable не валит весь отчёт;
//  12. SafeExcelText применяется к user-controlled тексту;
//  13. unsafe source URL не становится hyperlink;
//  14. fingerprint зависит от revision и параметров;
//  15. frontend не пересчитывает executive summary;
//  16. без PDF/LLM/external fetch;
//  17. без N+1 detail loading;
//  18. отчёт не меняет approval/recalc/status.

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
  'backend/internal/analytics/reviewpack/model.go',
  'backend/internal/analytics/reviewpack/safetext.go',
  'backend/internal/analytics/reviewpack/render.go',
  'backend/internal/analytics/reviewpack/sheets.go',
  'backend/internal/repository/review_pack.go',
  'backend/internal/services/review_pack.go',
  'backend/internal/handlers/review_pack.go',
];

// ─── 1-3/18: read-only, без persistence, без recalc/approval ────────────────
{
  const repo = read('backend/internal/repository/review_pack.go');
  if (repo != null) {
    const code = stripComments(repo);
    if (!code.includes('AccessMode: pgx.ReadOnly') || !code.includes('IsoLevel: pgx.RepeatableRead')) {
      violations.push('repository/review_pack.go — снапшот больше не REPEATABLE READ READ ONLY');
    }
  }
  for (const rel of BACKEND_FILES) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|CREATE\s+TABLE|report_history|review_reports)\b/i.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — read-only/persistence нарушен (${m[1]})`);
    }
    const rc = /RecalcTenderCommercial|MarkTenderFinancialInputsChanged|ApproveFinancial/.exec(code);
    if (rc) {
      violations.push(`${rel}:${lineOf(code, rc.index)} — отчёт не может запускать recalc/менять approval`);
    }
  }
}

// ─── 4/16: без HTTP-to-HTTP, без PDF/LLM/external fetch ──────────────────────
{
  for (const rel of BACKEND_FILES) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /http\.(Get|Post|NewRequest)|\bhttp\.Client\b/.exec(code);
    if (m && rel !== 'backend/internal/handlers/review_pack.go') {
      violations.push(`${rel}:${lineOf(code, m.index)} — внешние/внутренние HTTP-запросы при формировании отчёта запрещены`);
    }
    const bad = /\bpdf\b|wkhtmltopdf|chromedp|openai|anthropic|\bllm\b/i.exec(code);
    if (bad) {
      violations.push(`${rel}:${lineOf(code, bad.index)} — PDF/LLM/external запрещены в MVP`);
    }
  }
}

// ─── 5/17: переиспользование engines, без N+1 ────────────────────────────────
{
  const svc = read('backend/internal/services/review_pack.go');
  if (svc != null) {
    const code = stripComments(svc);
    for (const needle of ['quality.Evaluate(', 'pb.Evaluate(', 'ps.Evaluate(', 'ap.Compose(', 'ci.Compare(']) {
      if (!code.includes(needle)) {
        violations.push(`services/review_pack.go — переиспользование движка потеряно: ${needle}`);
      }
    }
    if (/ItemHistory|fetchBenchmarkHistory/.test(code)) {
      violations.push('services/review_pack.go — detail-загрузка per-item (N+1) запрещена');
    }
  }
  const repo = read('backend/internal/repository/review_pack.go');
  if (repo != null) {
    const code = stripComments(repo);
    for (const needle of ['loadQualitySnapshotTx', 'loadBenchmarkSnapshotTx', 'loadSourceSnapshotTx', 'loadChangeImpactSnapshotTx']) {
      if (!code.includes(needle)) {
        violations.push(`repository/review_pack.go — общий tx-loader потерян: ${needle}`);
      }
    }
    if (/for\s[\s\S]{0,200}?tx\.Query/.test(code)) {
      violations.push('repository/review_pack.go — запрос в цикле (N+1)');
    }
  }
}

// ─── 6-7: renderer без формул ────────────────────────────────────────────────
{
  for (const rel of ['backend/internal/analytics/reviewpack/render.go', 'backend/internal/analytics/reviewpack/sheets.go']) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /SetCellFormula|WriteFormula|AddFormula/.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — Excel-формулы запрещены (§16)`);
    }
    const sum = /=SUM\(|=AVERAGE\(|SUBTOTAL\(/i.exec(code);
    if (sum) {
      violations.push(`${rel}:${lineOf(code, sum.index)} — финансовая формула в renderer`);
    }
    // Пересчёт денег в renderer запрещён: money-поля модели не участвуют в
    // арифметике представления.
    const recompute = /\.(CachedGrandTotal|ImpactAmount|TotalAmount|Delta|Amount|Baseline|Current)\s*[*+/-]\s*[\d(]/.exec(code);
    if (recompute) {
      violations.push(`${rel}:${lineOf(code, recompute.index)} — renderer пересчитывает финансовые значения (формула представления)`);
    }
  }
}

// ─── 8/15: frontend без Excel-builder и без пересчёта summary ────────────────
{
  const api = read('src/lib/api/reviewPack.ts');
  const page = read('src/pages/ReviewPack/ReviewPack.tsx');
  for (const [rel, raw] of [['reviewPack.ts', api], ['ReviewPack.tsx', page]]) {
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /from 'xlsx'|xlsx-js-style|XLSX\.utils|book_new/.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — XLSX должен строиться на backend`);
    }
  }
  if (page != null) {
    const code = stripComments(page);
    if (/(blockers|high_actions|amount_requiring_review)\s*[+\-*]=|\.reduce\(/.test(code)) {
      violations.push('ReviewPack.tsx — executive summary пересчитывается на frontend');
    }
  }
}

// ─── 9-11: gate готовности; blockers/baseline не блокируют ───────────────────
{
  const svc = read('backend/internal/services/review_pack.go');
  if (svc != null) {
    const code = stripComments(svc);
    if (!/CalcStatus != "calculated" \|\| src\.CalcRev != src\.InputRev/.test(code)) {
      violations.push('services/review_pack.go — calculation-state gate перед download потерян');
    }
    if (/Blockers\s*>\s*0[\s\S]{0,120}?(return nil,|NotReady)/.test(code)) {
      violations.push('services/review_pack.go — quality blockers ошибочно блокируют download');
    }
    if (!code.includes('BaselineNotAvailableReport')) {
      violations.push('services/review_pack.go — baseline unavailable должен давать section, не ошибку');
    }
  }
  const model = read('backend/internal/analytics/reviewpack/model.go');
  if (model != null && !stripComments(model).includes('SectionBaselineNA')) {
    violations.push('model.go — статус baseline_not_available потерян');
  }
}

// ─── 12: SafeExcelText применяется к user-тексту ─────────────────────────────
{
  const safetext = read('backend/internal/analytics/reviewpack/safetext.go');
  if (safetext != null) {
    const code = stripComments(safetext);
    if (!code.includes('func SafeExcelText')) {
      violations.push('safetext.go — SafeExcelText потерян');
    }
    if (!/case '=', '\+', '-', '@':/.test(code)) {
      violations.push('safetext.go — список опасных префиксов (= + - @) потерян');
    }
  }
  const render = read('backend/internal/analytics/reviewpack/render.go');
  if (render != null) {
    const code = stripComments(render);
    if (!/SetCellStr\(sheet, cell\(col, row\), SafeExcelText\(v\)\)/.test(code)) {
      violations.push('render.go — setText больше не проходит через SafeExcelText');
    }
  }
  const sheets = read('backend/internal/analytics/reviewpack/sheets.go');
  if (sheets != null) {
    const code = stripComments(sheets);
    const raw = /f\.SetCellStr\([^)]*\)/.exec(code);
    if (raw) { // все строки должны идти через c.setText (SafeExcelText)
      violations.push(`sheets.go:${lineOf(code, raw.index)} — прямой SetCellStr в обход SafeExcelText`);
    }
  }
}

// ─── 13: unsafe URL не hyperlink ─────────────────────────────────────────────
{
  const sheets = read('backend/internal/analytics/reviewpack/sheets.go');
  if (sheets != null) {
    const code = stripComments(sheets);
    if (!/if safe := ps\.SafeSourceURL\(row\.SourceURL\); safe != nil \{[\s\S]{0,200}?SetCellHyperLink/.test(code)) {
      violations.push('sheets.go — hyperlink источника больше не проходит SafeSourceURL allow-list');
    }
    const links = code.match(/SetCellHyperLink/g) || [];
    if (links.length !== 1) {
      violations.push(`sheets.go — SetCellHyperLink встречается ${links.length} раз (ожидается ровно 1, за allow-list)`);
    }
  }
}

// ─── 14: fingerprint зависит от revision и параметров ────────────────────────
{
  const model = read('backend/internal/analytics/reviewpack/model.go');
  if (model != null) {
    const code = stripComments(model);
    const fn = /func Fingerprint[\s\S]*?\n}/.exec(code);
    if (!fn || !/rev=%d/.test(fn[0]) || !/period=%d/.test(fn[0]) || !/maxage=%d/.test(fn[0]) ||
      !/baseline=%s/.test(fn[0]) || /generated/i.test(fn[0])) {
      violations.push('model.go — fingerprint потерял revision/параметры или стал зависеть от generated_at');
    }
  }
}

console.log('reviewPackSafety.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: инварианты отчёта для проверки нарушены.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — read-only; без persistence/recalc/approval; без HTTP-to-HTTP/PDF/LLM');
console.log('  ok — engines/loaders переиспользуются; без N+1');
console.log('  ok — renderer без формул; SafeExcelText для user-текста; hyperlink только через allow-list');
console.log('  ok — XLSX на backend; frontend не пересчитывает summary');
console.log('  ok — calculation gate; blockers/baseline не блокируют download; fingerprint от revision+параметров');
console.log('\nreviewPackSafety.check: passed');
