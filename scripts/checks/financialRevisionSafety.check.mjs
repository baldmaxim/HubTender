// Stage 0-F2 source guard — run via tsx:
//   npx tsx scripts/checks/financialRevisionSafety.check.mjs
//
// The financial-revision safety net must stay wired:
//   1.  every active financial mutation path calls the central
//       MarkTenderFinancialInputsChangedTx (revision bump + stale + approval
//       invalidation, one tx);
//   2.  the background commercial recalc finishes through the revision CAS
//       inside ONE REPEATABLE READ tx under the per-tender advisory lock;
//   3.  the success marker is CONDITIONAL (CAS) — no unconditional
//       'calculated' UPDATE anywhere;
//   4.  the approval endpoint gates on calculated/current revision;
//   5.  approval invalidation lives in the central mutation helper;
//   6.  import marks the tender stale in-tx and the service enqueues the
//       recalc after commit;
//   7.  the redistribution snapshot carries the input-revision marker and the
//       GET degrades on INPUT_REVISION_CHANGED;
//   8.  frontend approval/final-export decisions go through the shared
//       resolveFinancialCalculationState policy;
//   9.  the derived commercial writer does NOT touch boq_items.updated_at
//       (user ETag); 10. user input writers still do;
//   11. the tenders LIST projection carries the six 0-F2 financial columns —
//       without them the endpoint ships an empty status and the fail-closed
//       frontend policy blocks the final export for EVERY tender.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const violations = [];
const lineOf = (text, i) => text.slice(0, i).split('\n').length;

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

// ─── 1. every financial mutation path uses the central helper ────────────────
{
  const mutationPaths = [
    'backend/internal/repository/boq_write.go',           // BOQ create
    'backend/internal/repository/boq_mutate.go',          // BOQ update + delete
    'backend/internal/repository/position.go',            // batch delete/clear
    'backend/internal/repository/import_boq.go',          // mass import
    'backend/internal/repository/template_insert.go',     // template insert
    'backend/internal/repository/position_recompute.go',  // linked materials
    'backend/internal/repository/boq_copy.go',            // copy position
    'backend/internal/repository/tender_transfer.go',     // version transfer
    'backend/internal/repository/boq_audit_rollback.go',  // audit rollback
    'backend/internal/repository/tender_write.go',        // FX rates (PATCH)
    'backend/internal/repository/tender_admin.go',        // FX/tactic (admin)
    'backend/internal/repository/markup.go',              // tactic assignment
    'backend/internal/repository/markup_parameters.go',   // markup percentages
    'backend/internal/repository/markup_pricing.go',      // pricing distribution + exclusions
    'backend/internal/repository/subcontract.go',         // exclusion toggle
    'backend/internal/repository/insurance.go',           // insurance upsert
    'backend/internal/repository/redistribution.go',      // redistribution save
  ];
  for (const rel of mutationPaths) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    if (!code.includes('MarkTenderFinancialInputsChangedTx') &&
        !code.includes('WithTenderFinancialMutationTx')) {
      violations.push(`${rel} — financial mutation path without the central revision/stale helper`);
    }
  }
}

// ─── 2/3. recalc CAS + serialization; success marker is conditional ──────────
{
  const rel = 'backend/internal/repository/commercial_recalc_authoritative.go';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    for (const needle of ['MarkTenderCalculationSucceededTx', 'pg_advisory_lock', 'RepeatableRead', 'StaleCalculationResultError']) {
      if (!code.includes(needle)) {
        violations.push(`${rel} — recalc lost ${needle} (stale result could overwrite new inputs)`);
      }
    }
  }
  const rev = read('backend/internal/repository/tender_revision.go');
  if (rev != null) {
    const code = stripComments(rev);
    // The success UPDATE must be revision-conditional (CAS) — checked INSIDE
    // the MarkTenderCalculationSucceededTx function body only.
    const succFn = /func MarkTenderCalculationSucceededTx[\s\S]*?\n}/.exec(code);
    if (!succFn || !/WHERE[\s\S]*?financial_input_revision\s*=\s*\$\d/.test(succFn[0])) {
      violations.push(`backend/internal/repository/tender_revision.go — success marker is not a CAS on financial_input_revision`);
    }
    // 5. approval invalidation inside the central mutation helper.
    const markBody = /MarkTenderFinancialInputsChangedTx[\s\S]*?RETURNING/.exec(code);
    if (!markBody || !/financial_approved\s*=\s*false/.test(markBody[0])) {
      violations.push(`backend/internal/repository/tender_revision.go — the central helper no longer invalidates the financial approval`);
    }
    if (!markBody || !/financial_calculation_status\s*=\s*'stale'/.test(markBody[0])) {
      violations.push(`backend/internal/repository/tender_revision.go — the central helper no longer marks 'stale'`);
    }
  }
  // No unconditional 'calculated' UPDATE outside the CAS helper (production Go).
  const recalcFiles = ['backend/internal/repository/tender_reprice.go', 'backend/internal/repository/insurance.go', 'backend/internal/repository/redistribution.go'];
  for (const rel2 of recalcFiles) {
    const raw2 = read(rel2);
    if (raw2 == null) continue;
    const code2 = stripComments(raw2);
    if (/financial_calculation_status\s*=\s*'calculated'/.test(code2)) {
      violations.push(`${rel2} — direct 'calculated' UPDATE bypasses the CAS helper`);
    }
    if (!code2.includes('MarkTenderCalculationSucceededTx') && rel2.includes('reprice')) {
      violations.push(`${rel2} — sync pipeline no longer finishes with the success CAS`);
    }
  }
}

