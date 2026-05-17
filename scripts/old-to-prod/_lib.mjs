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

// pg.types.setTypeParser is a PROCESS-WIDE singleton (shared by every Client
// instance). node-postgres' DEFAULT parsers convert date/timestamp/timestamptz
// into a JS Date — which has only millisecond resolution AND is anchored to the
// Node process timezone. On export that silently (a) truncated microseconds
// (`.309186`→`.309`) and (b) shifted every `date` value by ±1 day, corrupting
// projects.contract_date / construction_end_date and client_positions temporals.
// Root cause of VERIFY_FAILED — see docs/old-to-prod/VERIFY_ROOT_CAUSE.md.
//
// Fix: parse these OIDs as RAW PostgreSQL text (identity function). The wire
// text is exact; on re-insert pg passes the string back and PG parses it
// losslessly. Combined with a deterministic UTC + ISO session (see getClient)
// the server-side md5(string_agg(t::text)) checksum is byte-stable OLD↔PROD.
let _temporalParsersInstalled = false;
export async function installPgRawTemporalParsers() {
  if (_temporalParsersInstalled) return;
  const { default: pg } = await import('pg');
  const ident = (v) => v; // raw text — never coerce to JS Date
  const b = pg.types?.builtins ?? {};
  const DATE = b.DATE ?? 1082;
  const TIMESTAMP = b.TIMESTAMP ?? 1114;
  const TIMESTAMPTZ = b.TIMESTAMPTZ ?? 1184;
  pg.types.setTypeParser(DATE, ident);
  pg.types.setTypeParser(TIMESTAMP, ident);
  pg.types.setTypeParser(TIMESTAMPTZ, ident);
  _temporalParsersInstalled = true;
}

/**
 * Fail-fast guard: confirm the raw temporal parsers + deterministic session are
 * actually in effect on `client` before any export/verify reads real data.
 * Returns { date, timestamp, timestamptz } sample strings for manifests/logs.
 * Throws (caller should let it abort the run) if pg still yields JS Date or
 * lossy values.
 */
export async function assertTemporalRawParsers(client) {
  const { rows: [r] } = await client.query(
    `SELECT '2026-05-17'::date AS d,
            '2026-05-17 12:34:56.123456'::timestamp AS ts,
            '2026-05-17 12:34:56.123456+00'::timestamptz AS tstz`,
  );
  const ok =
    typeof r.d === 'string' && r.d === '2026-05-17' &&
    typeof r.ts === 'string' && r.ts.includes('.123456') &&
    typeof r.tstz === 'string' && r.tstz.includes('.123456');
  if (!ok) {
    throw new Error(
      'Temporal raw-parser self-check FAILED — pg returned non-string/lossy ' +
      `temporal values (d=${typeof r.d}:${r.d} ts=${typeof r.ts}:${r.ts} ` +
      `tstz=${typeof r.tstz}:${r.tstz}). installPgRawTemporalParsers()/UTC ` +
      'session did not take effect. Refusing to export/verify to avoid data corruption.',
    );
  }
  return { date: r.d, timestamp: r.ts, timestamptz: r.tstz };
}

/**
 * Build a pg.Client for a Supabase connection string.
 * Supabase requires TLS; we accept the cert chain without strict verification
 * (Supabase rotates intermediates and Yandex root CAs differ). Migration is a
 * one-shot operation, so we trade strict pinning for portability.
 *
 * Every client is pinned to RAW temporal parsers + a deterministic
 * `UTC` / `ISO, MDY` session so timestamptz `::text` (and thus the migration
 * checksum) renders identically on OLD and PROD. If the session SET fails the
 * connection is torn down and the error propagates (fail-fast — requirement:
 * never export/import/verify on a non-deterministic session).
 */
export async function getClient(url, opts = {}) {
  const { default: pg } = await import('pg');
  await installPgRawTemporalParsers();
  // 60s default is too tight for streaming exports through the Supabase Session
  // Pooler (large jsonb tables can take >60s per 5000-row SELECT). Migration is
  // a one-shot operation; trade strict timeout for completion. Env override:
  //   PG_QUERY_TIMEOUT_MS — milliseconds; default 300_000 (5 minutes).
  // Per-call override: opts.timeoutMs (preferred for short-lived export clients).
  const defaultTimeoutMs = parseInt(process.env.PG_QUERY_TIMEOUT_MS || '300000', 10);
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : defaultTimeoutMs;
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    statement_timeout: timeoutMs,
    query_timeout: timeoutMs,
    application_name: opts.applicationName || 'old-to-prod',
  });
  await client.connect();
  try {
    await client.query("SET TIME ZONE 'UTC'");
    await client.query("SET DateStyle = 'ISO, MDY'");
  } catch (e) {
    await client.end().catch(() => {});
    throw new Error(
      `Failed to pin deterministic session (SET TIME ZONE 'UTC' / DateStyle 'ISO, MDY'): ` +
      `${e.message}. Refusing to proceed — checksum determinism cannot be guaranteed.`,
    );
  }
  return client;
}

