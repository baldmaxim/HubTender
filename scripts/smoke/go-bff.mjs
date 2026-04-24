#!/usr/bin/env node
// Smoke test for the Go BFF. Exercises every read endpoint as a signed-in
// user and asserts 2xx + a minimal shape of the response.
//
// Usage:
//   node scripts/smoke/go-bff.mjs
//
// Required env (via .env or shell):
//   VITE_SUPABASE_URL            (or SUPABASE_URL)
//   VITE_SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)
//   VITE_API_URL                 — Go BFF base URL (default http://localhost:3005)
//   DUAL_RUN_EMAIL               — test user email (re-used from dual-run setup)
//   DUAL_RUN_PASSWORD            — that user's password
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadDotenv() {
  for (const name of ['.env', '.env.local']) {
    try {
      const raw = readFileSync(join(process.cwd(), name), 'utf8');
      for (const line of raw.split('\n')) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (!m) continue;
        if (process.env[m[1]] === undefined) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
      }
    } catch { /* absent */ }
  }
}
loadDotenv();

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const API_URL = process.env.VITE_API_URL ?? 'http://localhost:3005';
const EMAIL = process.env.DUAL_RUN_EMAIL;
const PASSWORD = process.env.DUAL_RUN_PASSWORD;

if (!SUPABASE_URL || !ANON_KEY || !EMAIL || !PASSWORD) {
  console.error('Missing env. Required: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, DUAL_RUN_EMAIL, DUAL_RUN_PASSWORD.');
  process.exit(2);
}

const client = createClient(SUPABASE_URL, ANON_KEY);

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function unauth(path, expected = 401) {
  const res = await fetch(API_URL + path);
  record(`${expected} unauth ${path}`, res.status === expected, `got ${res.status}`);
}

async function get(path, jwt, assert) {
  const res = await fetch(API_URL + path, { headers: { Authorization: `Bearer ${jwt}` } });
  const ok = res.ok;
  let detail = `HTTP ${res.status}`;
  if (ok && assert) {
    try {
      const body = await res.json();
      const err = assert(body);
      if (err) {
        record(path, false, err);
        return;
      }
      detail += ' — shape ok';
    } catch (e) {
      record(path, false, 'json parse: ' + e.message);
      return;
    }
  }
  record(path, ok, detail);
}

async function main() {
  console.log(`Target: ${API_URL}`);
  console.log('');
  console.log('Public endpoints:');
  const h1 = await fetch(API_URL + '/health');
  record('GET /health', h1.ok, `HTTP ${h1.status}`);
  const h2 = await fetch(API_URL + '/health/db');
  record('GET /health/db', h2.ok, `HTTP ${h2.status}`);

  console.log('');
  console.log('Unauthorized expectations:');
  await unauth('/api/v1/me');
  await unauth('/api/v1/references/units');
  await unauth('/api/v1/tenders');
  await unauth('/api/v1/ws');
  {
    const res = await fetch(API_URL + '/api/v1/redistributions/save', { method: 'POST' });
    record('401 unauth POST /api/v1/redistributions/save', res.status === 401, `got ${res.status}`);
  }

  console.log('');
  console.log('Signing in as', EMAIL);
  const { data, error } = await client.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) {
    console.error('sign-in failed:', error.message);
    process.exit(1);
  }
  const jwt = data.session.access_token;
  console.log('  ✓ JWT obtained');

  console.log('');
  console.log('Authenticated reads:');
  await get('/api/v1/me', jwt, b => (b.id ? null : 'no id'));
  await get('/api/v1/me/permissions', jwt, b => (Array.isArray(b.allowed_pages) ? null : 'no allowed_pages'));

  const refs = ['roles', 'units', 'material-names', 'work-names', 'cost-categories', 'detail-cost-categories'];
  for (const r of refs) {
    await get(`/api/v1/references/${r}`, jwt, b => (Array.isArray(b.data) ? null : 'no data array'));
  }

  await get('/api/v1/tenders?limit=5', jwt, b => (Array.isArray(b.data) ? null : 'no data array'));

  console.log('');
  const failed = results.filter(r => !r.ok);
  if (failed.length === 0) {
    console.log(`✓ All ${results.length} checks passed.`);
    process.exit(0);
  } else {
    console.log(`✗ ${failed.length}/${results.length} checks FAILED:`);
    for (const f of failed) console.log(`    - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
