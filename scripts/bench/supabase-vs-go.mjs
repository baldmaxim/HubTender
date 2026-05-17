#!/usr/bin/env node
// Bench harness: direct Supabase vs Go BFF on the same logical operations.
//
// Usage:
//   node scripts/bench/supabase-vs-go.mjs --tender <uuid> [--position <uuid>] \
//       [--iterations 20] [--warmup 2] [--include-writes] [--report <path>]
//
// Env (loaded from .env / .env.local):
//   VITE_SUPABASE_URL              — pre-prod URL
//   VITE_SUPABASE_PUBLISHABLE_KEY  — anon key
//   SUPABASE_SERVICE_ROLE_KEY      — service role (admin reads, mirroring dual-run)
//   DUAL_RUN_EMAIL                 — test user email
//   DUAL_RUN_PASSWORD              — that user's password
//   VITE_API_URL                   — Go BFF base URL (default http://localhost:3005)
//
// Output:
//   - Console table with p50/p95/p99 per scenario per path.
//   - JSON report at scripts/bench/reports/<timestamp>.json (or --report).
//
// Exit code: always 0 unless harness setup fails. This is a report, not a gate.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── .env loading (mirrors smoke + dual-run) ──────────────────────────────────
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

// ─── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { iterations: 10, warmup: 2, includeWrites: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--tender': out.tender = next(); break;
      case '--position': out.position = next(); break;
      case '--iterations': out.iterations = Number(next()); break;
      case '--warmup': out.warmup = Number(next()); break;
      case '--include-writes': out.includeWrites = true; break;
      case '--report': out.report = next(); break;
      case '-h': case '--help': out.help = true; break;
      default:
        console.error(`Unknown arg: ${a}`);
        process.exit(2);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('Usage: node scripts/bench/supabase-vs-go.mjs --tender <uuid> [options]');
  process.exit(0);
}
if (!args.tender) {
  console.error('--tender <uuid> is required.');
  process.exit(2);
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.DUAL_RUN_EMAIL;
const PASSWORD = process.env.DUAL_RUN_PASSWORD;
const API_URL = process.env.VITE_API_URL ?? 'http://localhost:3005';

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE || !EMAIL || !PASSWORD) {
  console.error('Missing env. Required: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, DUAL_RUN_EMAIL, DUAL_RUN_PASSWORD.');
  process.exit(2);
}

// ─── Clients ──────────────────────────────────────────────────────────────────
const anon = createClient(SUPABASE_URL, ANON_KEY);
const userClient = createClient(SUPABASE_URL, ANON_KEY); // RLS-aware reads
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

let JWT = null;

async function signIn() {
  const { data, error } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) throw new Error('sign-in failed: ' + error.message);
  JWT = data.session.access_token;
  // Set the same session on userClient so its requests carry the user JWT (RLS-aware).
  await userClient.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}

// ─── Stats helpers ────────────────────────────────────────────────────────────
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarise(samples) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    n: sorted.length,
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    mean: round(sum / sorted.length),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
  };
}

function round(n) { return Math.round(n * 100) / 100; }

// ─── Timing primitives ────────────────────────────────────────────────────────
async function timed(fn) {
  const t0 = performance.now();
  let result, error;
  try { result = await fn(); } catch (e) { error = e; }
  const dt = performance.now() - t0;
  return { dt, result, error };
}

async function runIters(label, fn, total, warmup) {
  const samples = [];
  let errors = 0;
  let lastBytes = 0;
  for (let i = 0; i < total; i++) {
    const { dt, result, error } = await timed(fn);
    if (error) { errors++; continue; }
    if (i >= warmup) samples.push(dt);
    if (result?.bytes != null) lastBytes = result.bytes;
  }
  return { label, stats: summarise(samples), errors, bytes: lastBytes };
}

// ─── Go BFF fetch with optional ETag ──────────────────────────────────────────
const etagCache = new Map();

