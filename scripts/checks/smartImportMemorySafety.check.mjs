// Этап 2.3 source guard — run via tsx:
//   npx tsx scripts/checks/smartImportMemorySafety.check.mjs
//
// Инварианты Smart Import Memory:
//   1. profiles user-scoped (каждый SQL фильтрует user_id);
//   2. aliases user-scoped;
//   3. frontend не передаёт user_id;
//   4. profile без financial-полей;
//   5. alias key/таблица без price/quantity/totals;
//   6. AI suggestion не сохраняется без confirmation+remember;
//   7. remember default false;
//   8. analyze не создаёт memory;
//   9. failed import не создаёт memory (persist строго после BulkImport);
//  10. memory persistence не обходит authoritative import;
//  11. alias target повторно валидируется;
//  12. exact canonical match выше alias;
//  13. alias-resolved row не отправляется AI;
//  14. нет shared/global auto-application;
//  15. нет raw workbook/row persistence;
//  16. нет raw AI response persistence;
//  17. management API не меняет catalog target;
//  18. management API не трогает финансы/approval;
//  19. profile exact-match only (без fuzzy);
//  20. без N+1 alias/profile-запросов.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const violations = [];

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
function stripSQLComments(text) {
  return text.replace(/--[^\n]*/g, ' ');
}
function read(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    violations.push(`${rel} — file missing (guard must be kept in sync)`);
    return null;
  }
  return readFileSync(abs, 'utf8');
}

// ─── 1/2: user-scope каждого запроса памяти ──────────────────────────────────
{
  const repo = read('backend/internal/repository/import_memory.go');
  if (repo != null) {
    const code = stripComments(repo);
    // Каждый метод репозитория, трогающий memory-таблицы, обязан фильтровать
    // user_id (динамический where строится от "user_id = $1::uuid").
    const fns = code.split(/\nfunc /).slice(1);
    for (const fn of fns) {
      if (!/boq_import_mapping_profiles|nomenclature_import_aliases/.test(fn)) continue;
      if (!/user_id\s*=\s*\$1::uuid|\(user_id,|"user_id = \$1::uuid"|"a\.user_id = \$1::uuid"/.test(fn)) {
        violations.push('import_memory.go — метод без user_id-фильтра (§15): func '
          + fn.slice(0, 50).replace(/\s+/g, ' '));
      }
    }
    if (!/WHERE user_id = \$1::uuid AND is_active AND normalized_header_signature = \$2/.test(code)) {
      violations.push('import_memory.go — profile lookup обязан быть user-scoped exact-match (§5/§15)');
    }
  }
  const refs = read('backend/internal/repository/import_analysis_refs.go');
  if (refs != null && !/WHERE user_id = \$1::uuid AND is_active/.test(stripComments(refs))) {
    violations.push('import_analysis_refs.go — загрузка aliases обязана фильтровать user_id (§15)');
  }
}

// ─── 3: frontend не передаёт user_id ─────────────────────────────────────────
{
  for (const rel of [
    'src/lib/api/importMemory.ts',
    'src/lib/api/boqSmartImport.ts',
    'src/pages/ClientPositions/components/SmartImportWizard.tsx',
    'src/pages/ClientPositions/components/ImportMemoryDrawer.tsx',
  ]) {
    const src = read(rel);
    if (src == null) continue;
    const code = stripComments(src);
    if (/user_id["']?\s*[:=]|[?&]user_id=|append\(['"]user_id/.test(code)) {
      violations.push(`${rel} — frontend не должен передавать user_id (§15)`);
    }
  }
}

// ─── 4/5/15: миграция и типы без financial/raw-данных ────────────────────────
{
  const mig = read('db/yandex/incremental/2026_07_smart_import_memory.sql');
  if (mig != null) {
    const sql = stripSQLComments(mig).toLowerCase();
    for (const bad of ['unit_rate', 'price', 'quantity', 'total_amount', 'currency_rate',
      'workbook', 'fingerprint', 'preview', 'prompt', 'response', 'tender_id']) {
      if (sql.includes(bad)) {
        violations.push(`migration — колонка/упоминание «${bad}» запрещено в memory-таблицах (§2/§3/§16)`);
      }
    }
    if (!sql.includes('on delete cascade')) {
      violations.push('migration — FK памяти обязаны быть CASCADE (без dangling catalog ID, §4)');
    }
    if (!/create unique index if not exists uq_nomenclature_import_aliases_active_key/.test(sql)) {
      violations.push('migration — unique active alias key потерян (§3)');
    }
  }
  const mem = read('backend/internal/importmemory/memory.go');
  if (mem != null) {
    const code = stripComments(mem);
    const resolveSig = code.match(/func \(idx \*AliasIndex\) Resolve\(([^)]*)\)/);
    if (!resolveSig || /rate|price|quantity|total|amount|currency/i.test(resolveSig[1])) {
      violations.push('memory.go — Resolve обязан принимать только text/type/unit/category (§3)');
    }
  }
  const prof = read('backend/internal/importmemory/profile.go');
  if (prof != null) {
    const fo = stripComments(prof).match(/type FixedOptions struct \{([\s\S]*?)\}/);
    if (!fo || /Rate|Price|Quantity|Total|Amount|Formula/i.test(fo[1])) {
      violations.push('profile.go — FixedOptions: только default currency/boq type (§2; формулы не обходятся)');
    }
  }
}