// ─── 4. approval endpoint gates on calculated/current ────────────────────────
{
  const rel = 'backend/internal/repository/tender_admin.go';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    const fn = /func \(r \*TenderRepo\) ApproveFinancial[\s\S]*?\n}/.exec(code);
    if (!fn) {
      violations.push(`${rel} — ApproveFinancial not found`);
    } else {
      for (const needle of ['financial_calculation_status', 'FinancialCalculationNotReadyError', 'financial_input_revision']) {
        if (!fn[0].includes(needle)) {
          violations.push(`${rel} — ApproveFinancial no longer gates on ${needle}`);
        }
      }
    }
  }
}

// ─── 6. import: stale in-tx + enqueue after commit ───────────────────────────
{
  const svc = read('backend/internal/services/import_boq.go');
  if (svc != null) {
    const code = stripComments(svc);
    if (!/Enqueue\(/.test(code)) {
      violations.push(`backend/internal/services/import_boq.go — import no longer enqueues the recalc after commit`);
    }
  }
  const repo = read('backend/internal/repository/import_boq.go');
  if (repo != null && !stripComments(repo).includes('MarkTenderFinancialInputsChangedTx')) {
    violations.push(`backend/internal/repository/import_boq.go — import no longer marks the tender stale in-tx`);
  }
}

// ─── 7. redistribution snapshot revision marker ──────────────────────────────
{
  const marker = read('backend/internal/repository/redistribution_rebuild.go');
  if (marker != null && !stripComments(marker).includes('stampRulesInputRevision')) {
    violations.push(`backend/internal/repository/redistribution_rebuild.go — the snapshot engine no longer stamps the input revision`);
  }
  const rel = 'backend/internal/repository/redistribution.go';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    for (const needle of ['INPUT_REVISION_CHANGED', 'FinancialInputRevision']) {
      if (!code.includes(needle)) {
        violations.push(`${rel} — redistribution snapshot lost the ${needle} revision marker wiring`);
      }
    }
  }
}

// ─── 7b. the recalc re-applies the SAVED redistribution rules ────────────────
// Without this the snapshot keeps the OLD revision marker after every markup /
// FX / BOQ edit, so LoadResults degrades it to INPUT_REVISION_CHANGED forever
// and Commerce / ФП / final exports stay blocked until a human re-saves from
// the «Перераспределение» page. That was the reported regression.
{
  const rel = 'backend/internal/repository/commercial_recalc_authoritative.go';
  const raw = read(rel);
  if (raw != null && !stripComments(raw).includes('RefreshRedistributionSnapshotTx')) {
    violations.push(`${rel} — recalc no longer refreshes the redistribution snapshot (снимок навсегда останется requires_recalculation после правки наценок)`);
  }
  const refresh = 'backend/internal/repository/redistribution_refresh.go';
  const rawRefresh = read(refresh);
  if (rawRefresh != null) {
    const code = stripComments(rawRefresh);
    // Fail-SOFT: unusable saved rules must not abort the commercial recalc, so
    // the rebuild has to run inside a savepoint that is rolled back on error.
    if (!code.includes('sp.Rollback(ctx)') || !code.includes('tx.Begin(ctx)')) {
      violations.push(`${refresh} — the snapshot rebuild must run in a SAVEPOINT (иначе неприменимые правила уронят весь коммерческий пересчёт)`);
    }
    // The single engine: no second calculation path may appear here.
    if (!code.includes('rebuildRedistributionSnapshotTx')) {
      violations.push(`${refresh} — background refresh must go through the shared snapshot engine, not a second implementation`);
    }
  }
}

