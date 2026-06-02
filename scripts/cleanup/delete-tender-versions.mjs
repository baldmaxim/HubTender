#!/usr/bin/env node
// scripts/cleanup/delete-tender-versions.mjs
//
// DESTRUCTIVE: удаляет указанные tenders.id (CASCADE подтянет все child-таблицы
// с ON DELETE CASCADE; user_tasks.tender_id уйдёт в NULL; projects.tender_id —
// блокирует DELETE, поэтому препроверяется отдельно).
//
// Двойной барьер:
//   1) явный список UUID через --ids (никаких WHERE-условий),
//   2) --commit обязателен; без него — BEGIN/DELETE/ROLLBACK preview.
//
// Usage:
//   # dry-run preview (default)
//   node scripts/cleanup/delete-tender-versions.mjs --ids <uuid1>,<uuid2>
//
//   # реально применить
//   node scripts/cleanup/delete-tender-versions.mjs --ids <uuid1>,<uuid2> --commit
//
// Env:
//   DATABASE_URL  postgres://...

import pg from 'pg';

const { Client } = pg;

function parseArgs(argv) {
  const args = { commit: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ids') {
      args.ids = (argv[++i] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === '--commit') {
      args.commit = true;
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

const CASCADE_CHILDREN = [
  'client_positions',
  'boq_items',
  'import_sessions',
  'construction_cost_volumes',
  'tender_insurance',
  'tender_markup_percentage',
  'tender_notes',
  'tender_pricing_distribution',
  'tender_documents',
  'subcontract_growth_exclusions',
  'user_position_filters',
  'cost_redistribution_results',
  'tender_groups',
];

async function main() {
  const { ids, commit } = parseArgs(process.argv);

  if (!ids || ids.length === 0) {
    console.error('[FAIL] expected --ids <uuid1>,<uuid2>,... (CSV, без пробелов)');
    process.exit(2);
  }
  for (const id of ids) {
    if (!UUID_RE.test(id)) {
      console.error(`[FAIL] invalid uuid: ${id}`);
      process.exit(2);
    }
  }

  const dsn = process.env.YANDEX_DATABASE_URL || process.env.DATABASE_URL;
  if (!dsn) {
    console.error('[FAIL] neither YANDEX_DATABASE_URL nor DATABASE_URL is set');
    process.exit(2);
  }

  console.log(`[info] target: ${hostOnly(dsn)}`);
  console.log(`[info] mode  : ${commit ? 'COMMIT (destructive)' : 'DRY RUN (rollback)'}`);
  console.log(`[info] ids   : ${ids.length}`);

  const client = new Client({ connectionString: dsn });
  await client.connect();

  let tenderNumber = null;
  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT id, version, tender_number, title, created_at
       FROM public.tenders
       WHERE id = ANY($1::uuid[])
       ORDER BY tender_number, version`,
      [ids],
    );
    if (found.rowCount === 0) {
      console.error('[FAIL] ни один из переданных id не найден в tenders');
      await client.query('ROLLBACK');
      process.exit(1);
    }
    if (found.rowCount !== ids.length) {
      const foundIds = new Set(found.rows.map((r) => r.id));
      const missing = ids.filter((id) => !foundIds.has(id));
      console.error(`[FAIL] не найдены в tenders: ${missing.join(',')}`);
      await client.query('ROLLBACK');
      process.exit(1);
    }

    const distinctNumbers = new Set(found.rows.map((r) => r.tender_number).filter(Boolean));
    if (distinctNumbers.size !== 1) {
      console.error(
        `[FAIL] ids ссылаются на разные tender_number (${[...distinctNumbers].join(', ')}) — отказ во избежание ошибки.`,
      );
      await client.query('ROLLBACK');
      process.exit(1);
    }
    tenderNumber = [...distinctNumbers][0];

    console.log(`\n[info] tender_number затронутых строк: ${tenderNumber}\n`);
    console.table(
      found.rows.map((r) => ({
        version: r.version,
        id: r.id,
        title: r.title,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      })),
    );

    const blockers = await client.query(
      `SELECT id, tender_id FROM public.projects WHERE tender_id = ANY($1::uuid[])`,
      [ids],
    );
    if (blockers.rowCount > 0) {
      console.error(
        `\n[FAIL] projects.tender_id указывает на ${blockers.rowCount} строк из удаляемого набора (FK без CASCADE).`,
      );
      console.table(blockers.rows);
      console.error('       DELETE упадёт с FK-violation. Сначала разберись с этими projects.');
      await client.query('ROLLBACK');
      process.exit(1);
    }

    console.log('\n[info] будет удалено через CASCADE:');
    for (const tbl of CASCADE_CHILDREN) {
      const r = await client.query(
        `SELECT COUNT(*)::int AS c FROM public.${tbl} WHERE tender_id = ANY($1::uuid[])`,
        [ids],
      );
      console.log(`  ${tbl.padEnd(35)} ${r.rows[0].c}`);
    }
    const cn = await client.query(
      `SELECT COUNT(*)::int AS c FROM public.comparison_notes WHERE tender_id_1 = ANY($1::uuid[]) OR tender_id_2 = ANY($1::uuid[])`,
      [ids],
    );
    console.log(`  ${'comparison_notes'.padEnd(35)} ${cn.rows[0].c}`);

    const setNull = await client.query(
      `SELECT COUNT(*)::int AS c FROM public.user_tasks WHERE tender_id = ANY($1::uuid[])`,
      [ids],
    );
    console.log(`\n[info] user_tasks с tender_id → NULL (SET NULL, не удаляется): ${setNull.rows[0].c}`);

    const del = await client.query(
      `DELETE FROM public.tenders WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    console.log(`\n[info] DELETE FROM tenders → rowCount = ${del.rowCount}`);

    if (!commit) {
      await client.query('ROLLBACK');
      console.log('\n[DRY RUN] изменения откачены. Прогон с --commit чтобы реально применить.');
      return;
    }

    await client.query('COMMIT');
    console.log('\n[COMMIT] изменения зафиксированы.');

    const after = await client.query(
      `SELECT id, version, created_at
       FROM public.tenders
       WHERE tender_number = $1
       ORDER BY version`,
      [tenderNumber],
    );
    console.log(`\n[info] оставшиеся версии для tender_number = ${tenderNumber}:`);
    console.table(
      after.rows.map((r) => ({
        version: r.version,
        id: r.id,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      })),
    );
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* already rolled back / transaction aborted */
    }
    console.error('[FAIL]', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[FAIL]', err.message);
  process.exit(1);
});