// ─── 6/7: только подтверждено + remember; default false ─────────────────────
{
  const svc = read('backend/internal/services/smart_import_memory.go');
  if (svc != null) {
    const code = stripComments(svc);
    if (!code.includes('src != "ai_confirmed" && src != "manual"')) {
      violations.push('smart_import_memory.go — сохранение alias без подтверждённого source запрещено (§7)');
    }
    if (!/applied :=|!applied/.test(code)) {
      violations.push('smart_import_memory.go — remember без повторной валидации selection запрещён (§7)');
    }
    if (!code.includes('finishExecuteMemory')) {
      violations.push('smart_import_memory.go — persist-этап потерян');
    }
  }
  const policy = read('src/lib/quality/aiNomenclaturePolicy.ts');
  if (policy != null && !stripComments(policy).includes('remember_selection: s.remember === true')) {
    violations.push('aiNomenclaturePolicy.ts — remember default обязан быть false (§7)');
  }
  const panel = read('src/pages/ClientPositions/components/NomenclatureSuggestPanel.tsx');
  if (panel != null) {
    const code = stripComments(panel);
    if (/remember:\s*true\s*[,}]/.test(code)) {
      violations.push('NomenclatureSuggestPanel.tsx — хардкод remember=true запрещён (§7)');
    }
    if (!code.includes('let rememberAll = false') || !code.includes('defaultChecked={false}')) {
      violations.push('NomenclatureSuggestPanel.tsx — bulk-подтверждение не должно подразумевать запоминание (§7)');
    }
  }
}

// ─── 8/9/10: persist строго после успешного authoritative import ─────────────
{
  const svc = read('backend/internal/services/smart_import.go');
  if (svc != null) {
    const code = stripComments(svc);
    const importIdx = code.indexOf('s.importer.BulkImport');
    const persistIdx = code.indexOf('finishExecuteMemory');
    if (importIdx < 0 || persistIdx < 0 || persistIdx < importIdx) {
      violations.push('smart_import.go — memory persistence раньше authoritative import (§8)');
    }
  }
  const memSvc = read('backend/internal/services/smart_import_memory.go');
  if (memSvc != null) {
    const code = stripComments(memSvc);
    const anStart = code.indexOf('func (s *SmartImportService) AnalyzeWithMemory');
    const anEnd = code.indexOf('\nfunc ', anStart + 1);
    const analyzeFn = code.slice(anStart, anEnd < 0 ? code.length : anEnd);
    if (/SaveAliases|CreateProfile|UpdateProfileContent|BumpProfileUse|BumpAliasUse/.test(analyzeFn)) {
      violations.push('smart_import_memory.go — analyze не должен создавать/менять память (§8)');
    }
    if (/BulkImport|INSERT INTO/.test(code)) {
      violations.push('smart_import_memory.go — memory-слой не должен импортировать данные сам (§16)');
    }
  }
  const repo = read('backend/internal/repository/import_memory.go');
  if (repo != null && /boq_items|client_positions|financial_/.test(stripComments(repo))) {
    violations.push('import_memory.go — memory-репозиторий не трогает BOQ/финансы (§16/§18)');
  }
}

// ─── 11/12: re-validation цели + приоритет exact canonical ───────────────────
{
  const ext = read('backend/internal/importanalysis/extract.go');
  if (ext != null) {
    const code = stripComments(ext);
    if (!code.includes('NOMENCLATURE_ALIAS_TARGET_UNAVAILABLE')) {
      violations.push('extract.go — недоступная цель alias обязана давать issue, а не dangling ID (§13)');
    }
    const exactIdx = code.indexOf('if len(ids) == 1 {');
    const aliasIdx = code.indexOf('tryAliasMatch(');
    if (exactIdx < 0 || aliasIdx < 0 || aliasIdx < exactIdx) {
      violations.push('extract.go — exact canonical match обязан идти РАНЬШЕ alias (§6)');
    }
    if (!code.includes('NOMENCLATURE_ALIAS_CONFLICT')) {
      violations.push('extract.go — конфликт aliases обязан блокировать выбор (§6)');
    }
  }
}

// ─── 13: alias-resolved строки не уходят AI ──────────────────────────────────
{
  const svc = read('backend/internal/services/smart_import_ai.go');
  if (svc != null) {
    const code = stripComments(svc);
    const filter = code.slice(code.indexOf('for _, is := range an.Result.Issues'),
      code.indexOf('catalog, err :='));
    if (/ALIAS_MATCH|ALIAS_CONFLICT/.test(filter)) {
      violations.push('smart_import_ai.go — alias-строки не должны попадать в AI-подбор (§15)');
    }
    if (!filter.includes('"NOMENCLATURE_NOT_FOUND"')) {
      violations.push('smart_import_ai.go — suggest-фильтр unresolved-строк потерян');
    }
  }
}