// ─── 8. frontend shared calculation-state policy ─────────────────────────────
{
  const helper = read('src/lib/financial/calculationState.ts');
  if (helper != null) {
    const code = stripComments(helper);
    if (!/canApprove:\s*false/.test(code) || !/canExportFinal:\s*false/.test(code)) {
      violations.push(`src/lib/financial/calculationState.ts — non-calculated states no longer block approve/export`);
    }
    // Fail-closed: unknown status must not resolve to calculated.
    if (!/kind = 'stale'/.test(code)) {
      violations.push(`src/lib/financial/calculationState.ts — unknown status no longer falls back to stale`);
    }
  }
  for (const [rel, needles] of [
    ['src/pages/FinancialIndicators/FinancialIndicators.tsx', ['resolveFinancialCalculationState', 'canApprove']],
    ['src/pages/Commerce/Commerce.tsx', ['resolveFinancialCalculationState', 'canExportFinal']],
  ]) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    for (const n of needles) {
      if (!code.includes(n)) {
        violations.push(`${rel} — approval/final export no longer uses the shared policy (${n})`);
      }
    }
  }
}

// ─── 9/10. derived writer vs user writer and updated_at ──────────────────────
{
  const derived = read('backend/internal/repository/commercial_write.go');
  if (derived != null) {
    const code = stripComments(derived);
    const upd = /UPDATE public\.boq_items[\s\S]*?WHERE/g;
    let m;
    while ((m = upd.exec(code)) !== null) {
      if (/updated_at/.test(m[0])) {
        violations.push(`backend/internal/repository/commercial_write.go:${lineOf(code, m.index)} — derived commercial write touches boq_items.updated_at (user ETag would shift)`);
      }
    }
  }
  const user = read('backend/internal/repository/boq_mutate.go');
  if (user != null) {
    const code = stripComments(user);
    if (!/updated_at\s*=\s*NOW\(\)/.test(code)) {
      violations.push(`backend/internal/repository/boq_mutate.go — user input writer no longer updates updated_at (ETag frozen)`);
    }
  }
}

// ─── 11. the tenders LIST projection carries the 0-F2 financial columns ──────
// Regression (август 2026): ListTenders had a bespoke SELECT without the six
// columns, so GET /api/v1/tenders returned financial_calculation_status "" →
// resolveFinancialCalculationState (fail-closed, "" is not nullish) resolved
// 'stale' → «Форма КП» blocked the final Excel export for EVERY tender while
// the DB said 'calculated'. §8 only checks that the page *mentions* the policy,
// which is why the hole survived — this section checks the data feeding it.
{
  const FIN_COLS = [
    'financial_input_revision',
    'financial_calculation_revision',
    'financial_calculation_status',
    'financial_calculated_at::text', // *string → cast обязателен, иначе pgx падает
    'financial_calculation_error_code',
    'financial_calculation_error_message',
  ];
  const rel = 'backend/internal/repository/tender.go';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    const decl = /const tenderFinancialCols = `([\s\S]*?)`/.exec(code);
    if (!decl) {
      violations.push(`${rel} — tenderFinancialCols missing (единственный источник 0-F2 проекции)`);
    } else {
      for (const col of FIN_COLS) {
        if (!decl[1].includes(col)) {
          violations.push(`${rel} — tenderFinancialCols lost ${col}`);
        }
      }
    }
    const builder = /func buildTenderListQuery[\s\S]*?\n}/.exec(code);
    const lister = /func \(r \*TenderRepo\) ListTenders[\s\S]*?\n}/.exec(code);
    if (!lister) {
      violations.push(`${rel} — ListTenders not found (guard must be kept in sync)`);
    } else {
      const projection = (builder ? builder[0] : '') + lister[0];
      if (!projection.includes('tenderFinancialCols')) {
        violations.push(`${rel} — ListTenders SELECT no longer projects tenderFinancialCols (список отдаёт пустой financial_calculation_status → фронт fail-closed блокирует финальный экспорт «Формы КП»)`);
      }
      for (const f of ['FinancialInputRevision', 'FinancialCalculationRevision',
                       'FinancialCalculationStatus', 'FinancialCalculatedAt',
                       'FinancialCalculationErrorCode', 'FinancialCalculationErrorMessage']) {
        if (!lister[0].includes('row.' + f)) {
          violations.push(`${rel} — ListTenders Scan no longer binds ${f}`);
        }
      }
    }
  }
  const wr = read('backend/internal/repository/tender_write.go');
  if (wr != null && !stripComments(wr).includes('tenderFinancialCols')) {
    violations.push(`backend/internal/repository/tender_write.go — tenderScanCols больше не строится из tenderFinancialCols (проекция снова раздвоилась)`);
  }
}

console.log('financialRevisionSafety.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: the financial revision/CAS safety net is broken.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — all financial mutation paths bump revision + invalidate approval (central helper)');
console.log('  ok — recalc: advisory lock + REPEATABLE READ + revision CAS; no unconditional success');
console.log('  ok — approval gates on calculated/current revision (+redistribution marker)');
console.log('  ok — import: stale in-tx, enqueue after commit; snapshot carries revision marker');
console.log('  ok — frontend approve/final export via shared policy; derived writes keep the user ETag');
console.log('  ok — tenders LIST projection carries the 0-F2 financial columns (гейт экспорта «Формы КП»)');
console.log('\nfinancialRevisionSafety.check: passed');
