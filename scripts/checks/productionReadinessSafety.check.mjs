// Этап 2.4 source guard — run via tsx:
//   npx tsx scripts/checks/productionReadinessSafety.check.mjs
//
// Инварианты production readiness:
//   1. recovery startup hook существует;
//   2. periodic recovery существует;
//   3. recovery multi-instance safe (advisory try-lock + CAS);
//   4. lost enqueue лечится recovery (stale → enqueue), без ручного DB edit;
//   5. calculating timeout/reclaim существует;
//   6. nullable PATCH различает absent/null/value (+ frontend шлёт явный null);
//   7. composite FK migration существует (preflight + оба FK);
//   8. нет скрытого FX fallback = 1 в authoritative calc;
//   9. production build входит в rehearsal;
//  10. browser E2E входит в rehearsal;
//  11. race detector скрипт реален (CGO + -race + full/targeted);
//  12. readiness audit read-only по умолчанию (никаких Exec/INSERT/UPDATE);
//  13. markup impact report существует (addOne, фиксированный вход);
//  14. ACL verification существует (SAFE/RISK/UNKNOWN);
//  15. rehearsal — disposable test DB;
//  16. скрипты не читают production credentials (.env/.env.prod);
//  17. cleanup trap существует во всех скриптах;
//  18. AI provider остаётся disabled/no-op (инвариант 2.2 не откатан);
//  19. readiness-код не добавляет новую финансовую формулу (только reuse calc);
//  20. нет auto-repair неконсистентных production BOQ.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const violations = [];

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

// ─── 1/2/4/5: recovery существует и полон ────────────────────────────────────
{
  const main = read('backend/cmd/server/main.go');
  if (main != null && !/go d\.recalcRecovery\.Run\(rootCtx\)/.test(stripComments(main))) {
    violations.push('main.go — recovery startup hook потерян (§2.1)');
  }
  const svc = read('backend/internal/services/recalc_recovery.go');
  if (svc != null) {
    const code = stripComments(svc);
    if (!code.includes('time.NewTicker(s.cfg.ScanInterval)')) {
      violations.push('recalc_recovery.go — periodic scan потерян (§2.2)');
    }
    if (!/case "stale":[\s\S]{0,400}s\.enqueue\(cand\.TenderID\)/.test(code)) {
      violations.push('recalc_recovery.go — lost enqueue больше не лечится (stale → enqueue, §2.A)');
    }
    if (!code.includes('s.store.Reclaim(ctx, cand.TenderID, s.cfg.CalculatingTimeout)')) {
      violations.push('recalc_recovery.go — calculating reclaim потерян (§2.B)');
    }
    if (!code.includes('CalculatingTimeout') || !code.includes('BatchSize')) {
      violations.push('recalc_recovery.go — конфигурация timeout/batch потеряна (§2)');
    }
    if (!/EnqueueFailed\+\+/.test(code)) {
      violations.push('recalc_recovery.go — неуспешный enqueue обязан оставлять stale до следующего скана (§2)');
    }
  }
  const repo = read('backend/internal/repository/recalc_recovery.go');
  if (repo != null) {
    const code = stripComments(repo);
    if (!code.includes('pg_try_advisory_lock')) {
      violations.push('repository/recalc_recovery.go — reclaim без advisory try-lock не multi-instance safe (§2)');
    }
    if (!/financial_calculation_status = 'calculating'[\s\S]{0,200}financial_calculation_started_at < NOW\(\)/.test(code)) {
      violations.push('repository/recalc_recovery.go — reclaim CAS по status+started_at потерян (§2)');
    }
  }
}

// ─── 3: гонка двух recovery instances закрыта CAS/lock (тест обязателен) ─────
{
  const t = read('backend/internal/services/recalc_recovery_test.go');
  if (t != null && !t.includes('TestRecoveryMultiInstanceSingleWinner')) {
    violations.push('recalc_recovery_test.go — multi-instance тест потерян (§4.6)');
  }
}

