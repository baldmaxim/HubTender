#!/usr/bin/env node
// 00_check_yandex_target — read-only preflight for the Yandex Managed
// PostgreSQL target. Verifies connectivity, strict TLS (verify-full),
// PostgreSQL major version, required extensions, target emptiness, and
// LISTEN/NOTIFY availability. Writes docs/yandex-migration/06_YANDEX_PREFLIGHT.md.
//
// SAFETY:
//   - Read-only. Never CREATE/DROP/ALTER/INSERT. Only SELECT / SHOW / LISTEN / UNLISTEN.
//   - NEVER prints DSN, password, token, cert contents, or full host.
//   - Does NOT enable extensions, create tables/triggers, or import data.
//
// Usage: npm run yandex:preflight
// Env:   scripts/yandex-preflight/.env.yandex-preflight (see .example)

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DOC_DIR = join(REPO_ROOT, 'docs', 'yandex-migration');
const DOC_PATH = join(DOC_DIR, '06_YANDEX_PREFLIGHT.md');

const STATUS = {
  OK: 'YANDEX_PREFLIGHT_OK',
  WARN: 'YANDEX_PREFLIGHT_OK_WITH_WARNINGS',
  FAILED: 'YANDEX_PREFLIGHT_FAILED',
};

// ---------------------------------------------------------------------------
// env loading (scoped to the preflight file; .env/.env.local only as fallback;
// never overwrites already-set process.env values).
// ---------------------------------------------------------------------------
function loadEnv() {
  const candidates = [
    join(__dirname, '.env.yandex-preflight'),
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

const env = (k) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : '';
};

// ---------------------------------------------------------------------------
// redaction — never expose secrets in logs or the report.
// ---------------------------------------------------------------------------
function maskHost(url) {
  try {
    const h = new URL(url).hostname;
    const parts = h.split('.');
    return parts.length > 2 ? `***.${parts.slice(-2).join('.')}` : '***';
  } catch { return '***'; }
}
function hostType(url) {
  if (!url) return 'unset';
  if (/pool|pgbouncer|:6432/i.test(url)) return 'pooler';
  if (/:5432/.test(url)) return 'direct';
  return 'unknown';
}
function sslmodeOf(url) {
  try {
    const sp = new URL(url).searchParams.get('sslmode');
    return sp ? sp.toLowerCase() : '(unset)';
  } catch { return '(unparseable)'; }
}
function sslrootcertOf(url) {
  if (!url) return '';
  try {
    const v = new URL(url).searchParams.get('sslrootcert');
    return v ? v.trim() : '';
  } catch { return ''; }
}
function safeErr(e) {
  const msg = String(e?.message || e?.code || e);
  return msg.replace(/postgres(?:ql)?:\/\/\S+/gi, '<redacted-conn>');
}

// ---------------------------------------------------------------------------
// pg client with STRICT TLS (verify-full equivalent: ca + rejectUnauthorized).
// ---------------------------------------------------------------------------
async function connect(url, caPem, appName) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: url,
    ssl: { ca: caPem, rejectUnauthorized: true },
    statement_timeout: 15000,
    query_timeout: 15000,
    connectionTimeoutMillis: 12000,
    application_name: appName || 'yandex-preflight',
  });
  await client.connect();
  return client;
}

// ---------------------------------------------------------------------------
// report accumulators
// ---------------------------------------------------------------------------
const checks = [];   // { name, result, detail }
const blockers = []; // strings
const warnings = []; // strings
const operatorNeeds = []; // strings — data still required from operator
let directDsnMissing = false; // direct/session-safe DSN not provided
function check(name, result, detail) { checks.push({ name, result, detail: detail || '' }); }