async function goFetch(path, { method = 'GET', body, useEtag = false, cacheKey } = {}) {
  const headers = { Authorization: `Bearer ${JWT}` };
  if (body) headers['Content-Type'] = 'application/json';
  if (useEtag && cacheKey && etagCache.has(cacheKey)) {
    headers['If-None-Match'] = etagCache.get(cacheKey);
  }
  const res = await fetch(API_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 304) {
    return { status: 304, bytes: 0, etag: etagCache.get(cacheKey) ?? null };
  }
  const text = await res.text();
  const bytes = Buffer.byteLength(text);
  if (!res.ok) throw new Error(`go ${res.status}: ${text.slice(0, 200)}`);
  if (cacheKey) {
    const etag = res.headers.get('ETag');
    if (etag) etagCache.set(cacheKey, etag);
  }
  return { status: res.status, bytes, etag: res.headers.get('ETag') ?? null };
}

function clearEtag(cacheKey) {
  etagCache.delete(cacheKey);
}

// ─── Supabase reads (RLS-aware via user JWT) ──────────────────────────────────
async function supaSelect(table, modify = q => q) {
  const q = modify(userClient.from(table).select('*'));
  const { data, error } = await q;
  if (error) throw new Error(`supabase ${table}: ${error.message}`);
  const bytes = Buffer.byteLength(JSON.stringify(data));
  return { rows: data?.length ?? 0, bytes };
}

async function supaRpcAdmin(name, params) {
  // Admin client mirrors what dual-run does for the hot RPC: bypasses RLS, but
  // is the closest parallel to what the Go BFF executes. Use sparingly.
  const { data, error } = await admin.rpc(name, params);
  if (error) throw new Error(`rpc ${name}: ${error.message}`);
  const bytes = Buffer.byteLength(JSON.stringify(data));
  return { rows: data?.length ?? 0, bytes };
}

// ─── Scenarios ────────────────────────────────────────────────────────────────
function buildReadScenarios({ tender, position }) {
  const list = [
    {
      name: 'references:roles',
      cacheKey: 'ref:roles',
      supabase: () => supaSelect('roles'),
      go: ({ useEtag } = {}) => goFetch('/api/v1/references/roles', { useEtag, cacheKey: 'ref:roles' }),
    },
    {
      name: 'references:material-names',
      cacheKey: 'ref:material-names',
      supabase: () => supaSelect('material_names'),
      go: ({ useEtag } = {}) => goFetch('/api/v1/references/material-names', { useEtag, cacheKey: 'ref:material-names' }),
    },
    {
      name: 'references:detail-cost-categories',
      cacheKey: 'ref:detail-cost-categories',
      supabase: () => supaSelect('detail_cost_categories'),
      go: ({ useEtag } = {}) => goFetch('/api/v1/references/detail-cost-categories', { useEtag, cacheKey: 'ref:detail-cost-categories' }),
    },
    {
      name: 'tenders:list',
      cacheKey: 'tenders:list:50',
      supabase: () => supaSelect('tenders', q => q.limit(50)),
      go: ({ useEtag } = {}) => goFetch('/api/v1/tenders?limit=50', { useEtag, cacheKey: 'tenders:list:50' }),
    },
    {
      name: 'tender:overview',
      cacheKey: `tender:overview:${tender}`,
      supabase: () => supaSelect('tenders', q => q.eq('id', tender).single()),
      go: ({ useEtag } = {}) => goFetch(`/api/v1/tenders/${tender}/overview`, { useEtag, cacheKey: `tender:overview:${tender}` }),
    },
    {
      name: 'positions:list',
      cacheKey: `positions:list:${tender}`,
      supabase: () => supaSelect('client_positions', q => q.eq('tender_id', tender)),
      go: ({ useEtag } = {}) => goFetch(`/api/v1/tenders/${tender}/positions`, { useEtag, cacheKey: `positions:list:${tender}` }),
    },
    {
      name: 'positions:with-costs',
      cacheKey: `positions:with-costs:${tender}`,
      supabase: () => supaRpcAdmin('get_positions_with_costs', { p_tender_id: tender }),
      go: ({ useEtag } = {}) => goFetch(`/api/v1/tenders/${tender}/positions/with-costs`, { useEtag, cacheKey: `positions:with-costs:${tender}` }),
    },
  ];
  if (position) {
    list.push({
      name: 'boq:items-by-position',
      cacheKey: `boq:${tender}:${position}`,
      supabase: () => supaSelect('boq_items', q => q.eq('client_position_id', position)),
      go: ({ useEtag } = {}) => goFetch(`/api/v1/tenders/${tender}/positions/${position}/items`, { useEtag, cacheKey: `boq:${tender}:${position}` }),
    });
  }
  return list;
}