// ─── 6: tri-state PATCH ──────────────────────────────────────────────────────
{
  const nullable = read('backend/internal/repository/nullable.go');
  if (nullable != null) {
    const code = nullable; // порядок строк важен — не стрипаем
    if (!/o\.Present = true\s*\n\s*if bytes\.Equal/.test(code)) {
      violations.push('nullable.go — UnmarshalJSON обязан ставить Present=true ДО null-проверки (null ≠ absent, §6)');
    }
  }
  const mutate = read('backend/internal/repository/boq_mutate.go');
  if (mutate != null) {
    const code = stripComments(mutate);
    for (const f of ['ParentWorkItemID', 'BaseQuantity', 'ConversionCoefficient',
      'DetailCostCategoryID', 'MaterialNameID', 'WorkNameID']) {
      if (!new RegExp(`${f}\\s+OptionalNullable\\[`).test(code)) {
        violations.push(`boq_mutate.go — поле ${f} обязано быть tri-state (§6)`);
      }
    }
    if (!code.includes('in.ParentWorkItemID.arg()')) {
      violations.push('boq_mutate.go — typed SET через .arg() потерян (§6)');
    }
    if (/map\[string\]any/.test(code)) {
      violations.push('boq_mutate.go — map[string]any в PATCH запрещён (§6)');
    }
  }
  // Frontend regression (§6/§18.13): очистка шлёт явный null.
  const form = read('src/pages/PositionItems/hooks/useMaterialEditForm.ts');
  if (form != null && !form.includes('dataToSave.parent_work_item_id = null')) {
    violations.push('useMaterialEditForm.ts — clear обязан слать явный null, а не удалять поле (§6)');
  }
}

// ─── 7: composite FK migration ───────────────────────────────────────────────
{
  const mig = read('db/yandex/incremental/2026_07_boq_relation_integrity.sql');
  if (mig != null) {
    for (const anchor of ['boq_items_position_scope_fkey', 'boq_items_parent_scope_fkey',
      'RAISE EXCEPTION', 'NOT VALID', 'VALIDATE CONSTRAINT']) {
      if (!mig.includes(anchor)) {
        violations.push(`boq_relation_integrity.sql — «${anchor}» потерян (§8)`);
      }
    }
    if (/UPDATE public\.boq_items SET|DELETE FROM public\.boq_items/.test(mig)) {
      violations.push('boq_relation_integrity.sql — авто-исправление production rows запрещено (§8)');
    }
  }
}

// ─── 8: FX fail-closed без fallback=1 ────────────────────────────────────────
{
  const calc = read('backend/internal/calc/boq_amount.go');
  if (calc != null) {
    const code = stripComments(calc);
    if (!code.includes('MissingFXRateError')) {
      violations.push('calc/boq_amount.go — MissingFXRateError потерян (§9)');
    }
    if (!code.includes('return 0, &MissingFXRateError{Currency: currency}')) {
      violations.push('calc/boq_amount.go — nil-курс обязан давать MissingFXRateError, а не fallback (§9)');
    }
    if (/if p == nil[^}]{0,120}return 1(\.0)?, nil/.test(code)) {
      violations.push('calc/boq_amount.go — скрытый FX fallback = 1 запрещён (§9)');
    }
  }
}

