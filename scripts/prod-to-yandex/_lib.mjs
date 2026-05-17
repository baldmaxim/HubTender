// Shared helpers for scripts/prod-to-yandex/*. ESM. No secrets ever logged.
//
// SAFETY: never console.log a raw connection string, password, cert, or token.
// Source for the Yandex stage is PROD Supabase ONLY — OLD_SUPABASE_DB_URL is
// never read or used by any prod-to-yandex script.

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..', '..');
export const SQL_DIR = join(REPO_ROOT, 'db', 'yandex', 'sql');
export const DOC_DIR = join(REPO_ROOT, 'docs', 'yandex-migration');

// Canonical lexical apply order (also the verify "expected" order).
export const EXPECTED_SQL_FILES = [
  '00_schemas.sql',
  '01_auth_compat_or_app_auth.sql',
  '02_enums.sql',
  '03_tables.sql',
  '04_functions.sql',
  '05_triggers.sql',
  '06_indexes_constraints.sql',
  '07_pgnotify.sql',
  '08_permissions.sql',
  '90_rls_note.sql',
];

// ---------------------------------------------------------------------------
// env loading — scoped to the prod-to-yandex env file; .env/.env.local only as
// fallback; never overwrites an already-set process.env value.
// ---------------------------------------------------------------------------
export function loadEnv() {
  const candidates = [
    join(__dirname, '.env.prod-to-yandex'),
    join(REPO_ROOT, '.env'),
    join(REPO_ROOT, '.env.local'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    let raw;
    try { raw = readFileSync(path, 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
    }
  }
}

export const env = (k) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : '';
};

// ---------------------------------------------------------------------------
// redaction
// ---------------------------------------------------------------------------
export function maskHost(url) {
  try {
    const h = new URL(url).hostname;
    const p = h.split('.');
    return p.length > 2 ? `***.${p.slice(-2).join('.')}` : '***';
  } catch { return '***'; }
}
export function sslrootcertOf(url) {
  if (!url) return '';
  try {
    const v = new URL(url).searchParams.get('sslrootcert');
    return v ? v.trim() : '';
  } catch { return ''; }
}
export function safeErr(e) {
  return String(e?.message || e?.code || e)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '<redacted-conn>');
}

// Resolve the Yandex CA: explicit env var wins, else DSN sslrootcert=.
export function resolveCa() {
  let path = env('YANDEX_SSL_ROOT_CERT');
  let source = 'YANDEX_SSL_ROOT_CERT';
  if (!path) {
    path = sslrootcertOf(env('YANDEX_DATABASE_URL'))
        || sslrootcertOf(env('YANDEX_DIRECT_DATABASE_URL'));
    if (path) source = 'DSN sslrootcert';
  }
  if (!path) return { ok: false, reason: 'CA unset (env + DSN)' };
  if (!existsSync(path)) return { ok: false, reason: `CA file not found (${source})` };
  try {
    return { ok: true, pem: readFileSync(path, 'utf8'), source };
  } catch (e) {
    return { ok: false, reason: `CA read error: ${safeErr(e)}` };
  }
}

// Strict TLS (verify-full equivalent: ca + rejectUnauthorized). Read/write
// depends on caller; this module never issues writes itself.
export async function connectStrict(url, caPem, appName) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: url,
    ssl: { ca: caPem, rejectUnauthorized: true },
    statement_timeout: 0,
    query_timeout: 0,
    connectionTimeoutMillis: 12000,
    application_name: appName,
  });
  await client.connect();
  return client;
}