/**
 * Classify a connection URL as direct / pooler / unknown WITHOUT exposing the
 * URL itself. Supabase URLs:
 *   - `aws-0-<region>.pooler.supabase.com:5432` → 'pooler' (Supavisor/PgBouncer)
 *   - `db.<ref>.supabase.co:5432`               → 'direct' (IPv6 only on free)
 *   - anything else                              → 'unknown'
 * Use only for log messages — NEVER pass the original URL into logs.
 */
export function redactHostType(url) {
  if (!url || typeof url !== 'string') return 'unknown';
  if (/pooler\.supabase\.com/i.test(url)) return 'pooler';
  if (/\.supabase\.co/i.test(url)) return 'direct';
  return 'unknown';
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
 * Load schema_diff.json and report whether it was produced by the MCP live
 * preflight (source === 'mcp', with blockers/risks/info arrays).
 *
 * Returns { data, sourceIsMcp, status }. Exits(2) on missing/corrupt file.
 */
export function loadSchemaDiff(exportDir) {
  const path = join(exportDir, 'schema_diff.json');
  if (!existsSync(path)) {
    console.error(`✗ schema_diff.json not found in ${exportDir}.`);
    console.error(`  Either run :introspect/:compare, or generate the MCP preflight (docs/old-to-prod/MCP_PREFLIGHT.md).`);
    process.exit(2);
  }
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`✗ ${path} is not valid JSON: ${e.message}`);
    process.exit(2);
  }
  const sourceIsMcp = data?.source === 'mcp'
    && Array.isArray(data?.blockers)
    && Array.isArray(data?.risks)
    && Array.isArray(data?.info);
  const status = typeof data?.status === 'string' ? data.status : null;
  return { data, sourceIsMcp, status };
}

/**
 * Read docs/old-to-prod/MCP_PREFLIGHT.md and extract the recorded final status
 * line (one of MCP_PREFLIGHT_OK / MCP_PREFLIGHT_OK_WITH_WARNINGS / MCP_PREFLIGHT_FAILED).
 * Returns { found, status }; status is null if the file exists but no marker
 * is present.
 */
export function loadMcpPreflightStatus() {
  const path = join('docs', 'old-to-prod', 'MCP_PREFLIGHT.md');
  if (!existsSync(path)) return { found: false, status: null, path };
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return { found: false, status: null, path }; }
  const m = raw.match(/MCP_PREFLIGHT_(OK_WITH_WARNINGS|OK|FAILED)/);
  return { found: true, status: m ? `MCP_PREFLIGHT_${m[1]}` : null, path };
}

/**
 * Validate that the current run is allowed to consume an MCP-sourced
 * schema_diff.json. Exits with a friendly message on policy violation.
 *
 * Rules:
 *  - schema_diff.json must be source === 'mcp'.
 *  - schema_diff.blockers must be empty.
 *  - docs/old-to-prod/MCP_PREFLIGHT.md must NOT report MCP_PREFLIGHT_FAILED.
 *  - For real (non-dry-run) import: requires ALLOW_AUTH_IMPORT=true and
 *    ALLOW_DISABLE_IMPORT_TRIGGERS=true.
 *  - Emits a non-fatal warning when status is MCP_PREFLIGHT_OK_WITH_WARNINGS.
 *
 * Returns { status } on success.
 *
 * @param {{exportDir: string, dryRun: boolean, enforceImportGates: boolean}} opts
 */