// ─── 9/10/11/15/16/17: rehearsal-скрипты ─────────────────────────────────────
{
  const rehearsal = read('scripts/readiness/run-production-rehearsal.sh');
  if (rehearsal != null) {
    if (!rehearsal.includes('npm run build')) {
      violations.push('run-production-rehearsal.sh — production build исключён из репетиции (§13/§16)');
    }
    if (!rehearsal.includes('playwright test')) {
      violations.push('run-production-rehearsal.sh — browser E2E исключён из репетиции (§14/§16)');
    }
    if (!/trap cleanup EXIT/.test(rehearsal)) {
      violations.push('run-production-rehearsal.sh — cleanup trap потерян (§16)');
    }
    if (!/hubtender-rehearsal-test|_test\b/.test(rehearsal)) {
      violations.push('run-production-rehearsal.sh — среда обязана быть disposable *test* (§16)');
    }
    if (/\.env(\.prod)?\b/.test(rehearsal.replace(/#[^\n]*/g, ''))) {
      violations.push('run-production-rehearsal.sh — чтение .env/.env.prod запрещено (§16)');
    }
    if (!/mdb\.yandexcloud\.net/.test(rehearsal)) {
      violations.push('run-production-rehearsal.sh — guard от production DSN потерян (§16)');
    }
  }
  const race = read('scripts/readiness/run-race-detector.sh');
  if (race != null) {
    if (!race.includes('CGO_ENABLED=1') || !race.includes('go test -race -p 1')) {
      violations.push('run-race-detector.sh — реальная race-команда потеряна (§15)');
    }
    if (!/trap cleanup EXIT/.test(race)) {
      violations.push('run-race-detector.sh — cleanup trap потерян (§16)');
    }
  }
  const smoke = read('scripts/readiness/run-browser-smoke.sh');
  if (smoke != null) {
    if (!/trap cleanup EXIT/.test(smoke)) {
      violations.push('run-browser-smoke.sh — cleanup trap потерян (§16)');
    }
    if (/\.env(\.prod)?\b/.test(smoke.replace(/#[^\n]*/g, ''))) {
      violations.push('run-browser-smoke.sh — чтение .env/.env.prod запрещено (§16)');
    }
  }
}

// ─── 12/19/20: readiness audit read-only, без новых формул и auto-repair ─────
{
  for (const rel of ['backend/internal/readiness/readiness.go',
    'backend/internal/readiness/markup_impact.go',
    'backend/internal/readiness/acl.go',
    'backend/cmd/production-readiness-audit/main.go']) {
    const src = read(rel);
    if (src == null) continue;
    const code = stripComments(src);
    if (/\.Exec\(|INSERT INTO|UPDATE public\.|DELETE FROM/.test(code)) {
      violations.push(`${rel} — readiness обязан быть read-only (§10): найден мутирующий вызов`);
    }
    if (/func Calculate|func Compute[A-Z]/.test(code)) {
      violations.push(`${rel} — новая финансовая формула в readiness запрещена (§19): только reuse internal/calc`);
    }
  }
  const cmd = read('backend/cmd/production-readiness-audit/main.go');
  if (cmd != null && /repair|mark-stale/i.test(stripComments(cmd))) {
    violations.push('production-readiness-audit — repair/apply-mode запрещён (§10: read-only + documented remediation)');
  }
}

// ─── 13/14: markup impact + ACL ──────────────────────────────────────────────
{
  const mi = read('backend/internal/readiness/markup_impact.go');
  if (mi != null) {
    const code = mi;
    if (!code.includes('BuildMarkupImpact') || !code.includes('"addOne"')
      || !code.includes('base=1000')) {
      violations.push('markup_impact.go — impact report ослаблен (§11)');
    }
  }
  const acl = read('backend/internal/readiness/acl.go');
  if (acl != null) {
    for (const st of ['CONFIRMED_SAFE', 'CONFIRMED_RISK', 'UNKNOWN']) {
      if (!acl.includes(st)) {
        violations.push(`acl.go — статус ${st} потерян (§12)`);
      }
    }
  }
}

// ─── 18: AI provider остаётся disabled/no-op ─────────────────────────────────
{
  const wire = read('backend/cmd/server/wire.go');
  if (wire != null) {
    const code = stripComments(wire);
    if (!code.includes('ainom.DisabledProvider{}') || !/aiNomCfg\.Enabled\s*=\s*false/.test(code)) {
      violations.push('wire.go — AI provider обязан оставаться disabled до отдельного этапа (§18)');
    }
  }
}

console.log('productionReadinessSafety.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: инварианты production readiness нарушены.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — recovery: startup + periodic + reclaim (try-lock+CAS) + retry enqueue');
console.log('  ok — tri-state PATCH: null ≠ absent; typed SET; frontend шлёт явный null');
console.log('  ok — composite FK + preflight без auto-repair; FX fail-closed без =1');
console.log('  ok — rehearsal: prod build + E2E + race (CGO) + disposable test env + traps');
console.log('  ok — readiness audit read-only; markup impact + ACL statuses; AI disabled');
console.log('\nproductionReadinessSafety.check: passed (20 rules)');
