// Shared helpers for scripts/prod-to-yandex/*. ESM. No secrets ever logged.
//
// SAFETY: never console.log a raw connection string, password, cert, or token.
// Source for the Yandex stage is PROD Supabase ONLY — OLD_SUPABASE_DB_URL is
// never read or used by any prod-to-yandex script.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
