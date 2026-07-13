// Stage 0.1.2.2b source guard — run via tsx:
//   npx tsx scripts/checks/noDerivedAuditRollback.check.mjs
//
// Audit rollback restores ONLY user-editable inputs from a SERVER-SIDE audit
// snapshot. The calculated money columns (total_amount, commercial_markup,
// total_commercial_material_cost, total_commercial_work_cost) must never be
// written from a snapshot as authoritative — they are recomputed by
// backend/internal/calc from the CURRENT tender FX/configuration inside the
// same transaction.
//
// This check fails if the production rollback code ever starts:
//   - assigning a derived column from the snapshot (SQL SET/INSERT column list);
//   - rebuilding the row from arbitrary JSON keys (jsonb_populate_record /
//     dynamic SET from snapshot keys);
//   - growing its own quantity*unit_rate formula or an FX fallback of 1;
//   - accepting a client-provided snapshot (before_data/after_data / request
//     body in the rollback handler / client-side old_data patch).
//
// Reading derived values for audit-history DISPLAY stays legitimate (the list
// endpoint returns old_data/new_data raw) — the rules below target writes and
// snapshot-sourced assignments, not any mention of the columns.
//
// Scope: production rollback files + related DTO surface. Tests, fixtures and
// docs are NOT scanned.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const GO_FILES = [
  'backend/internal/repository/boq_audit_rollback.go',
  'backend/internal/repository/boq_audit_snapshot.go',
];
const HANDLER_FILE = 'backend/internal/handlers/boq_audit_rollback.go';
const FRONTEND_FILE = 'src/pages/PositionItems/hooks/useAuditRollback.ts';

const DERIVED = [
  'total_amount',
  'commercial_markup',
  'total_commercial_material_cost',
  'total_commercial_work_cost',
];

/** Strip // line comments and /* block *​/ comments, preserving offsets. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const violations = [];
const lineOf = (text, i) => text.slice(0, i).split('\n').length;

function readOrFlag(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    violations.push(`${rel} — file missing (guard must be kept in sync)`);
    return null;
  }
  return stripComments(readFileSync(abs, 'utf8'));
}

// ─── production Go rollback files ────────────────────────────────────────────
for (const rel of GO_FILES) {
  const code = readOrFlag(rel);
  if (code == null) continue;

  // 1. No whole-JSON row materialisation — the pre-0.1.2.2b anti-pattern.
  const popRec = /jsonb_populate_record/i.exec(code);
  if (popRec) {
    violations.push(`${rel}:${lineOf(code, popRec.index)} — jsonb_populate_record rebuilds the row from arbitrary snapshot keys`);
  }

  // 2. A derived column must never be ASSIGNED (SQL "col =" in SET lists).
  for (const col of DERIVED) {
    const re = new RegExp(`\\b${col}\\s*=`, 'i');
    const m = re.exec(code);
    if (m) {
      violations.push(`${rel}:${lineOf(code, m.index)} — assigns derived column from rollback code: ${m[0].trim()}`);
    }
  }

  // 3. A derived column must never appear in an INSERT column list.
  const insertRe = /INSERT\s+INTO\s+public\.boq_items\s*\(([\s\S]*?)\)/gi;
  let ins;
  while ((ins = insertRe.exec(code)) !== null) {
    for (const col of DERIVED) {
      if (new RegExp(`\\b${col}\\b`).test(ins[1])) {
        violations.push(`${rel}:${lineOf(code, ins.index)} — derived column "${col}" in an INSERT column list`);
      }
    }
  }

  // 4. No local money formula, no FX fallback to 1.
  const formula = /quantity\s*\*\s*unit_?rate|unitRate\s*\*\s*(cRate|rate)/i.exec(code);
  if (formula) {
    violations.push(`${rel}:${lineOf(code, formula.index)} — local money formula (use calc.CalculateBoqItemTotalAmount): ${formula[0]}`);
  }
  const fx = /orOne\s*\(\s*(usd|eur|cny)/i.exec(code);
  if (fx) {
    violations.push(`${rel}:${lineOf(code, fx.index)} — FX fallback to 1.0: ${fx[0]}`);
  }

  // 5. No client payload types in the rollback repo surface.
  const clientSnap = /before_data|after_data/i.exec(code);
  if (clientSnap) {
    violations.push(`${rel}:${lineOf(code, clientSnap.index)} — client snapshot field in production rollback code: ${clientSnap[0]}`);
  }
}

// ─── rollback handler: the command is audit-id-only, no body decode ──────────
{
  const code = readOrFlag(HANDLER_FILE);
  if (code != null) {
    const body = /json\.NewDecoder\s*\(\s*r\.Body\s*\)|io\.ReadAll\s*\(\s*r\.Body\s*\)|before_data|after_data/.exec(code);
    if (body) {
      violations.push(`${HANDLER_FILE}:${lineOf(code, body.index)} — rollback handler must not read a client snapshot/body: ${body[0]}`);
    }
  }
}

// ─── frontend hook: never send a snapshot, never patch from old_data ─────────
{
  const code = readOrFlag(FRONTEND_FILE);
  if (code != null) {
    const patterns = [
      [/updateBoqItemWithAudit/, 'client-side rollback patch (updateBoqItemWithAudit) is retired — the server restores from its own audit record'],
      [/JSON\.stringify\s*\([^)]*old_data/s, 'old_data must never be serialised into a request body'],
      [/body\s*:\s*JSON\.stringify/, 'the rollback request must carry NO body (audit id only)'],
      [/before_data|after_data/, 'client snapshot field'],
    ];
    for (const [re, msg] of patterns) {
      const m = re.exec(code);
      if (m) {
        violations.push(`${FRONTEND_FILE}:${lineOf(code, m.index)} — ${msg}: ${m[0].slice(0, 60)}`);
      }
    }
  }
}

console.log('noDerivedAuditRollback.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: audit rollback must not restore derived money / accept client snapshots.');
  console.error('    Inputs come from the server-side audit record; total_amount and commercial_*');
  console.error('    are recomputed by backend/internal/calc in the same transaction.\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — no jsonb_populate_record / dynamic snapshot SET in rollback code');
console.log('  ok — no derived column assigned or inserted from a snapshot');
console.log('  ok — no local money formula, no FX fallback = 1');
console.log('  ok — handler takes audit id only; frontend sends no snapshot');
console.log('\nnoDerivedAuditRollback.check: passed');