// ---------------------------------------------------------------------------
// SQL file discovery
// ---------------------------------------------------------------------------
export function listSqlFiles() {
  if (!existsSync(SQL_DIR)) return [];
  return readdirSync(SQL_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

// ---------------------------------------------------------------------------
// Comment-aware SQL stripping.
//
// Removes line (--) and block (/* */) comments while PRESERVING single-quoted
// strings and dollar-quoted bodies, so the forbidden-statement scan inspects
// real executable code (including function bodies) but ignores commentary.
// ---------------------------------------------------------------------------
export function stripSqlComments(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);

    if (two === '--') {
      let j = i + 2;
      while (j < n && sql[j] !== '\n') j++;
      out += ' ';
      i = j;
      continue;
    }
    if (two === '/*') {
      let j = i + 2;
      while (j < n && sql.slice(j, j + 2) !== '*/') j++;
      out += ' ';
      i = j < n ? j + 2 : n;
      continue;
    }
    if (ch === "'") {
      out += ch;
      i++;
      while (i < n) {
        out += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { out += sql[i + 1]; i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '$') {
      const m = sql.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
      if (m) {
        const tag = m[0];
        const start = i + tag.length;
        const end = sql.indexOf(tag, start);
        if (end === -1) { out += sql.slice(i); i = n; }
        else { out += sql.slice(i, end + tag.length); i = end + tag.length; }
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

// Forbidden EXECUTABLE statements. Comment-only matches are ignored because the
// scan runs on stripSqlComments() output. Returns [{file, rule, sample}].
const FORBIDDEN_RULES = [
  { rule: 'CREATE EXTENSION',          re: /\bCREATE\s+EXTENSION\b/i },
  { rule: 'CREATE ROLE',               re: /\bCREATE\s+ROLE\b/i },
  { rule: 'ALTER ROLE',                re: /\bALTER\s+ROLE\b/i },
  { rule: 'ALTER SYSTEM',              re: /\bALTER\s+SYSTEM\b/i },
  { rule: 'session_replication_role',  re: /\bsession_replication_role\b/i },
  { rule: 'GRANT ... TO authenticated', re: /\bGRANT\b[^;]*\bTO\b[^;]*\bauthenticated\b/i },
  { rule: 'GRANT ... TO anon',          re: /\bGRANT\b[^;]*\bTO\b[^;]*\banon\b/i },
  { rule: 'service_role',              re: /\bservice_role\b/i },
  { rule: 'authenticator',             re: /\bauthenticator\b/i },
];

export function forbiddenScan(files) {
  const hits = [];
  for (const f of files) {
    let raw;
    try { raw = readFileSync(join(SQL_DIR, f), 'utf8'); } catch { continue; }
    const code = stripSqlComments(raw);
    for (const { rule, re } of FORBIDDEN_RULES) {
      const m = code.match(re);
      if (m) {
        hits.push({
          file: f,
          rule,
          sample: m[0].replace(/\s+/g, ' ').slice(0, 60),
        });
      }
    }
  }
  return hits;
}

// ===========================================================================
// DATA-MIGRATION HELPERS (PROD Supabase → Yandex) — ported from
// scripts/old-to-prod/_lib.mjs and adapted. Source for the data stage is
// PROD_SUPABASE_DB_URL (or PROD_SUPABASE_EXPORT_DB_URL override) ONLY.
// OLD_SUPABASE_DB_URL must NEVER be used; assertNoOldEnv() fails fast on it.
// All exports above are preserved verbatim — these are ADDITIVE.
// ===========================================================================

/**
 * Hard guard: OLD_SUPABASE_DB_URL must never be present for the Yandex stage.
 * Throws (caller maps to exit 7) — this helper never reads/returns the value.
 */
export function assertNoOldEnv() {
  if (process.env.OLD_SUPABASE_DB_URL && process.env.OLD_SUPABASE_DB_URL.trim()) {
    throw new Error(
      'OLD_SUPABASE_DB_URL is set but is FORBIDDEN as a Yandex-stage source ' +
      '(see docs/yandex-migration/00_SOURCE_OF_TRUTH.md). The prod-to-yandex ' +
      'scripts never read it. Remove it from the prod-to-yandex env and re-run.',
    );
  }
}

/** Throw with a friendly message if a required env var is missing/empty. */
export function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `Missing required env var ${name}. Copy ` +
      `scripts/prod-to-yandex/.env.prod-to-yandex.example to ` +
      `scripts/prod-to-yandex/.env.prod-to-yandex and fill it in.`,
    );
  }
  return v.trim();
}

/** EXPORT_DIR (default ./.prod-to-yandex-export) with auto-create. */
export function getExportDir() {
  const dir = process.env.EXPORT_DIR || './.prod-to-yandex-export';
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Redact a connection string for logging:
 * `postgresql://user:***@<redacted>/<redacted>`. 'invalid-url' on parse fail.
 */
export function redactUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    const user = u.username || 'anon';
    return `${u.protocol}//${user}:***@<redacted>/<redacted>`;
  } catch {
    return 'invalid-url';
  }
}

/** Mask email: 'jane.doe@example.com' → 'j***@example.com'. */
export function redactEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***@${email.slice(at + 1)}`;
}

/**
 * Classify a connection URL as direct / pooler / yandex / unknown WITHOUT
 * exposing the URL. Handles both Supabase host patterns AND yandexcloud.net.
 */
export function redactHostType(url) {
  if (!url || typeof url !== 'string') return 'unknown';
  if (/yandexcloud\.net/i.test(url)) return 'yandex';
  if (/pooler\.supabase\.com/i.test(url)) return 'pooler';
  if (/\.supabase\.co/i.test(url)) return 'direct';
  if (/pool|pgbouncer|:6432/i.test(url)) return 'pooler';
  if (/:5432/.test(url)) return 'direct';
  return 'unknown';
}

// pg.types.setTypeParser is a PROCESS-WIDE singleton (shared by every Client).
// Parse date/timestamp/timestamptz/json/jsonb as RAW PG text (identity) so the
// server-side md5(string_agg(t::text)) checksum is byte-stable PROD↔Yandex for
// temporal AND json/jsonb columns. Same rationale as old-to-prod/_lib.mjs.
let _rawTypeParsersInstalled = false;
export async function installPgRawTypeParsers() {
  if (_rawTypeParsersInstalled) return;
  const { default: pg } = await import('pg');
  const ident = (v) => v; // raw PG text — never coerce to JS Date / object
  const b = pg.types?.builtins ?? {};
  pg.types.setTypeParser(b.DATE ?? 1082, ident);
  pg.types.setTypeParser(b.TIMESTAMP ?? 1114, ident);
  pg.types.setTypeParser(b.TIMESTAMPTZ ?? 1184, ident);
  pg.types.setTypeParser(b.JSON ?? 114, ident);
  pg.types.setTypeParser(b.JSONB ?? 3802, ident);
  _rawTypeParsersInstalled = true;
}

/**
 * Fail-fast guard: confirm raw type parsers + deterministic session are in
 * effect before any export/verify reads real data. Returns sample strings for
 * manifests; throws if pg still yields JS Date / object or lossy temporal.
 */
export async function assertTemporalRawParsers(client) {
  const { rows: [r] } = await client.query(
    `SELECT '2026-05-17'::date AS d,
            '2026-05-17 12:34:56.123456'::timestamp AS ts,
            '2026-05-17 12:34:56.123456+00'::timestamptz AS tstz,
            '{"b":2,"a":1}'::jsonb AS jb,
            '{"b":2,"a":1}'::json AS js`,
  );
  const ok =
    typeof r.d === 'string' && r.d === '2026-05-17' &&
    typeof r.ts === 'string' && r.ts.includes('.123456') &&
    typeof r.tstz === 'string' && r.tstz.includes('.123456') &&
    typeof r.jb === 'string' && typeof r.js === 'string';
  if (!ok) {
    throw new Error(
      'Raw type-parser self-check FAILED — pg returned non-string/lossy values ' +
      `(d=${typeof r.d}:${r.d} ts=${typeof r.ts}:${r.ts} ` +
      `tstz=${typeof r.tstz}:${r.tstz} jsonb=${typeof r.jb} json=${typeof r.js}). ` +
      'installPgRawTypeParsers()/UTC session did not take effect. ' +
      'Refusing to export/verify to avoid data corruption.',
    );
  }
  return { date: r.d, timestamp: r.ts, timestamptz: r.tstz, jsonb: r.jb, json: r.js };
}

async function pinDeterministicSession(client) {
  try {
    await client.query("SET TIME ZONE 'UTC'");
    await client.query("SET DateStyle = 'ISO, MDY'");
  } catch (e) {
    await client.end().catch(() => {});
    throw new Error(
      `Failed to pin deterministic session (SET TIME ZONE 'UTC' / DateStyle ` +
      `'ISO, MDY'): ${e.message}. Refusing to proceed — checksum determinism ` +
      `cannot be guaranteed.`,
    );
  }
}

/**
 * pg.Client for the PROD Supabase source. Supabase rotates intermediates;
 * we accept the chain without strict verification (rejectUnauthorized:false)
 * exactly like old-to-prod getClient(). Raw parsers + UTC/ISO session pinned.
 */
export async function getSupabaseClient(url, opts = {}) {
  const { default: pg } = await import('pg');
  await installPgRawTypeParsers();
  const defaultTimeoutMs = parseInt(process.env.PG_QUERY_TIMEOUT_MS || '300000', 10);
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : defaultTimeoutMs;
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    statement_timeout: timeoutMs,
    query_timeout: timeoutMs,
    connectionTimeoutMillis: Number.isFinite(opts.connectTimeoutMs) ? opts.connectTimeoutMs : 15000,
    application_name: opts.applicationName || 'prod-to-yandex',
  });
  await client.connect();
  await pinDeterministicSession(client);
  return client;
}

/**
 * pg.Client for the Yandex target. STRICT TLS verify-full via the existing
 * connectStrict() + same raw parsers + UTC/ISO session for checksum
 * determinism. caPem from resolveCa().
 */
export async function getYandexClient(url, caPem, opts = {}) {
  await installPgRawTypeParsers();
  const client = await connectStrict(url, caPem, opts.applicationName || 'prod-to-yandex');
  await pinDeterministicSession(client);
  return client;
}

/** Write JSON with stable formatting and trailing newline. */
export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/** Pretty single-line label, e.g. "[PROD] ...". */
export function tag(label) {
  return `[${label.padEnd(4, ' ')}]`;
}

/**
 * Wrap node:util.parseArgs with a friendly --help. Returns {values,positionals}.
 * Boolean flags default false unless stated; string flags need a default.
 */
export function parseCliArgs({ name, description, options }) {
  const optionsForParse = {};
  for (const [key, cfg] of Object.entries(options)) {
    optionsForParse[key] = { type: cfg.type };
    if (cfg.short) optionsForParse[key].short = cfg.short;
    if (cfg.multiple) optionsForParse[key].multiple = cfg.multiple;
  }
  optionsForParse.help = { type: 'boolean', short: 'h' };
  let parsed;
  try {
    parsed = parseArgs({ options: optionsForParse, allowPositionals: true, strict: true });
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    console.error('    Try --help.');
    process.exit(2);
  }
  if (parsed.values.help) {
    console.log(name);
    if (description) console.log(`  ${description}`);
    console.log('\nOptions:');
    const maxKey = Math.max(...Object.keys(options).map((k) => k.length), 8);
    for (const [key, cfg] of Object.entries(options)) {
      const flag = `--${key}`.padEnd(maxKey + 4);
      const dflt = cfg.default !== undefined ? ` [default: ${JSON.stringify(cfg.default)}]` : '';
      console.log(`  ${flag} ${cfg.describe ?? ''}${dflt}`);
    }
    console.log('  --help        show this and exit');
    process.exit(0);
  }
  for (const [key, cfg] of Object.entries(options)) {
    if (parsed.values[key] === undefined && cfg.default !== undefined) {
      parsed.values[key] = cfg.default;
    }
  }
  return parsed;
}

/**
 * Two-key safety gate. If `cliFlag` set, require process.env[envVar]==='true'.
 * Env-only without cliFlag is a no-op (env PERMITS, does not ACTIVATE).
 * Throws (sync) on policy violation.
 */
export function twoKeyGuard({ cliFlag, envVar, label }) {
  if (!cliFlag) return;
  if (process.env[envVar] !== 'true') {
    throw new Error(
      `${label}: --${label.toLowerCase().replace(/\s+/g, '-')} requires ${envVar}=true ` +
      `in scripts/prod-to-yandex/.env.prod-to-yandex. Refusing to proceed for safety.`,
    );
  }
}

/**
 * Exit(2) with a friendly message if any named files are missing in EXPORT_DIR.
 */
export function requireExportFiles(exportDir, names, hint) {
  const missing = names.filter((n) => !existsSync(join(exportDir, n)));
  if (missing.length === 0) return;
  console.error(`✗ Missing required file(s) in ${exportDir}:`);
  for (const m of missing) console.error(`    - ${m}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(2);
}

/**
 * Friendly handler for unexpected exceptions in top-level scripts. Strips
 * connection-string-looking substrings from messages before printing.
 * No stack trace unless DEBUG=true.
 */
export function fatal(err, exitCode = 1) {
  const safe = safeErr(err);
  console.error(`✗ ${safe}`);
  if (err?.stack && process.env.DEBUG === 'true') console.error(err.stack);
  process.exit(exitCode);
}

/**
 * Read the recorded final status fenced-block from a yandex-migration report
 * doc (e.g. 09_SCHEMA_VERIFY_RESULT.md → SCHEMA_VERIFY_OK). Returns
 * { found, status }. status is null when file exists but has no marker.
 */
export function loadDocFinalStatus(fileName, statusRe) {
  const path = join(DOC_DIR, fileName);
  if (!existsSync(path)) return { found: false, status: null, path };
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return { found: false, status: null, path }; }
  const m = raw.match(statusRe);
  return { found: true, status: m ? m[0] : null, path };
}
