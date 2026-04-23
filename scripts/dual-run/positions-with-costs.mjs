#!/usr/bin/env node
// Dual-run verification for the get_positions_with_costs RPC / GET /api/v1/tenders/:id/positions/with-costs.
//
// Queries both the Supabase RPC (original) and the Go BFF endpoint (ported) for
// the given tender id(s), diffs the rows with a tolerance on money fields, and
// exits non-zero on any mismatch. Run before enabling VITE_API_POSITIONS_ENABLED
// in production.
//
// Usage:
//   node scripts/dual-run/positions-with-costs.mjs <tender-id> [<tender-id> ...]
//
// Required env (via .env or shell):
//   SUPABASE_URL                — pre-prod URL, e.g. https://ocauafggjrqvopxjihas.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   — service role key (reads only, used for the RPC call)
//   DUAL_RUN_EMAIL              — test user email with access to the tender(s)
//   DUAL_RUN_PASSWORD           — that user's password
//   VITE_API_URL                — Go BFF base URL, e.g. http://localhost:3005
//
// Tolerance: 0.01 RUB on all numeric fields.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── .env loading ─────────────────────────────────────────────────────────────
function loadDotenv() {
  const candidates = ['.env', '.env.local'];
  for (const name of candidates) {
    try {
      const raw = readFileSync(join(process.cwd(), name), 'utf8');
      for (const line of raw.split('\n')) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (!m) continue;
        if (process.env[m[1]] === undefined) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
      }
    } catch { /* file absent */ }
  }
}
loadDotenv();

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.DUAL_RUN_EMAIL;
const PASSWORD = process.env.DUAL_RUN_PASSWORD;
const API_URL = process.env.VITE_API_URL ?? 'http://localhost:3005';
const TOLERANCE = 0.01;

if (!SUPABASE_URL || !SERVICE_ROLE || !EMAIL || !PASSWORD) {
  console.error('Missing env. Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DUAL_RUN_EMAIL, DUAL_RUN_PASSWORD.');
  process.exit(2);
}

const tenderIds = process.argv.slice(2);
if (tenderIds.length === 0) {
  console.error('Usage: node scripts/dual-run/positions-with-costs.mjs <tender-id> [<tender-id> ...]');
  process.exit(2);
}

// ─── Clients ──────────────────────────────────────────────────────────────────
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
// Anon client just for sign-in to obtain a user JWT for the Go endpoint.
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
if (!anonKey) {
  console.error('Missing VITE_SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY for sign-in.');
  process.exit(2);
}
const anon = createClient(SUPABASE_URL, anonKey);

async function getJwt() {
  const { data, error } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) throw new Error('sign-in failed: ' + error.message);
  return data.session.access_token;
}

// ─── Comparators ──────────────────────────────────────────────────────────────
const NUMERIC_FIELDS = new Set([
  'position_number', 'volume', 'manual_volume',
  'total_material', 'total_works',
  'material_cost_per_unit', 'work_cost_per_unit',
  'total_commercial_material', 'total_commercial_work',
  'total_commercial_material_per_unit', 'total_commercial_work_per_unit',
  'base_total', 'commercial_total', 'material_cost_total', 'work_cost_total',
  'markup_percentage', 'items_count',
]);

function diffRow(a, b) {
  const diffs = [];
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) {
    const va = a?.[k], vb = b?.[k];
    if (NUMERIC_FIELDS.has(k)) {
      const na = Number(va ?? 0), nb = Number(vb ?? 0);
      if (Math.abs(na - nb) > TOLERANCE) diffs.push(`${k}: supabase=${na} go=${nb} delta=${(na - nb).toFixed(4)}`);
    } else {
      // Normalise null/undefined; ignore created_at/updated_at diff up to second resolution.
      if (k === 'created_at' || k === 'updated_at') continue;
      const sa = va ?? null, sb = vb ?? null;
      if (sa !== sb) diffs.push(`${k}: supabase=${JSON.stringify(sa)} go=${JSON.stringify(sb)}`);
    }
  }
  return diffs;
}

// ─── Runner ───────────────────────────────────────────────────────────────────
async function fetchSupabase(tenderId) {
  // Service-role bypasses RLS and calls the SQL function directly.
  const all = [];
  const PAGE = 1000;
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await admin
      .rpc('get_positions_with_costs', { p_tender_id: tenderId })
      .range(from, from + PAGE - 1);
    if (error) throw new Error('supabase rpc: ' + error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

async function fetchGo(tenderId, jwt) {
  const res = await fetch(`${API_URL}/api/v1/tenders/${encodeURIComponent(tenderId)}/positions/with-costs`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`go ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.data ?? [];
}

async function runOne(tenderId, jwt) {
  const [sbRows, goRows] = await Promise.all([fetchSupabase(tenderId), fetchGo(tenderId, jwt)]);
  const sbById = new Map(sbRows.map(r => [r.id, r]));
  const goById = new Map(goRows.map(r => [r.id, r]));

  if (sbRows.length !== goRows.length) {
    console.warn(`[${tenderId}] row count differs: supabase=${sbRows.length} go=${goRows.length}`);
  }

  let mismatches = 0;
  for (const id of new Set([...sbById.keys(), ...goById.keys()])) {
    const diffs = diffRow(sbById.get(id), goById.get(id));
    if (diffs.length > 0) {
      mismatches++;
      console.error(`[${tenderId}] position ${id}:\n    ` + diffs.join('\n    '));
    }
  }
  const ok = mismatches === 0 && sbRows.length === goRows.length;
  console.log(`[${tenderId}] ${ok ? 'OK' : 'FAIL'} — supabase=${sbRows.length} go=${goRows.length} mismatches=${mismatches}`);
  return ok;
}

async function main() {
  const jwt = await getJwt();
  let allOk = true;
  for (const id of tenderIds) {
    try {
      const ok = await runOne(id, jwt);
      if (!ok) allOk = false;
    } catch (err) {
      console.error(`[${id}] error: ${err.message}`);
      allOk = false;
    }
  }
  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
