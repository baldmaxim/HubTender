// Read-only refresh audit (2026-05-25).
// Compares row counts and key PK sets across OLD Supabase, PROD Supabase, and
// Yandex Managed PostgreSQL. Writes a markdown report to docs/yandex-migration/.
// No DDL, no inserts/updates/deletes — pure SELECT. Secrets never printed.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DOC_PATH = join(REPO_ROOT, 'docs', 'yandex-migration', 'AUDIT_2026_05_25.md');

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}

loadEnvFile(join(__dirname, 'old-to-prod', '.env.old-to-prod'));
loadEnvFile(join(__dirname, 'prod-to-yandex', '.env.prod-to-yandex'));

function maskHost(url) {
  try {
    const h = new URL(url).hostname;
    const p = h.split('.');
    return p.length > 2 ? `***.${p.slice(-2).join('.')}` : '***';
  } catch { return '***'; }
}

function sslrootcertOf(url) {
  if (!url) return '';
  try {
    const v = new URL(url).searchParams.get('sslrootcert');
    return v ? v.trim() : '';
  } catch { return ''; }
}

function resolveYandexCa() {
  let path = process.env.YANDEX_SSL_ROOT_CERT;
  if (!path) path = sslrootcertOf(process.env.YANDEX_DATABASE_URL);
  if (!path || !existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

const PUBLIC_TABLES = [
  'roles', 'units', 'construction_scopes', 'tender_statuses', 'markup_parameters',
  'library_folders', 'notifications', 'users', 'cost_categories', 'material_names',
  'work_names', 'detail_cost_categories', 'markup_tactics', 'materials_library',
  'works_library', 'tender_registry', 'tenders', 'client_positions',
  'import_sessions', 'templates', 'construction_cost_volumes', 'tender_insurance',
  'tender_markup_percentage', 'tender_notes', 'tender_pricing_distribution',
  'tender_documents', 'subcontract_growth_exclusions', 'user_tasks', 'boq_items',
  'boq_items_audit', 'template_items', 'user_position_filters', 'comparison_notes',
  'cost_redistribution_results', 'projects', 'project_additional_agreements',
  'project_monthly_completion', 'tender_groups', 'tender_group_members',
  'tender_iterations',
];

const AUTH_TABLES = ['users', 'identities'];

function makeClient(label, dsn, ssl) {
  if (!dsn) throw new Error(`${label}: DSN missing in env`);
  const cfg = { connectionString: dsn };
  if (ssl) cfg.ssl = ssl;
  return new pg.Client(cfg);
}

async function tableCount(client, schema, table) {
  try {
    const { rows } = await client.query(
      `SELECT COUNT(*)::bigint AS n FROM ${schema}.${table}`
    );
    return Number(rows[0].n);
  } catch (e) {
    return { error: e.code === '42P01' ? 'missing' : (e.code || 'err') };
  }
}

async function tablesInSchema(client, schema) {
  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
    [schema]
  );
  return rows.map(r => r.tablename);
}

async function pkSet(client, schema, table, pkCol = 'id') {
  const { rows } = await client.query(
    `SELECT ${pkCol} FROM ${schema}.${table}`
  );
  return new Set(rows.map(r => r[pkCol]));
}

async function maxTs(client, schema, table, col) {
  try {
    const { rows } = await client.query(
      `SELECT MAX(${col}) AS m FROM ${schema}.${table}`
    );
    return rows[0].m ? rows[0].m.toISOString() : null;
  } catch {
    return null;
  }
}

function setDiff(a, b) {
  const onlyA = [];
  for (const x of a) if (!b.has(x)) onlyA.push(x);
  return onlyA;
}

async function main() {
  const oldUrl = process.env.OLD_SUPABASE_EXPORT_DB_URL || process.env.OLD_SUPABASE_DB_URL;
  const prodUrl = process.env.PROD_SUPABASE_EXPORT_DB_URL || process.env.PROD_SUPABASE_DB_URL;
  const yandexUrl = process.env.YANDEX_DATABASE_URL;
  const yandexCa = resolveYandexCa();

  console.log('▶ refresh audit 2026-05-25 (read-only)');
  console.log(`  OLD    : ${maskHost(oldUrl)}`);
  console.log(`  PROD   : ${maskHost(prodUrl)}`);
  console.log(`  Yandex : ${maskHost(yandexUrl)} (TLS ${yandexCa ? 'verify-full' : 'NO CA — abort'})`);

  if (!yandexCa) {
    console.error('Yandex CA not resolvable — aborting');
    process.exit(2);
  }

  const oldC = makeClient('OLD', oldUrl, { rejectUnauthorized: false });
  const prodC = makeClient('PROD', prodUrl, { rejectUnauthorized: false });
  const yandexC = makeClient('Yandex', yandexUrl, { ca: yandexCa, rejectUnauthorized: true });

  await oldC.connect();
  await prodC.connect();
  await yandexC.connect();

  console.log('✓ connected to all three');

  // ---- 1. Row counts: public tables on OLD/PROD/Yandex ----
  const publicRows = [];
  for (const t of PUBLIC_TABLES) {
    const [o, p, y] = await Promise.all([
      tableCount(oldC, 'public', t),
      tableCount(prodC, 'public', t),
      tableCount(yandexC, 'public', t),
    ]);
    publicRows.push({ table: t, old: o, prod: p, yandex: y });
  }

  // ---- 2. Auth tables ----
  const authRows = [];
  for (const t of AUTH_TABLES) {
    const [o, p, y] = await Promise.all([
      tableCount(oldC, 'auth', t),
      tableCount(prodC, 'auth', t),
      tableCount(yandexC, 'auth', t),
    ]);
    authRows.push({ table: t, old: o, prod: p, yandex: y });
  }

  // ---- 3. app_auth tables (Yandex only) ----
  const appAuthTables = await tablesInSchema(yandexC, 'app_auth');
  const appAuthRows = [];
  for (const t of appAuthTables) {
    const n = await tableCount(yandexC, 'app_auth', t);
    appAuthRows.push({ table: t, yandex: n });
  }

  // ---- 4. boq_items PK diff: OLD vs Yandex ----
  console.log('  computing boq_items PK diff…');
  const [oldBoq, yandexBoq] = await Promise.all([
    pkSet(oldC, 'public', 'boq_items'),
    pkSet(yandexC, 'public', 'boq_items'),
  ]);
  const onlyOnYandexBoq = setDiff(yandexBoq, oldBoq);
  const onlyOnOldBoq = setDiff(oldBoq, yandexBoq);
  const sharedBoq = oldBoq.size - onlyOnOldBoq.length;

  // ---- 5. tenders PK diff ----
  const [oldTenders, yandexTenders] = await Promise.all([
    pkSet(oldC, 'public', 'tenders'),
    pkSet(yandexC, 'public', 'tenders'),
  ]);
  const onlyOnYandexTenders = setDiff(yandexTenders, oldTenders);
  const onlyOnOldTenders = setDiff(oldTenders, yandexTenders);

  // ---- 6. auth.users emails on OLD vs Yandex public.users / app_auth.users ----
  // app_auth.users may not exist or have different shape — try id+email
  let appAuthUsers = [];
  try {
    const { rows } = await yandexC.query(
      `SELECT id, user_id, email FROM app_auth.users ORDER BY email`
    );
    appAuthUsers = rows;
  } catch {
    try {
      const { rows } = await yandexC.query(
        `SELECT * FROM app_auth.users LIMIT 100`
      );
      appAuthUsers = rows;
    } catch {
      // ignore
    }
  }
  const { rows: oldAuthUsers } = await oldC.query(
    `SELECT id, email FROM auth.users ORDER BY email`
  );

  // ---- 7. Latest updated_at across tables (data freshness signal) ----
  const FRESHNESS = [
    ['public.tenders', 'updated_at'],
    ['public.client_positions', 'updated_at'],
    ['public.boq_items', 'updated_at'],
    ['public.users', 'updated_at'],
    ['auth.users', 'updated_at'],
  ];
  const fresh = [];
  for (const [tbl, col] of FRESHNESS) {
    const [schema, table] = tbl.split('.');
    const [o, p, y] = await Promise.all([
      maxTs(oldC, schema, table, col),
      maxTs(prodC, schema, table, col),
      maxTs(yandexC, schema, table, col),
    ]);
    fresh.push({ tbl, col, old: o, prod: p, yandex: y });
  }

  await oldC.end();
  await prodC.end();
  await yandexC.end();

  // ---- Report ----
  const lines = [];
  const fmt = (v) => typeof v === 'object' && v?.error ? `(${v.error})` : (v == null ? '—' : String(v));
  const delta = (a, b) => {
    if (typeof a !== 'number' || typeof b !== 'number') return '';
    const d = a - b;
    if (d === 0) return '';
    return d > 0 ? ` +${d}` : ` ${d}`;
  };

  lines.push('# Refresh audit — 2026-05-25');
  lines.push('');
  lines.push('Read-only сравнение OLD Supabase / PROD Supabase / Yandex Managed PG.');
  lines.push('Цель: понять расхождения перед запуском полного refresh.');
  lines.push('');
  lines.push('## 1. Row counts — public schema');
  lines.push('');
  lines.push('| Table | OLD | PROD | Yandex | OLD−Yandex |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const r of publicRows) {
    const diffOldYandex = (typeof r.old === 'number' && typeof r.yandex === 'number') ? r.old - r.yandex : '';
    lines.push(`| \`${r.table}\` | ${fmt(r.old)} | ${fmt(r.prod)} | ${fmt(r.yandex)} | ${diffOldYandex} |`);
  }
  lines.push('');

  lines.push('## 2. Row counts — auth schema');
  lines.push('');
  lines.push('| Table | OLD | PROD | Yandex |');
  lines.push('|---|---:|---:|---:|');
  for (const r of authRows) {
    lines.push(`| \`auth.${r.table}\` | ${fmt(r.old)} | ${fmt(r.prod)} | ${fmt(r.yandex)} |`);
  }
  lines.push('');

  lines.push('## 3. app_auth schema (Yandex only)');
  lines.push('');
  if (appAuthRows.length === 0) {
    lines.push('Схема `app_auth` отсутствует.');
  } else {
    lines.push('| Table | Yandex rows |');
    lines.push('|---|---:|');
    for (const r of appAuthRows) {
      lines.push(`| \`app_auth.${r.table}\` | ${fmt(r.yandex)} |`);
    }
  }
  lines.push('');

  lines.push('## 4. boq_items PK diff (OLD vs Yandex)');
  lines.push('');
  lines.push(`- OLD total: ${oldBoq.size}`);
  lines.push(`- Yandex total: ${yandexBoq.size}`);
  lines.push(`- Shared id: ${sharedBoq}`);
  lines.push(`- Only on OLD (new on OLD since last refresh): ${onlyOnOldBoq.length}`);
  lines.push(`- Only on Yandex (exist on Yandex, absent on OLD): ${onlyOnYandexBoq.length}`);
  lines.push('');
  if (onlyOnYandexBoq.length > 0) {
    lines.push('### Sample Yandex-only boq_items id (max 20)');
    lines.push('');
    lines.push('```');
    for (const id of onlyOnYandexBoq.slice(0, 20)) lines.push(id);
    lines.push('```');
    lines.push('');
  }
  if (onlyOnOldBoq.length > 0) {
    lines.push('### Sample OLD-only boq_items id (max 20)');
    lines.push('');
    lines.push('```');
    for (const id of onlyOnOldBoq.slice(0, 20)) lines.push(id);
    lines.push('```');
    lines.push('');
  }

  lines.push('## 5. tenders PK diff (OLD vs Yandex)');
  lines.push('');
  lines.push(`- OLD total: ${oldTenders.size}`);
  lines.push(`- Yandex total: ${yandexTenders.size}`);
  lines.push(`- Only on OLD: ${onlyOnOldTenders.length}`);
  lines.push(`- Only on Yandex: ${onlyOnYandexTenders.length}`);
  if (onlyOnOldTenders.length > 0 && onlyOnOldTenders.length <= 20) {
    lines.push('');
    lines.push('### OLD-only tender id');
    lines.push('');
    lines.push('```');
    for (const id of onlyOnOldTenders) lines.push(id);
    lines.push('```');
  }
  if (onlyOnYandexTenders.length > 0 && onlyOnYandexTenders.length <= 20) {
    lines.push('');
    lines.push('### Yandex-only tender id');
    lines.push('');
    lines.push('```');
    for (const id of onlyOnYandexTenders) lines.push(id);
    lines.push('```');
  }
  lines.push('');

  lines.push('## 6. app_auth.users vs OLD auth.users (email overlap)');
  lines.push('');
  lines.push(`- OLD auth.users: ${oldAuthUsers.length}`);
  lines.push(`- Yandex app_auth.users: ${appAuthUsers.length}`);
  if (appAuthUsers.length && appAuthUsers[0].email !== undefined) {
    const oldEmails = new Set(oldAuthUsers.map(u => (u.email || '').toLowerCase()));
    const appEmails = new Set(appAuthUsers.map(u => (u.email || '').toLowerCase()).filter(Boolean));
    const onlyApp = setDiff(appEmails, oldEmails);
    const onlyOld = setDiff(oldEmails, appEmails);
    lines.push(`- Emails only in app_auth (registered via Go BFF, not on OLD): ${onlyApp.length}`);
    lines.push(`- Emails only in OLD auth (need re-creation if migrate is run): ${onlyOld.length}`);
    if (onlyApp.length > 0 && onlyApp.length <= 30) {
      lines.push('');
      lines.push('### Emails only in app_auth');
      lines.push('');
      for (const e of onlyApp) lines.push(`- ${e}`);
    }
    if (onlyOld.length > 0 && onlyOld.length <= 30) {
      lines.push('');
      lines.push('### Emails only in OLD auth');
      lines.push('');
      for (const e of onlyOld) lines.push(`- ${e}`);
    }
  } else {
    lines.push('Не удалось прочитать app_auth.users.email — структура не совпадает с ожиданием.');
  }
  lines.push('');

  lines.push('## 7. Data freshness (MAX updated_at)');
  lines.push('');
  lines.push('| Table | column | OLD | PROD | Yandex |');
  lines.push('|---|---|---|---|---|');
  for (const f of fresh) {
    lines.push(`| \`${f.tbl}\` | ${f.col} | ${fmt(f.old)} | ${fmt(f.prod)} | ${fmt(f.yandex)} |`);
  }
  lines.push('');

  lines.push('## Сводка');
  lines.push('');
  const totalOldPub = publicRows.reduce((s, r) => s + (typeof r.old === 'number' ? r.old : 0), 0);
  const totalProdPub = publicRows.reduce((s, r) => s + (typeof r.prod === 'number' ? r.prod : 0), 0);
  const totalYandexPub = publicRows.reduce((s, r) => s + (typeof r.yandex === 'number' ? r.yandex : 0), 0);
  lines.push(`- Total public rows: OLD=${totalOldPub} PROD=${totalProdPub} Yandex=${totalYandexPub}`);
  lines.push(`- Net new on OLD vs Yandex: ${totalOldPub - totalYandexPub}`);
  lines.push(`- app_auth tables: ${appAuthTables.length}`);
  lines.push(`- boq_items: ${onlyOnOldBoq.length} новых на OLD, ${onlyOnYandexBoq.length} только на Yandex`);
  lines.push(`- tenders: ${onlyOnOldTenders.length} новых на OLD, ${onlyOnYandexTenders.length} только на Yandex`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);

  writeFileSync(DOC_PATH, lines.join('\n'), 'utf8');
  console.log(`✓ wrote ${DOC_PATH}`);
}

main().catch((e) => {
  console.error('audit failed:', e.message);
  process.exit(1);
});