export function assertMcpPreflightOk({ exportDir, dryRun, enforceImportGates }) {
  const diff = loadSchemaDiff(exportDir);
  if (!diff.sourceIsMcp) {
    console.error(`✗ --use-mcp-preflight requires schema_diff.json with "source":"mcp" (current source: ${diff.data?.source ?? 'unknown'}).`);
    console.error(`  Generate the MCP preflight first, or drop --use-mcp-preflight to fall back to file-based compare.`);
    process.exit(2);
  }
  const blockers = diff.data.blockers ?? [];
  if (blockers.length > 0) {
    console.error(`✗ MCP schema_diff.json has ${blockers.length} blocker(s); cannot proceed.`);
    for (const b of blockers.slice(0, 5)) console.error(`    [${b.code}] ${b.msg ?? b.title ?? ''}`);
    if (blockers.length > 5) console.error(`    ... and ${blockers.length - 5} more (see .old-to-prod-export/schema_diff.md)`);
    process.exit(3);
  }

  const mcp = loadMcpPreflightStatus();
  if (!mcp.found) {
    console.error(`✗ --use-mcp-preflight requires docs/old-to-prod/MCP_PREFLIGHT.md but the file is missing.`);
    console.error(`  Run the MCP live preflight first to generate it.`);
    process.exit(2);
  }
  if (mcp.status === 'MCP_PREFLIGHT_FAILED') {
    console.error(`✗ ${mcp.path} reports MCP_PREFLIGHT_FAILED. Refusing to proceed.`);
    console.error(`  Resolve blockers and re-run the MCP preflight before retrying.`);
    process.exit(3);
  }
  if (!mcp.status) {
    console.error(`✗ ${mcp.path} exists but contains no MCP_PREFLIGHT_* status marker.`);
    console.error(`  Re-generate it so it ends with the canonical status line.`);
    process.exit(3);
  }

  if (enforceImportGates && !dryRun) {
    const missing = [];
    if (process.env.ALLOW_AUTH_IMPORT !== 'true') missing.push('ALLOW_AUTH_IMPORT=true');
    if (process.env.ALLOW_DISABLE_IMPORT_TRIGGERS !== 'true') missing.push('ALLOW_DISABLE_IMPORT_TRIGGERS=true');
    if (missing.length > 0) {
      console.error(`✗ Real import via --use-mcp-preflight requires these env flags in scripts/old-to-prod/.env.old-to-prod:`);
      for (const m of missing) console.error(`    - ${m}`);
      console.error(`  Add them and re-run, or pass --dry-run for a planning-only execution.`);
      process.exit(7);
    }
  }

  if (mcp.status === 'MCP_PREFLIGHT_OK_WITH_WARNINGS' && !dryRun && enforceImportGates) {
    const risks = (diff.data.risks ?? []).length;
    console.error(`⚠ MCP preflight: MCP_PREFLIGHT_OK_WITH_WARNINGS (${risks} risk(s)).`);
    console.error(`⚠ Proceeding with REAL import — review .old-to-prod-export/schema_diff.md before non-reversible writes.`);
  }
  return { status: mcp.status, schemaDiff: diff.data };
}

/**
 * Load .old-to-prod-export/auth_collision_analysis.json if present.
 *
 * Returns { found, data, recommendation } — recommendation is the canonical
 * tag from MCP analysis: 'adopt-identical-existing' / 'clean-prod' / 'clean-auth' / 'manual-resolve'.
 * Never exits on missing file (callers decide; assertCleanAuthAllowed does).
 */
export function loadAuthCollisionAnalysis(exportDir) {
  const path = join(exportDir, 'auth_collision_analysis.json');
  if (!existsSync(path)) return { found: false, data: null, recommendation: null, path };
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`✗ ${path} is not valid JSON: ${e.message}`);
    process.exit(2);
  }
  return {
    found: true,
    data,
    recommendation: typeof data?.recommendation === 'string' ? data.recommendation : null,
    path,
  };
}

/**
 * Three-key safety gate for --clean-auth. Exits with friendly errors otherwise.
 *
 * Required for the gate to pass:
 *  - CLI flag `--clean-auth` (caller supplies `opts.cliFlag`)
 *  - env ALLOW_CLEAN_AUTH=true
 *  - env ALLOW_AUTH_IMPORT=true
 *  - schema_diff.json: source=mcp, blockers empty, MCP_PREFLIGHT not FAILED
 *  - auth_collision_analysis.json present
 *  - auth_collision_analysis.recommendation ∈ {clean-prod, clean-auth}
 *
 * Additionally returns `publicReferrersPresent` (boolean) — the caller (05/06)
 * receives this and decides whether to enforce `--clean-prod --confirm` based
 * on the FK graph (which they query at runtime).
 *
 * @param {{exportDir: string, cliFlag: boolean, dryRun: boolean}} opts
 * @returns {{collision: object, status: string}}
 */