// ---------------------------------------------------------------------------
function writeReport(status) {
  mkdirSync(DOC_DIR, { recursive: true });
  const now = new Date().toISOString();
  const lines = [];
  lines.push('# 06. YANDEX PREFLIGHT — Result');
  lines.push('');
  lines.push('> Сгенерировано `scripts/yandex-preflight/00_check_yandex_target.mjs`.');
  lines.push('> Read-only проверка target. Данные в Yandex не импортировались.');
  lines.push('');
  lines.push(`- Run (UTC): ${now}`);
  lines.push(`- Связано: [00_SOURCE_OF_TRUTH.md](./00_SOURCE_OF_TRUTH.md), [01_YANDEX_TARGET_INVENTORY.md](./01_YANDEX_TARGET_INVENTORY.md), [05_CUTOVER_RULES.md](./05_CUTOVER_RULES.md)`);
  lines.push('');
  lines.push('## Checks');
  lines.push('');
  lines.push('| Check | Result | Detail |');
  lines.push('|---|---|---|');
  for (const c of checks) {
    lines.push(`| ${c.name} | ${c.result} | ${String(c.detail).replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  lines.push('## Blockers');
  lines.push('');
  if (blockers.length === 0) lines.push('_нет_');
  else blockers.forEach((b) => lines.push(`- ❌ ${b}`));
  lines.push('');
  lines.push('## Warnings');
  lines.push('');
  if (warnings.length === 0) lines.push('_нет_');
  else warnings.forEach((w) => lines.push(`- ⚠️ ${w}`));
  lines.push('');
  if (directDsnMissing) {
    lines.push('## Runtime cutover note (direct/session-safe DSN)');
    lines.push('');
    lines.push('- Для **schema/data preflight** это НЕ блокер: подключение/SSL/версия/расширения/пустота target проверены.');
    lines.push('- Для **production realtime на Go BFF** нужен direct/session-safe DSN: `LISTEN/NOTIFY` (канал `rowchange`)');
    lines.push('  нестабилен через transaction-pooler.');
    lines.push('- Этот пункт ОСТАЁТСЯ blocker/warning для **финального runtime cutover** (см. [05_CUTOVER_RULES.md](./05_CUTOVER_RULES.md) §9),');
    lines.push('  пока `YANDEX_DIRECT_DATABASE_URL` не задан и LISTEN/NOTIFY на нём не подтверждён.');
    lines.push('');
  }
  lines.push('## Данные, которые ещё нужны от оператора');
  lines.push('');
  if (operatorNeeds.length === 0) lines.push('_всё необходимое предоставлено_');
  else operatorNeeds.forEach((o) => lines.push(`- ${o}`));
  lines.push('');
  lines.push('## Gate criteria (YANDEX_PREFLIGHT_OK требует все)');
  lines.push('');
  lines.push('- connection OK');
  lines.push('- PostgreSQL major == ожидаемой (по умолчанию 17)');
  lines.push('- SSL OK (verify-full: CA существует, rejectUnauthorized)');
  lines.push('- required extensions enabled: `pgcrypto`, `uuid-ossp`');
  lines.push('- target DB empty/ready (нет user-таблиц)');
  lines.push('- direct/session-safe connection доступен для LISTEN/NOTIFY');
  lines.push('');
  lines.push('## Final status');
  lines.push('');
  lines.push('```');
  lines.push(status);
  lines.push('```');
  lines.push('');
  writeFileSync(DOC_PATH, lines.join('\n'), 'utf8');
}

// ---------------------------------------------------------------------------
async function main() {
  loadEnv();

  const mainUrl = env('YANDEX_DATABASE_URL');
  const directUrl = env('YANDEX_DIRECT_DATABASE_URL');
  const poolerUrl = env('YANDEX_POOLER_DATABASE_URL');
  // CA path: explicit env var wins; otherwise fall back to the DSN's
  // sslrootcert= query param (main → direct → pooler).
  let caPath = env('YANDEX_SSL_ROOT_CERT');
  let caSource = 'YANDEX_SSL_ROOT_CERT';
  if (!caPath) {
    caPath = sslrootcertOf(env('YANDEX_DATABASE_URL'))
          || sslrootcertOf(env('YANDEX_DIRECT_DATABASE_URL'))
          || sslrootcertOf(env('YANDEX_POOLER_DATABASE_URL'));
    if (caPath) caSource = 'DSN sslrootcert';
  }
  const expectedMajor = env('YANDEX_EXPECTED_PG_MAJOR') || '17';
  const expectedDb = env('YANDEX_EXPECTED_DATABASE');
  const expectedMigrator = env('YANDEX_EXPECTED_MIGRATOR_USER');
  const expectedRuntime = env('YANDEX_EXPECTED_RUNTIME_USER');

  // --- config gate: friendly message, NO stack trace, do not write a misleading report ---
  if (!mainUrl) {
    console.error('✗ YANDEX_DATABASE_URL не задан — preflight не выполнялся.');
    console.error('  1) cp scripts/yandex-preflight/.env.yandex-preflight.example \\');
    console.error('       scripts/yandex-preflight/.env.yandex-preflight');
    console.error('  2) заполните значениями от оператора Yandex-кластера');
    console.error('  3) npm run yandex:preflight');
    console.error('  Реальный .env.yandex-preflight git-ignored — не коммитить.');
    process.exit(2);
  }

  console.log('▶ Yandex target preflight (read-only). Secrets never printed.');
  console.log(`  target   : host=${maskHost(mainUrl)} type=${hostType(mainUrl)} sslmode=${sslmodeOf(mainUrl)}`);
  if (directUrl) console.log(`  direct   : host=${maskHost(directUrl)} type=${hostType(directUrl)}`);
  if (poolerUrl) console.log(`  pooler   : host=${maskHost(poolerUrl)} type=${hostType(poolerUrl)}`);

  // --- SSL precheck (verify-full requires a CA file) ---
  let caPem = null;
  if (!caPath) {
    blockers.push('CA не задан: ни YANDEX_SSL_ROOT_CERT, ни sslrootcert= в DSN — verify-full невозможен; подключение не выполняется.');
    operatorNeeds.push('Путь к Yandex root CA (.pem): задать YANDEX_SSL_ROOT_CERT или sslrootcert= в DSN.');
    check('SSL verify-full', 'FAIL', 'CA unset (env + DSN)');
  } else if (!existsSync(caPath)) {
    blockers.push(`Файл CA не найден на диске (источник: ${caSource}) — verify-full невозможен.`);
    check('SSL verify-full', 'FAIL', `CA file not found (${caSource})`);
  } else {
    try {
      caPem = readFileSync(caPath, 'utf8');
      check('SSL verify-full', 'OK', `CA loaded from ${caSource}; rejectUnauthorized=true; dsn sslmode=${sslmodeOf(mainUrl)}`);
      if (sslmodeOf(mainUrl) !== 'verify-full') {
        warnings.push(`DSN sslmode=${sslmodeOf(mainUrl)} (рекомендуется verify-full в строке подключения; TLS всё равно строгий через CA).`);
      }
    } catch (e) {
      blockers.push(`Не удалось прочитать YANDEX_SSL_ROOT_CERT: ${safeErr(e)}`);
      check('SSL verify-full', 'FAIL', 'CA read error');
    }
  }

  // Without a CA we refuse to connect (no insecure downgrade).
  if (!caPem) {
    const status = STATUS.FAILED;
    writeReport(status);
    console.error(`\n✗ ${status} — см. ${DOC_PATH}`);
    printSummary();
    process.exit(1);
  }

  // --- main connection + read-only inspection ---
  let client;
  try {
    client = await connect(mainUrl, caPem, 'yandex-preflight-main');
    check('Connection', 'OK', `host=${maskHost(mainUrl)}`);
  } catch (e) {
    blockers.push(`Подключение к YANDEX_DATABASE_URL не удалось: ${safeErr(e)}`);
    check('Connection', 'FAIL', safeErr(e));
    const status = STATUS.FAILED;
    writeReport(status);
    console.error(`\n✗ ${status} — см. ${DOC_PATH}`);
    printSummary();
    process.exit(1);
  }

  try {
    const q = async (sql) => (await client.query(sql)).rows;

    const [{ version }] = await q('SELECT version() AS version');
    const major = (String(version).match(/PostgreSQL\s+(\d+)/) || [])[1] || '?';
    const [{ server_version }] = await q('SHOW server_version');
    const [{ TimeZone }] = await q('SHOW TimeZone');
    const [{ current_database }] = await q('SELECT current_database() AS current_database');
    const [{ current_user }] = await q('SELECT current_user AS current_user');
    const extRows = await q("SELECT extname FROM pg_extension ORDER BY extname");
    const exts = extRows.map((r) => r.extname);

    check('PostgreSQL version', major === String(expectedMajor) ? 'OK' : 'FAIL',
      `major=${major} (expected ${expectedMajor}); server_version=${server_version}`);
    if (major !== String(expectedMajor)) {
      blockers.push(`PostgreSQL major=${major}, ожидалось ${expectedMajor} (совместимость с PROD Supabase).`);
    }
    check('TimeZone', 'INFO', String(TimeZone));
    check('current_database()', expectedDb ? (current_database === expectedDb ? 'OK' : 'WARN') : 'INFO',
      expectedDb ? `${current_database} (expected ${expectedDb})` : String(current_database));
    if (expectedDb && current_database !== expectedDb) {
      warnings.push(`current_database=${current_database}, ожидалось ${expectedDb}.`);
    }
    check('current_user', expectedMigrator ? (current_user === expectedMigrator ? 'OK' : 'WARN') : 'INFO',
      expectedMigrator ? `${current_user} (expected migrator ${expectedMigrator})` : String(current_user));
    if (expectedMigrator && current_user !== expectedMigrator) {
      warnings.push(`current_user=${current_user}, ожидался migrator=${expectedMigrator}.`);
    }
    if (expectedRuntime) {
      check('runtime user (expected)', 'INFO', expectedRuntime);
    }

    // required extensions
    for (const ext of ['pgcrypto', 'uuid-ossp']) {
      const present = exts.includes(ext);
      check(`extension ${ext}`, present ? 'OK' : 'FAIL', present ? 'enabled' : 'NOT enabled');
      if (!present) {
        blockers.push(`Расширение "${ext}" не включено. Включить через настройки Yandex-кластера (НЕ CREATE EXTENSION в SQL).`);
        operatorNeeds.push(`Включить расширение "${ext}" в Yandex Managed PostgreSQL (console/CLI/API).`);
      }
    }
    check('extensions (all)', 'INFO', exts.join(', ') || '(none)');

    // emptiness / readiness
    const [{ public_tables }] = await q(
      "SELECT count(*)::int AS public_tables FROM information_schema.tables " +
      "WHERE table_schema='public' AND table_type='BASE TABLE'");
    const userTblRows = await q(
      "SELECT schemaname, count(*)::int AS n FROM pg_tables " +
      "WHERE schemaname NOT IN ('pg_catalog','information_schema') " +
      "GROUP BY schemaname ORDER BY schemaname");
    const nonSysSchemaRows = await q(
      "SELECT nspname FROM pg_namespace " +
      "WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast') " +
      "AND nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%' " +
      "ORDER BY nspname");
    const userTableTotal = userTblRows.reduce((a, r) => a + r.n, 0);
    const nonSysSchemas = nonSysSchemaRows.map((r) => r.nspname);

    check('public BASE TABLE count', userTableTotal === 0 ? 'OK' : 'WARN', String(public_tables));
    check('user tables (non-system)', userTableTotal === 0 ? 'OK' : 'WARN',
      userTableTotal === 0 ? '0 (empty/ready)' :
      userTblRows.map((r) => `${r.schemaname}=${r.n}`).join(', '));
    check('non-system schemas', 'INFO', nonSysSchemas.join(', ') || '(none)');
    if (userTableTotal > 0) {
      warnings.push(`Target НЕ пустой: ${userTableTotal} user-таблиц(ы). Ничего не удалялось. Для YANDEX_PREFLIGHT_OK нужна пустая БД.`);
    }
  } catch (e) {
    blockers.push(`Read-only инспекция не удалась: ${safeErr(e)}`);
    check('Inspection', 'FAIL', safeErr(e));
  } finally {
    await client.end().catch(() => {});
  }

  // --- LISTEN/NOTIFY availability (no tables/triggers created) ---
  const listenUrl = directUrl || mainUrl;
  if (!directUrl) {
    directDsnMissing = true;
    warnings.push('YANDEX_DIRECT_DATABASE_URL не задан — LISTEN проверен на YANDEX_DATABASE_URL (может быть transaction-pooler).');
    operatorNeeds.push('Отдельный direct/session-safe DSN для LISTEN/NOTIFY (если основной endpoint — pooler).');
  }
  let lc;
  try {
    lc = await connect(listenUrl, caPem, 'yandex-preflight-listen');
    await lc.query('LISTEN rowchange');
    await lc.query('UNLISTEN rowchange');
    check('LISTEN/UNLISTEN rowchange', 'OK',
      `via ${directUrl ? 'YANDEX_DIRECT_DATABASE_URL' : 'YANDEX_DATABASE_URL'} (host=${maskHost(listenUrl)}, type=${hostType(listenUrl)})`);
  } catch (e) {
    blockers.push(`LISTEN/NOTIFY недоступен на ${directUrl ? 'direct' : 'main'} соединении: ${safeErr(e)}. Go BFF realtime требует session-safe соединение.`);
    check('LISTEN/UNLISTEN rowchange', 'FAIL', safeErr(e));
  } finally {
    if (lc) await lc.end().catch(() => {});
  }

  // --- pooler endpoint (connectivity only; never use for LISTEN/NOTIFY) ---
  if (poolerUrl) {
    let pc;
    try {
      pc = await connect(poolerUrl, caPem, 'yandex-preflight-pooler');
      await pc.query('SELECT 1');
      check('Pooler connectivity', 'OK',
        `host=${maskHost(poolerUrl)}, type=${hostType(poolerUrl)} — transaction-pooler НЕ использовать для LISTEN/NOTIFY`);
    } catch (e) {
      warnings.push(`Pooler endpoint недоступен: ${safeErr(e)} (не блокер preflight).`);
      check('Pooler connectivity', 'WARN', safeErr(e));
    } finally {
      if (pc) await pc.end().catch(() => {});
    }
  } else {
    check('Pooler connectivity', 'INFO', 'YANDEX_POOLER_DATABASE_URL не задан — пропущено');
  }

  // --- final status ---
  let status;
  if (blockers.length > 0) status = STATUS.FAILED;
  else if (warnings.length > 0) status = STATUS.WARN;
  else status = STATUS.OK;

  writeReport(status);
  printSummary();
  const symbol = status === STATUS.OK ? '✓' : status === STATUS.WARN ? '⚠' : '✗';
  console.log(`\n${symbol} ${status} — отчёт: ${DOC_PATH}`);
  process.exit(status === STATUS.FAILED ? 1 : 0);
}

function printSummary() {
  if (blockers.length) {
    console.error(`\nBlockers (${blockers.length}):`);
    blockers.forEach((b) => console.error(`  ✗ ${b}`));
  }
  if (warnings.length) {
    console.error(`\nWarnings (${warnings.length}):`);
    warnings.forEach((w) => console.error(`  ⚠ ${w}`));
  }
  if (operatorNeeds.length) {
    console.error(`\nНужно от оператора (${operatorNeeds.length}):`);
    operatorNeeds.forEach((o) => console.error(`  - ${o}`));
  }
}

main().catch((e) => {
  // Friendly top-level handler — strip any connection-string-looking text,
  // no raw stack unless DEBUG=true.
  console.error(`✗ unexpected preflight error: ${safeErr(e)}`);
  if (process.env.DEBUG === 'true' && e?.stack) console.error(e.stack);
  process.exit(1);
});
