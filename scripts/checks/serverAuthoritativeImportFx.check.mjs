// Stage 0-F1 source guard — run via tsx:
//   npx tsx scripts/checks/serverAuthoritativeImportFx.check.mjs
//
// Two user-facing money bugs must stay fixed:
//   A. Bulk BOQ import can NOT persist a client-calculated total:
//      1. the import INSERT has no total_amount column and never binds
//         item.TotalAmount;
//      2. the import delegates money to the authoritative calc path
//         (RecomputeBoqTotalAmountsTx) + position totals + grand total;
//      3. no client commercial fields in the import DTO;
//      4. no manual qty×rate formula inside the import repository.
//   B. An interactive FX-rate change is atomic and fail-closed:
//      5. repriceTenderAfterRateChangeTx contains the FULL pipeline
//         (BOQ recompute → position totals → commercial → grand total);
//      6. BOTH rate-writing paths (tender_write.go PATCH and tender_admin.go
//         admin patch) call the pipeline — the admin path can not bypass it;
//      7. no FX fallback to 1 (frontend import path; the Go kernel fails
//         closed via MissingFXRateError);
//      8. the frontend mass-import payload no longer sends total_amount.

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

// ─── 1-4. import repository ──────────────────────────────────────────────────
{
  const rel = 'backend/internal/repository/import_boq.go';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);

    // 1. The INSERT INTO boq_items must not mention total_amount at all.
    const insertRe = /INSERT INTO public\.boq_items[\s\S]*?RETURNING/g;
    let m;
    while ((m = insertRe.exec(code)) !== null) {
      if (/total_amount/.test(m[0])) {
        violations.push(`${rel}:${lineOf(code, m.index)} — import INSERT persists total_amount (client money must never reach the row)`);
      }
      if (/commercial/i.test(m[0])) {
        violations.push(`${rel}:${lineOf(code, m.index)} — import INSERT touches commercial fields`);
      }
    }
    // item.TotalAmount may appear only in diagnostics — never inside the
    // INSERT call's argument list.
    const insertCallRe = /tx\.QueryRow\(ctx,\s*insertBoqQ[\s\S]*?\.Scan\(/g;
    let call;
    while ((call = insertCallRe.exec(code)) !== null) {
      if (/TotalAmount/.test(call[0])) {
        violations.push(`${rel}:${lineOf(code, call.index)} — item.TotalAmount bound into the INSERT`);
      }
    }

    // 2. Authoritative money pipeline inside the SAME import tx.
    for (const needle of ['RecomputeBoqTotalAmountsTx', 'RecomputePositionTotalsForTenderTx', 'RecalculateTenderGrandTotalTx']) {
      if (!code.includes(needle)) {
        violations.push(`${rel} — import must call ${needle} inside the transaction`);
      }
    }

    // 3. No client commercial fields in the DTO / anywhere in the import repo.
    const comm = /commercial_markup|total_commercial_material_cost|total_commercial_work_cost/.exec(code);
    if (comm) {
      violations.push(`${rel}:${lineOf(code, comm.index)} — client commercial field in the import path`);
    }

    // 4. No manual money formula in the import repository.
    const formula = /[Qq]uantity\s*\*\s*\*?\w*[Uu]nit_?[Rr]ate|[Uu]nit_?[Rr]ate\s*\*\s*\*?\w*[Qq]uantity/.exec(code);
    if (formula) {
      violations.push(`${rel}:${lineOf(code, formula.index)} — manual amount formula in import (must delegate to calc)`);
    }
  }
}

// ─── 5. the reprice pipeline is complete ─────────────────────────────────────
{
  const rel = 'backend/internal/repository/tender_reprice.go';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    for (const needle of [
      'RecomputeBoqTotalAmountsTx',
      'RecomputePositionTotalsForTenderTx',
      'MaterializeCommercialForTenderTx',
      'RecalculateTenderGrandTotalTx',
    ]) {
      if (!code.includes(needle)) {
        violations.push(`${rel} — reprice pipeline lost ${needle} (rate change would leave stale money)`);
      }
    }
  }
}