export function assertCleanAuthAllowed({ exportDir, cliFlag, dryRun }) {
  if (!cliFlag) {
    // Not requested — nothing to check. Caller should not reach this with cliFlag=false.
    throw new Error('assertCleanAuthAllowed called without cliFlag=true; this is a programmer error.');
  }

  // Three-key guard: CLI flag + env ALLOW_CLEAN_AUTH + env ALLOW_AUTH_IMPORT.
  const envCleanAuth = process.env.ALLOW_CLEAN_AUTH === 'true';
  const envAuthImport = process.env.ALLOW_AUTH_IMPORT === 'true';
  if (!envCleanAuth || !envAuthImport) {
    const missing = [];
    if (!envCleanAuth) missing.push('ALLOW_CLEAN_AUTH=true');
    if (!envAuthImport) missing.push('ALLOW_AUTH_IMPORT=true');
    console.error(`✗ --clean-auth refused. Missing env flag(s) in scripts/old-to-prod/.env.old-to-prod:`);
    for (const m of missing) console.error(`    - ${m}`);
    console.error(`  --clean-auth is destructive. It needs CLI flag AND both env flags simultaneously.`);
    process.exit(7);
  }

  // MCP preflight must be OK (or OK_WITH_WARNINGS). FAILED → refuse.
  // We piggy-back on the same helper that 05/06/migrate use; enforceImportGates
  // is FALSE here because the caller is expected to call assertMcpPreflightOk
  // separately with the right enforceImportGates setting for their context.
  const diff = loadSchemaDiff(exportDir);
  if (!diff.sourceIsMcp) {
    console.error(`✗ --clean-auth requires schema_diff.json with source=mcp (current: ${diff.data?.source ?? 'unknown'}).`);
    console.error(`  Generate the MCP live preflight first.`);
    process.exit(2);
  }
  const blockers = diff.data.blockers ?? [];
  if (blockers.length > 0) {
    console.error(`✗ --clean-auth refused: schema_diff.json has ${blockers.length} blocker(s).`);
    for (const b of blockers.slice(0, 5)) console.error(`    [${b.code}] ${b.msg ?? b.title ?? ''}`);
    process.exit(3);
  }
  const mcp = loadMcpPreflightStatus();
  if (!mcp.found) {
    console.error(`✗ --clean-auth requires docs/old-to-prod/MCP_PREFLIGHT.md but the file is missing.`);
    process.exit(2);
  }
  if (mcp.status === 'MCP_PREFLIGHT_FAILED') {
    console.error(`✗ --clean-auth refused: ${mcp.path} reports MCP_PREFLIGHT_FAILED.`);
    process.exit(3);
  }

  // auth_collision_analysis.json is mandatory for --clean-auth.
  const collision = loadAuthCollisionAnalysis(exportDir);
  if (!collision.found) {
    console.error(`✗ --clean-auth requires .old-to-prod-export/auth_collision_analysis.json but it's missing.`);
    console.error(`  Generate it via the MCP cross-DB collision analysis before running clean-auth.`);
    process.exit(2);
  }
  const allowedRecs = new Set(['clean-prod', 'clean-auth']);
  if (!allowedRecs.has(collision.recommendation)) {
    console.error(`✗ --clean-auth refused. auth_collision_analysis.recommendation=${collision.recommendation ?? 'null'}; expected one of: ${[...allowedRecs].join(', ')}.`);
    console.error(`  If the recommendation is 'adopt-identical-existing', use --resume instead.`);
    console.error(`  If 'manual-resolve', clean-auth is unsafe — resolve the listed collisions first.`);
    process.exit(3);
  }

  // Sanity: PROD must not have auth users absent on OLD (would be data loss
  // via DELETE FROM auth.users). Analysis tracks this.
  const prodOnly = collision.data?.prod_only_users ?? 0;
  if (prodOnly > 0) {
    console.error(`✗ --clean-auth refused: ${prodOnly} auth.user(s) exist on PROD but NOT on OLD. Clean-auth would lose them irreversibly.`);
    console.error(`  Resolve via manual investigation, then re-run the MCP collision analysis.`);
    process.exit(3);
  }

  // Sanity: identity provider/provider_id collisions that point to different
  // user_ids are not resolvable by clean-auth alone (after re-import they'd
  // still collide on the FK to the imported users).
  const identityCollisions = collision.data?.identity_provider_collisions ?? 0;
  if (identityCollisions > 0) {
    console.error(`✗ --clean-auth refused: ${identityCollisions} auth.identities (provider, provider_id) collision(s) point to different user_ids on OLD vs PROD.`);
    console.error(`  Clean-auth re-imports OLD identities; collisions would reappear. Resolve manually.`);
    process.exit(3);
  }

  if (mcp.status === 'MCP_PREFLIGHT_OK_WITH_WARNINGS' && !dryRun) {
    console.error(`⚠ MCP preflight: MCP_PREFLIGHT_OK_WITH_WARNINGS — proceeding with --clean-auth in REAL mode. Review schema_diff.md.`);
  }

  return { collision: collision.data, status: mcp.status };
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
