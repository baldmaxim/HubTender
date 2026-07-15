// Этап 2.1 source guard — run via tsx:
//   npx tsx scripts/checks/smartBoqImportSafety.check.mjs
//
// Инварианты умного импорта:
//   1. Excel/client total не сохраняется как authority (только diagnostic);
//   2. execute повторно парсит workbook на backend;
//   3. fingerprint проверяется;
//   4. frontend-normalized rows не принимаются как persistence input;
//   5. client commercial fields не входят в mapping;
//   6. нет fuzzy/embedding/LLM matching;
//   7. нет description-only nomenclature fallback (только exact map lookup);
//   8. формулы не исполняются (нет evaluator);
//   9. macros не исполняются (.xlsm отклоняется);
//  10. нет FX fallback = 1;
//  11. импорт идёт через существующий authoritative import service;
//  12. parent validation переиспользует существующую domain policy;
//  13. нет N+1 nomenclature query;
//  14. workbook limits существуют;
//  15. temp-file cleanup: файл живёт только в памяти запроса;
//  16. preview (analyze) не запускает financial mutations;
//  17. нет upload/import-mapping persistence table;
//  18. frontend execute disabled при blockers.

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
  'backend/internal/importanalysis/types.go',
  'backend/internal/importanalysis/workbook.go',
  'backend/internal/importanalysis/normalize.go',
  'backend/internal/importanalysis/mapping.go',
  'backend/internal/importanalysis/analyze.go',
  'backend/internal/importanalysis/extract.go',
];

// ─── 1/5: client total только diagnostic; commercial не в mapping ────────────
{
  const svc = read('backend/internal/services/smart_import.go');
  if (svc != null) {
    const code = stripComments(svc);
    if (!/TotalAmount:\s*it\.ClientTotalDiagnostic/.test(code)) {
      violations.push('services/smart_import.go — клиентский total должен идти ТОЛЬКО в diagnostic TotalAmount');
    }
  }
  const types = read('backend/internal/importanalysis/types.go');
  if (types != null) {
    const code = stripComments(types);
    if (/commercial_markup|total_commercial_material|total_commercial_work|cached_grand_total/i.test(code)) {
      violations.push('types.go — commercial-поля не могут входить в import mapping');
    }
    if (!code.includes('FieldClientTotal')) {
      violations.push('types.go — diagnostic-поле клиентского total потеряно');
    }
  }
}

// ─── 2/3/4: execute = повторный серверный parse + fingerprint ────────────────
{
  const svc = read('backend/internal/services/smart_import.go');
  if (svc != null) {
    const code = stripComments(svc);
    if (!/if ia\.Fingerprint\(data\) != expectedFingerprint/.test(code)) {
      violations.push('services/smart_import.go — fingerprint check потерян');
    }
    if (!/an, err := s\.Analyze\(ctx, tenderID, (userID, )?fileName, data, opts\)/.test(code)) {
      violations.push('services/smart_import.go — execute больше не выполняет повторный серверный анализ');
    }
  }
  const handler = read('backend/internal/handlers/smart_import.go');
  if (handler != null) {
    const code = stripComments(handler);
    if (/normalized_rows|preview_rows/.test(code)) {
      violations.push('handlers/smart_import.go — normalized/preview rows от клиента запрещены как вход');
    }
    if (!code.includes('workbook_fingerprint')) {
      violations.push('handlers/smart_import.go — fingerprint параметр потерян');
    }
  }
}

// ─── 6/7: без fuzzy/LLM; nomenclature только exact map lookup ────────────────
{
  for (const rel of ENGINE_FILES) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /levenshtein|similarity|embedding|openai|anthropic|\bllm\b|fuzzy/i.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — fuzzy/LLM matching запрещён`);
    }
  }
  const normalize = read('backend/internal/importanalysis/normalize.go');
  if (normalize != null) {
    const code = stripComments(normalize);
    const fn = /func MatchNomenclature[\s\S]*?\n}/.exec(code);
    if (!fn || !/return byName\[normText\(raw\)\]/.test(fn[0])) {
      violations.push('normalize.go — MatchNomenclature больше не exact map lookup (fallback?)');
    }
  }
}

// ─── 8/9: формулы/macros не исполняются ──────────────────────────────────────
{
  const wbk = read('backend/internal/importanalysis/workbook.go');
  if (wbk != null) {
    const code = stripComments(wbk);
    if (/CalcCellValue|SetCellFormula|evaluate/i.test(code)) {
      violations.push('workbook.go — исполнение формул запрещено');
    }
    if (!code.includes('vbaProject')) {
      violations.push('workbook.go — защита от macro-enabled (.xlsm) потеряна');
    }
  }
  const extract = read('backend/internal/importanalysis/extract.go');
  if (extract != null) {
    const code = stripComments(extract);
    if (!code.includes('FORMULA_NO_CACHED_VALUE') || !code.includes('FORMULA_CACHED_VALUE')) {
      violations.push('extract.go — formula policy (§9) потеряна');
    }
  }
}

// ─── 10: нет FX fallback = 1 ─────────────────────────────────────────────────
{
  for (const rel of [...ENGINE_FILES, 'backend/internal/services/smart_import.go']) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /[Rr]ate\s*=\s*1\b|fallback.*rate|rate.*fallback/i.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — FX fallback = 1 запрещён`);
    }
  }
}