// ─── 6. both rate-writing paths run the pipeline ─────────────────────────────
{
  for (const rel of ['backend/internal/repository/tender_write.go', 'backend/internal/repository/tender_admin.go']) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    if (!/usd_rate|USDRate/.test(code)) continue; // no rate writes here
    if (!code.includes('repriceTenderAfterRateChangeTx')) {
      violations.push(`${rel} — writes currency rates without the atomic reprice pipeline`);
    }
    if (!/ratesChanged\s*:?=/.test(code)) {
      violations.push(`${rel} — missing the ratesChanged gate (pipeline may be skipped or always-on)`);
    }
    // The gate must be decided by VALUE under a row lock, not by the mere
    // presence of a rate field in the patch. Presence-based gating made every
    // admin-modal save (the modal re-submits the whole form) run the full
    // reprice and revoke the financial approval.
    if (!code.includes('diffFinancialInputsTx')) {
      violations.push(`${rel} — ratesChanged must come from diffFinancialInputsTx (value-based, FOR UPDATE), not from a nil-check on the patch`);
    }
    if (/ratesChanged\s*:?=\s*[^\n]*(USDRate|EURRate|CNYRate)\s*!=\s*nil/.test(code)) {
      violations.push(`${rel} — presence-based ratesChanged gate is back (in.USDRate != nil …): re-sending an unchanged rate would reprice the whole tender`);
    }
  }
}

// ─── 7. no FX fallback = 1 ───────────────────────────────────────────────────
{
  // Frontend import path: a "|| 1" / "?? 1" next to a rate is the retired bug.
  for (const rel of [
    'src/pages/ClientPositions/hooks/useMassBoqImport.ts',
    'src/pages/ClientPositions/hooks/useMassBoqImportRefs.ts',
    'src/pages/ClientPositions/utils/massBoqImportPayload.ts',
  ]) {
    const raw = read(rel);
    if (raw == null) continue;
    const code = stripComments(raw);
    const m = /(usd|eur|cny)_?rate[^\n]{0,30}?(\|\||\?\?)\s*1\b/i.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — FX fallback to 1 on the import path`);
    }
  }
  // The Go kernel must keep failing closed on nil/zero rates.
  const rel = 'backend/internal/calc/boq_amount.go';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    if (!/MissingFXRateError/.test(code)) {
      violations.push(`${rel} — kernel lost the MissingFXRateError fail-closed contract`);
    }
  }
}

// ─── 8. frontend mass-import payload sends inputs only ───────────────────────
{
  const rel = 'src/pages/ClientPositions/utils/massBoqImportPayload.ts';
  const raw = read(rel);
  if (raw != null) {
    const code = stripComments(raw);
    // Bare `total_amount:` payload key (client_/server_total_amount in the
    // diagnostic report type are fine).
    const m = /(^|[^_\w])total_amount\s*:/.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — frontend sends a client-calculated total_amount`);
    }
    const calcImport = /calculateTotalAmount/.exec(code);
    if (calcImport) {
      violations.push(`${rel}:${lineOf(code, calcImport.index)} — client-side amount calculation wired back into the import payload`);
    }
  }
}

console.log('serverAuthoritativeImportFx.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: import must persist ONLY server-calculated money; rate changes must reprice atomically.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — import INSERT carries no client total_amount / commercial fields; calc pipeline in-tx');
console.log('  ok — reprice pipeline complete (BOQ → positions → commercial → grand total)');
console.log('  ok — both regular and admin rate updates run the pipeline (value-based ratesChanged gate)');
console.log('  ok — no FX fallback=1 on the import path; kernel keeps MissingFXRateError');
console.log('  ok — frontend mass-import payload sends inputs only');
console.log('\nserverAuthoritativeImportFx.check: passed');
