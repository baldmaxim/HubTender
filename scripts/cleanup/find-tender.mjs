#!/usr/bin/env node
// READ-ONLY: ищет тендеры по подстроке title (--query),
// показывает версии и счётчики client_positions / boq_items.

import pg from 'pg';

const { Client } = pg;

function parseArgs(argv) {
  const args = { query: '' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--query') args.query = argv[++i];
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

async function main() {
  const { query } = parseArgs(process.argv);
  if (!query) {
    console.error('[FAIL] expected --query <substring>');
    process.exit(2);
  }
  const dsn = process.env.YANDEX_DATABASE_URL || process.env.DATABASE_URL;
  if (!dsn) {
    console.error('[FAIL] DATABASE_URL not set');
    process.exit(2);
  }
  console.log(`[info] target: ${hostOnly(dsn)}`);
  console.log(`[info] query : %${query}%\n`);

  const client = new Client({ connectionString: dsn });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const rows = await client.query(
      `SELECT t.id, t.tender_number, t.title, t.version, t.created_at,
              (SELECT COUNT(*)::int FROM public.client_positions WHERE tender_id = t.id) AS positions,
              (SELECT COUNT(*)::int FROM public.boq_items WHERE tender_id = t.id) AS boq_items
       FROM public.tenders t
       WHERE t.title ILIKE $1
       ORDER BY t.tender_number, t.version, t.created_at`,
      [`%${query}%`],
    );
    if (rows.rowCount === 0) {
      console.log('[info] не найдено ни одного тендера');
    } else {
      console.table(
        rows.rows.map((r) => ({
          id: r.id,
          number: r.tender_number,
          title: r.title,
          v: r.version,
          positions: r.positions,
          boq_items: r.boq_items,
          created_at: r.created_at instanceof Date ? r.created_at.toISOString().slice(0, 19) : String(r.created_at),
        })),
      );
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
