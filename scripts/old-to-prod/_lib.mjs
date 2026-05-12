// Shared helpers for scripts/old-to-prod/*. No secrets logged. ESM module.
//
// IMPORTANT: never console.log() a raw connection string, service-role key,
// password, encrypted_password, or plaintext password. All logs in callers must
// route user-controlled values through redactUrl() / redactEmail() / etc.

import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Read .env.old-to-prod (and .env / .env.local as fallback for shared keys)
 * into process.env without overwriting already-set values. Matches the inline
 * pattern used by scripts/cutover/verify_rowcounts.mjs.
 */
export function loadDotenv() {
  const candidates = [
    join(__dirname, '.env.old-to-prod'),
    join(process.cwd(), 'scripts', 'old-to-prod', '.env.old-to-prod'),
    join(process.cwd(), '.env.old-to-prod'),
    join(process.cwd(), '.env'),
    join(process.cwd(), '.env.local'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    let raw;
    try { raw = readFileSync(path, 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}

/** Throws with a friendly message if a required env var is missing or empty. */
export function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `Missing required env var ${name}. Copy scripts/old-to-prod/.env.old-to-prod.example ` +
      `to scripts/old-to-prod/.env.old-to-prod and fill it in.`
    );
  }
  return v;
}

/** EXPORT_DIR with default + auto-create. */
export function getExportDir() {
  const dir = process.env.EXPORT_DIR || './.old-to-prod-export';
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Connection-string redaction for logging.
 * Hides password and most of host/db: `postgresql://user:***@<redacted>/<redacted>`.
 * Returns 'invalid-url' on parse failure (no fallback to raw input).
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
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local[0]}***@${domain}`;
}

/**
 * Build a pg.Client for a Supabase connection string.
 * Supabase requires TLS; we accept the cert chain without strict verification
 * (Supabase rotates intermediates and Yandex root CAs differ). Migration is a
 * one-shot operation, so we trade strict pinning for portability.
 */
export async function getClient(url) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60_000,
    query_timeout: 60_000,
  });
  await client.connect();
  return client;
}

/** Write JSON with stable formatting and trailing newline. */
export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/** Pretty single-line label, e.g. "[OLD ] PostgreSQL 15.x — public.users=ok". */
export function tag(label) {
  const padded = label.padEnd(4, ' ');
  return `[${padded}]`;
}

/**
 * Wrap node:util.parseArgs with a friendly --help that lists the spec.
 * Returns { values, positionals }. On --help, prints and exits(0).
 *
 * Boolean flags default to false unless explicitly stated. String flags need
 * a default in the spec.
 *
 * Example:
 *   const { values } = parseCliArgs({
 *     name: '04_export_old.mjs',
 *     description: 'Export OLD Supabase to EXPORT_DIR/data/*.ndjson',
 *     options: {
 *       'dry-run':    { type: 'boolean', default: false, describe: 'Do not write any files' },
 *       'export-dir': { type: 'string',  default: '',    describe: 'Override EXPORT_DIR' },
 *       'batch-size': { type: 'string',  default: '1000', describe: 'Streaming page size' },
 *     },
 *   });
 */
export function parseCliArgs({ name, description, options }) {
  // node:util.parseArgs is available in Node 18.3+; CLAUDE.md doesn't pin a
  // Node version but the existing scripts already assume 18+ (native fetch).
  const optionsForParse = {};
  for (const [key, cfg] of Object.entries(options)) {
    optionsForParse[key] = { type: cfg.type };
    if (cfg.short) optionsForParse[key].short = cfg.short;
    if (cfg.multiple) optionsForParse[key].multiple = cfg.multiple;
  }
  optionsForParse.help = { type: 'boolean', short: 'h' };

  let parsed;
  try {
    parsed = parseArgs({
      options: optionsForParse,
      allowPositionals: true,
      strict: true,
    });
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    console.error(`    Try --help.`);
    process.exit(2);
  }

  if (parsed.values.help) {
    printHelp({ name, description, options });
    process.exit(0);
  }

  // Apply defaults.
  for (const [key, cfg] of Object.entries(options)) {
    if (parsed.values[key] === undefined && cfg.default !== undefined) {
      parsed.values[key] = cfg.default;
    }
  }

  return parsed;
}

function printHelp({ name, description, options }) {
  console.log(`${name}`);
  if (description) console.log(`  ${description}`);
  console.log('');
  console.log('Options:');
  const maxKey = Math.max(...Object.keys(options).map((k) => k.length), 8);
  for (const [key, cfg] of Object.entries(options)) {
    const flag = `--${key}`.padEnd(maxKey + 4);
    const dflt = cfg.default !== undefined ? ` [default: ${JSON.stringify(cfg.default)}]` : '';
    console.log(`  ${flag} ${cfg.describe ?? ''}${dflt}`);
  }
  console.log(`  --help        show this and exit`);
}

/**
 * Exit(2) with a friendly message if any of the named files are missing in
 * EXPORT_DIR. Use as a precondition in 05/06/07/08.
 *
 * @param {string} exportDir
 * @param {string[]} names - filenames relative to exportDir
 * @param {string} hint - human-readable next-step suggestion
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
 * Exit(3) if schema_diff.json has any unresolved blockers. Whitelist allows
 * specific stable codes (e.g. "tables_only_in_prod" — we know about new
 * Go-Auth tables in PROD and they don't block import).
 *
 * @param {object} schemaDiff - parsed schema_diff.json
 * @param {Set<string>|string[]} whitelist - codes to ignore
 */
export function ensureNoBlockers(schemaDiff, whitelist = []) {
  const allow = new Set(whitelist);
  const blockers = (schemaDiff?.blockers ?? []).filter((b) => !allow.has(b.code));
  if (blockers.length === 0) return;
  console.error(`✗ schema_diff.json has ${blockers.length} unresolved blocker(s):`);
  for (const b of blockers.slice(0, 5)) {
    console.error(`    [${b.code}] ${b.title}`);
    for (const d of (b.detail ?? []).slice(0, 3)) {
      console.error(`        - ${d}`);
    }
  }
  if (blockers.length > 5) {
    console.error(`    ... and ${blockers.length - 5} more (see schema_diff.md)`);
  }
  console.error(`  Resolve blockers in PROD (e.g. ALTER TYPE ... ADD VALUE, ALTER TABLE ... ADD COLUMN)`);
  console.error(`  and re-run: npm run old-to-prod:compare`);
  process.exit(3);
}

/**
 * Two-key safety gate. If `cliFlag` is set, require `process.env[envVar] === 'true'`.
 * If env-only is set without cliFlag, that's a no-op (the env flag only PERMITS,
 * it does not ACTIVATE).
 *
 * Throws (sync) with a clear message on policy violation.
 *
 * @param {{cliFlag: boolean, envVar: string, label: string}} opts
 */
export function twoKeyGuard({ cliFlag, envVar, label }) {
  if (!cliFlag) return;
  if (process.env[envVar] !== 'true') {
    throw new Error(
      `${label}: --${label.toLowerCase().replace(/\s+/g, '-')} requires ${envVar}=true in .env.old-to-prod. ` +
      `Refusing to proceed for safety.`
    );
  }
}

/**
 * Friendly handler for unexpected exceptions in top-level scripts. Strips
 * connection-string-looking substrings from messages before printing.
 */
export function fatal(err, exitCode = 1) {
  const msg = String(err?.message || err);
  // Strip "postgres://user:pass@host" patterns.
  const safe = msg.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '<redacted-conn>');
  console.error(`✗ ${safe}`);
  if (err?.stack && process.env.DEBUG === 'true') {
    console.error(err.stack);
  }
  process.exit(exitCode);
}