// Write scenarios are stubbed: они требуют тестового тендера и осмысленного
// payload'а, который зависит от реальной схемы. Чтобы не портить данные на
// shared pre-prod, пока возвращаем понятный TODO — пусть пользователь решит,
// на какой инфраструктуре их гонять.
function buildWriteScenarios() {
  return [
    {
      name: 'boq:bulk-commercial',
      todo: 'нужен набор item_id + новые цены; включается на изолированном тестовом тендере',
    },
    {
      name: 'redistributions:save',
      todo: 'нужен реалистичный payload с дельтами; писать только на dev-инфре',
    },
    {
      name: 'imports:boq',
      todo: 'нужен Excel-производный JSON; писать только на dev-инфре',
    },
  ];
}

// ─── Bench runner ─────────────────────────────────────────────────────────────
async function benchOne(scenario, { iterations, warmup }) {
  const out = { name: scenario.name };

  const supabase = await runIters(
    `${scenario.name} / supabase`,
    scenario.supabase,
    iterations,
    warmup,
  );
  out.supabase = supabase;

  // Cold Go: ETag cache cleared before EACH iteration so we never get 304.
  const goCold = await runIters(
    `${scenario.name} / go cold`,
    async () => { clearEtag(scenario.cacheKey); return scenario.go({ useEtag: false }); },
    iterations,
    warmup,
  );
  out.goCold = goCold;

  // Warm Go: prime cache once, then iterate with If-None-Match (expect 304s).
  try { await scenario.go({ useEtag: false }); } catch { /* ignore */ }
  const goWarm = await runIters(
    `${scenario.name} / go warm`,
    () => scenario.go({ useEtag: true }),
    iterations,
    warmup,
  );
  out.goWarm = goWarm;

  return out;
}

// ─── Reporting ────────────────────────────────────────────────────────────────
function fmtPair(stats) {
  if (!stats) return '   —    ';
  return `${String(Math.round(stats.p50)).padStart(4)} / ${String(Math.round(stats.p95)).padStart(4)}`;
}

function fmtBytes(b) {
  if (!b) return '—';
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)}kB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
}

function printTable(results) {
  console.log('');
  console.log('Results (latency ms — p50 / p95):');
  console.log('');
  const header = `${'scenario'.padEnd(36)}${'supabase'.padEnd(16)}${'go (cold)'.padEnd(16)}${'go (warm)'.padEnd(16)}${'payload (s/g)'}`;
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of results) {
    const row =
      r.name.padEnd(36) +
      fmtPair(r.supabase.stats).padEnd(16) +
      fmtPair(r.goCold.stats).padEnd(16) +
      fmtPair(r.goWarm.stats).padEnd(16) +
      `${fmtBytes(r.supabase.bytes)} / ${fmtBytes(r.goCold.bytes)}`;
    console.log(row);
  }
  console.log('');
}

function defaultReportPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  const reports = join(here, 'reports');
  if (!existsSync(reports)) mkdirSync(reports, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return join(reports, `${ts}.json`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Target: Go BFF=${API_URL}, Supabase=${SUPABASE_URL}`);
  console.log(`Tender: ${args.tender}${args.position ? `, position: ${args.position}` : ''}`);
  console.log(`Iterations: ${args.iterations} (warmup: ${args.warmup})`);
  console.log('');

  await signIn();
  console.log('  ✓ JWT obtained');
  console.log('');

  const scenarios = buildReadScenarios({ tender: args.tender, position: args.position });
  const results = [];
  for (const s of scenarios) {
    process.stdout.write(`  ▸ ${s.name} ... `);
    try {
      const r = await benchOne(s, { iterations: args.iterations, warmup: args.warmup });
      results.push(r);
      console.log('ok');
    } catch (e) {
      console.log(`FAIL — ${e.message}`);
      results.push({ name: s.name, error: e.message });
    }
  }

  if (args.includeWrites) {
    console.log('');
    console.log('Write scenarios (placeholder — see scripts/bench/README.md):');
    for (const w of buildWriteScenarios()) {
      console.log(`  · ${w.name}: TODO — ${w.todo}`);
    }
  }

  printTable(results);

  const reportPath = args.report ?? defaultReportPath();
  const report = {
    timestamp: new Date().toISOString(),
    args,
    target: { apiUrl: API_URL, supabaseUrl: SUPABASE_URL },
    results,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report saved: ${reportPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