// ─── 11/12: существующий import service + parent policy ─────────────────────
{
  const svc = read('backend/internal/services/smart_import.go');
  if (svc != null) {
    const code = stripComments(svc);
    if (!/s\.importer\.BulkImport\(ctx, repository\.ImportInput\{/.test(code)) {
      violations.push('services/smart_import.go — второй financial import path запрещён (нужен BulkImport)');
    }
    if (/INSERT INTO|tx\.Exec|pgx\./.test(code)) {
      violations.push('services/smart_import.go — прямые DB-мутации запрещены');
    }
    if (!/ParentWorkTempID:\s*it\.ParentTempID/.test(code)) {
      violations.push('services/smart_import.go — parent должен идти через существующий temp-id контур');
    }
  }
}

// ─── 13: нет N+1 nomenclature ────────────────────────────────────────────────
{
  const refs = read('backend/internal/repository/import_analysis_refs.go');
  if (refs != null) {
    const code = stripComments(refs);
    if (/for\s[\s\S]{0,200}?tx\.Query/.test(code)) {
      violations.push('import_analysis_refs.go — запрос в цикле (N+1)');
    }
    for (const needle of ['work_names', 'material_names', 'client_positions', 'units']) {
      if (!code.includes(needle)) {
        violations.push(`import_analysis_refs.go — батч-загрузка ${needle} потеряна`);
      }
    }
  }
}

// ─── 14/15/16/17 ─────────────────────────────────────────────────────────────
{
  const types = read('backend/internal/importanalysis/types.go');
  if (types != null) {
    const code = stripComments(types);
    for (const needle of ['MaxCompressedBytes', 'MaxUncompressedBytes', 'MaxRowsPerSheet', 'MaxSheets']) {
      if (!code.includes(needle)) {
        violations.push(`types.go — workbook limit потерян: ${needle}`);
      }
    }
  }
  const handler = read('backend/internal/handlers/smart_import.go');
  if (handler != null) {
    const code = stripComments(handler);
    if (/os\.Create|ioutil\.WriteFile|os\.WriteFile|TempFile/.test(code)) {
      violations.push('handlers/smart_import.go — файл должен жить только в памяти запроса');
    }
    if (!code.includes('MaxBytesReader')) {
      violations.push('handlers/smart_import.go — HTTP-лимит upload потерян');
    }
  }
  for (const rel of ENGINE_FILES) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|CREATE\s+TABLE/i.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — analyze не может мутировать данные (§16/§17)`);
    }
  }
}

// ─── 18: frontend execute disabled при blockers ──────────────────────────────
{
  const policy = read('src/lib/quality/smartImportPolicy.ts');
  if (policy != null) {
    const code = stripComments(policy);
    if (!/rows_blocked > 0\) return false/.test(code) ||
      !/required_mappings_missing > 0\) return false/.test(code)) {
      violations.push('smartImportPolicy.ts — execute-гейт по blockers потерян');
    }
  }
  const wizard = read('src/pages/ClientPositions/components/SmartImportWizard.tsx');
  if (wizard != null) {
    const code = stripComments(wizard);
    if (!code.includes('disabled={!ready}')) {
      violations.push('SmartImportWizard.tsx — кнопка импорта не блокируется при blockers');
    }
    if (/XLSX\.|sheet_to_json|from 'xlsx'/.test(code)) {
      violations.push('SmartImportWizard.tsx — клиентский Excel-парсер запрещён в умном импорте');
    }
  }
}

console.log('smartBoqImportSafety.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: инварианты умного импорта нарушены.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — client total только diagnostic; commercial-поля вне mapping');
console.log('  ok — execute: fingerprint + повторный серверный parse; normalized rows клиента не принимаются');
console.log('  ok — exact nomenclature без fuzzy/LLM; формулы/macros не исполняются; без FX fallback');
console.log('  ok — существующий authoritative import + temp-id parent; refs без N+1');
console.log('  ok — workbook limits; файл в памяти; analyze без мутаций; UI-гейт blockers');
console.log('\nsmartBoqImportSafety.check: passed');
