#!/usr/bin/env node
// scripts/cleanup/list-tender-versions.mjs
//
// READ-ONLY inspector: для указанного --tender-id находит tender_number,
// перечисляет все строки tenders с этим tender_number и для каждой версии
// печатает количество дочерних записей (client_positions, boq_items) +
// блокирующие projects-ссылки (FK без CASCADE).
//
// Usage:
//   node scripts/cleanup/list-tender-versions.mjs --tender-id <uuid>
//
// Env:
//   DATABASE_URL  postgres://...@<yandex-host>:6432/HubTender?sslmode=verify-full&sslrootcert=...
//
// Никогда не печатает DSN/секреты. Только host/db и результаты SELECT'ов.

import pg from 'pg';

const { Client } = pg;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tender-id') {
      args.tenderId = argv[++i];
    }
  }
  return args;
}

function hostOnly(dsn) {
  try {
    const u = new URL(dsn);
    return `${u.host}${u.pathname || ''}`;
  } catch {
    return '<unparsable>';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const { tenderId } = parseArgs(process.argv);
  if (!tenderId || !UUID_RE.test(tenderId)) {
    console.error('[FAIL] expected --tender-id <uuid>');
    process.exit(2);
  }

  const dsn = process.env.YANDEX_DATABASE_URL || process.env.DATABASE_URL;
  if (!dsn) {
    console.error('[FAIL] neither YANDEX_DATABASE_URL nor DATABASE_URL is set');
    process.exit(2);
  }

  const host = hostOnly(dsn);
  console.log(`[info] target: ${host}`);
  console.log(`[info] source tender id: ${tenderId}`);

  const client = new Client({ connectionString: dsn });
  try {
    await client.connect();
  } catch (err) {
    console.error(`[FAIL] connect to ${host}: ${err.message}`);
    process.exit(2);
  }

  try {
    await client.query('BEGIN READ ONLY');

    const source = await client.query(
      `SELECT tender_number, title FROM public.tenders WHERE id = $1`,
      [tenderId],
    );
    if (source.rowCount === 0) {
      console.error(`[FAIL] tender ${tenderId} not found`);
      await client.query('ROLLBACK');
      process.exit(1);
    }
    const { tender_number, title } = source.rows[0];
    console.log(`[info] tender_number = ${tender_number ?? '<null>'}`);
    console.log(`[info] title         = ${title ?? '<null>'}`);

    if (!tender_number) {
      console.error('[FAIL] source tender has no tender_number — нельзя сгруппировать версии');
      await client.query('ROLLBACK');
      process.exit(1);
    }

    const versions = await client.query(
      `SELECT id, version, title, created_at, updated_at
       FROM public.tenders
       WHERE tender_number = $1
       ORDER BY version ASC, created_at ASC`,
      [tender_number],
    );

    console.log(`\n[info] versions with tender_number = ${tender_number}: ${versions.rowCount}\n`);

    const minVersion = versions.rows.reduce(
      (acc, r) => (r.version != null && r.version < acc ? r.version : acc),
      Number.POSITIVE_INFINITY,
    );

    const rows = [];
    for (const row of versions.rows) {
      const [positions, boqItems, projectsRefs] = await Promise.all([
        client.query(`SELECT COUNT(*)::int AS c FROM public.client_positions WHERE tender_id = $1`, [row.id]),
        client.query(`SELECT COUNT(*)::int AS c FROM public.boq_items WHERE tender_id = $1`, [row.id]),
        client.query(`SELECT COUNT(*)::int AS c FROM public.projects WHERE tender_id = $1`, [row.id]),
      ]);
      rows.push({
        version: row.version,
        id: row.id,
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        positions: positions.rows[0].c,
        boq_items: boqItems.rows[0].c,
        projects_refs: projectsRefs.rows[0].c,
        likely_junk: row.version !== minVersion,
      });
    }

    console.table(rows);

    const junkIds = rows.filter((r) => r.likely_junk).map((r) => r.id);
    const blockers = rows.filter((r) => r.likely_junk && r.projects_refs > 0);

    if (junkIds.length === 0) {
      console.log('\n[info] junk-версий не найдено (есть только минимальная версия).');
    } else {
      console.log(`\n[info] LIKELY_JUNK ids (${junkIds.length}):`);
      console.log(junkIds.join(','));
    }

    if (blockers.length > 0) {
      console.log('\n[WARN] на следующих junk-версиях есть projects.tender_id ссылки (FK без CASCADE):');
      for (const b of blockers) {
        console.log(`  - v${b.version} ${b.id} → projects_refs = ${b.projects_refs}`);
      }
      console.log('       DELETE упадёт с FK-violation, пока не разобраться с этими строками.');
    }

    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[FAIL]', err.message);
  process.exit(1);
});