// ─── 14: нет shared/global scope ─────────────────────────────────────────────
{
  const mig = read('db/yandex/incremental/2026_07_smart_import_memory.sql');
  if (mig != null && /is_shared|is_global|team_id|organization_id/i.test(stripSQLComments(mig))) {
    violations.push('migration — shared/global scope запрещён в MVP (§15)');
  }
  const repo = read('backend/internal/repository/import_memory.go');
  if (repo != null && /is_shared|team_id|organization/i.test(stripComments(repo))) {
    violations.push('import_memory.go — shared scope запрещён в MVP (§15)');
  }
}

// ─── 16: raw AI response не персистится ──────────────────────────────────────
for (const rel of [
  'backend/internal/repository/import_memory.go',
  'backend/internal/services/smart_import_memory.go',
]) {
  const src = read(rel);
  if (src == null) continue;
  if (/RerankBatchResponse|Explanation|SystemInstruction|prompt_text/.test(stripComments(src))) {
    violations.push(`${rel} — raw AI prompt/response не сохраняется (§16)`);
  }
}

// ─── 17/18: management API не меняет target и финансы ────────────────────────
{
  const repo = read('backend/internal/repository/import_memory.go');
  if (repo != null) {
    const code = stripComments(repo);
    const patches = code.match(/UPDATE public\.(boq_import_mapping_profiles|nomenclature_import_aliases)[\s\S]*?WHERE/g) ?? [];
    for (const st of patches) {
      if (/SET[\s\S]*(material_name_id|work_name_id|mapping =)[\s\S]*WHERE/.test(st)
        && !/normalized_header_signature/.test(st)) {
        violations.push('import_memory.go — PATCH-путь не должен менять catalog target/mapping (§10): '
          + st.slice(0, 60).replace(/\s+/g, ' '));
      }
    }
  }
  const handler = read('backend/internal/handlers/import_memory.go');
  if (handler != null) {
    const code = stripComments(handler);
    if (/catalog_id|material_name_id|work_name_id/.test(code)) {
      violations.push('handlers/import_memory.go — catalog target через management API неизменяем (§10)');
    }
    if (/recalc|approval|revision/i.test(code)) {
      violations.push('handlers/import_memory.go — management не трогает финансовый lifecycle (§16)');
    }
  }
}

// ─── 19: exact profile match, без fuzzy ──────────────────────────────────────
{
  const repo = read('backend/internal/repository/import_memory.go');
  if (repo != null) {
    const code = stripComments(repo);
    const sigStart = code.indexOf('func (r *ImportMemoryRepo) ListProfilesBySignature');
    const sigEnd = code.indexOf('\nfunc ', sigStart + 1);
    const bySig = code.slice(sigStart, sigEnd < 0 ? code.length : sigEnd);
    if (/LIKE|ILIKE|similarity|levenshtein/.test(bySig)) {
      violations.push('import_memory.go — fuzzy profile matching запрещён (§5): только exact signature');
    }
  }
  const memSvc = read('backend/internal/services/smart_import_memory.go');
  if (memSvc != null && /similarity|fuzzy|Levenshtein/i.test(stripComments(memSvc))) {
    violations.push('smart_import_memory.go — fuzzy применение памяти запрещено (§5/§6)');
  }
}

// ─── 20: без N+1 ─────────────────────────────────────────────────────────────
{
  const ia = read('backend/internal/importanalysis/extract.go');
  if (ia != null && /pgx|pool\.|Query\(/.test(stripComments(ia))) {
    violations.push('extract.go — запросы БД в per-row extract запрещены (§21): только префетч-индексы');
  }
  const refs = read('backend/internal/repository/import_analysis_refs.go');
  if (refs != null) {
    const code = stripComments(refs);
    if (!code.includes('NewAliasIndex(aliases)')) {
      violations.push('import_analysis_refs.go — alias-индекс обязан строиться один раз на запрос (§21)');
    }
  }
}

console.log('smartImportMemorySafety.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: инварианты Smart Import Memory нарушены.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — память строго user-scoped; frontend не передаёт user_id; shared scope отсутствует');
console.log('  ok — profile/alias без financial-полей; FK CASCADE; unique active alias key');
console.log('  ok — только подтверждённые решения; remember default false; bulk без auto-remember');
console.log('  ok — persist строго после успешного authoritative import; analyze ничего не пишет');
console.log('  ok — alias re-валидация; exact canonical > alias; alias-строки не уходят AI');
console.log('  ok — management не меняет target/финансы; exact-match без fuzzy; без N+1');
console.log('\nsmartImportMemorySafety.check: passed (20 rules)');
