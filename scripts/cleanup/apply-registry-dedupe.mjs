#!/usr/bin/env node
// scripts/cleanup/apply-registry-dedupe.mjs
//
// Применяет db/yandex/incremental/2026_06_tender_registry_dedupe.sql к Yandex prod.
//   - dry-run (по умолчанию): inspect + backup + ROLLBACK, ничего не меняет.
//   - --apply: внутри ОДНОЙ транзакции выполняет миграцию, проверяет, что дублей
//     по tender_number не осталось, и только тогда COMMIT (иначе ROLLBACK).
// Никогда не печатает DSN/секреты — только host/db и агрегаты.
//
// Env: DATABASE_URL (из .env.prod). SSL — verify-full c локальным CA .certs/yandex-ca.pem.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CA_PATH = path.join(REPO, '.certs/yandex-ca.pem');
const SQL_PATH = path.join(REPO, 'db/yandex/incremental/2026_06_tender_registry_dedupe.sql');
const ENV_PATH = path.join(REPO, '.env.prod');
const APPLY = process.argv.includes('--apply');
const ANALYZE = process.argv.includes('--analyze');

// Тот же scoring, что в миграции — чтобы пометить, какую строку оставит дедуп.
const SCORE_EXPR = `(
    (r.submission_date         IS NOT NULL)::int
  + (r.construction_start_date IS NOT NULL)::int
  + (r.site_visit_date         IS NOT NULL)::int
  + (r.invitation_date         IS NOT NULL)::int
  + (r.commission_date         IS NOT NULL)::int
  + (NULLIF(r.object_address, '')     IS NOT NULL)::int
  + (NULLIF(r.object_coordinates, '') IS NOT NULL)::int
  + (NULLIF(r.chronology, '')         IS NOT NULL)::int
  + (NULLIF(r.has_tender_package, '') IS NOT NULL)::int
  + (r.manual_total_cost     IS NOT NULL)::int
  + (jsonb_array_length(COALESCE(r.chronology_items, '[]'::jsonb))     > 0)::int
  + (jsonb_array_length(COALESCE(r.tender_package_items, '[]'::jsonb)) > 0)::int
  + (r.is_archived)::int
)`;

const ANALYZE_SQL = `
  SELECT r.tender_number,
         row_number() OVER (PARTITION BY r.tender_number ORDER BY ${SCORE_EXPR} DESC, r.created_at ASC, r.id ASC) = 1 AS keep,
         ${SCORE_EXPR} AS score,
         st.name AS status,
         r.dashboard_status,
         r.is_archived,
         (r.submission_date IS NOT NULL)::int + (r.construction_start_date IS NOT NULL)::int
           + (r.site_visit_date IS NOT NULL)::int + (r.invitation_date IS NOT NULL)::int
           + (r.commission_date IS NOT NULL)::int AS dates,
         r.manual_total_cost AS manual_cost,
         jsonb_array_length(COALESCE(r.chronology_items, '[]'::jsonb)) AS chrono,
         jsonb_array_length(COALESCE(r.tender_package_items, '[]'::jsonb)) AS pkg,
         r.created_at, r.updated_at
  FROM public.tender_registry r
  LEFT JOIN public.tender_statuses st ON st.id = r.status_id
  WHERE r.tender_number IN (
    SELECT tender_number FROM public.tender_registry
    WHERE tender_number IS NOT NULL GROUP BY tender_number HAVING count(*) > 1
  )
  ORDER BY r.tender_number, keep DESC, score DESC, r.created_at`;

// Читаем DSN ЛИТЕРАЛЬНО из .env.prod (не из process.env и не через `source`):
// значение содержит `&`, который ломает shell-sourcing, а в окружении может
// висеть унаследованный Supabase-DATABASE_URL. Берём всё после первого `=`.
function readDsnFromEnvFile(file) {
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#') || !line.startsWith('DATABASE_URL=')) continue;
    let v = line.slice('DATABASE_URL='.length).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  }
  return null;
}

// Жёсткий guard: применяем ТОЛЬКО к Yandex prod. Старый Supabase — неприкосновенен.
function assertYandexHost(u) {
  if (!u.hostname.endsWith('mdb.yandexcloud.net')) {
    console.error(`[ABORT] host=${u.hostname} — это не Yandex Managed PG. Прерываю (Supabase tr-able только вручную).`);
    process.exit(2);
  }
}

const DUP_SQL = `
  SELECT tender_number, count(*)::int AS c
  FROM public.tender_registry
  WHERE tender_number IS NOT NULL
  GROUP BY tender_number
  HAVING count(*) > 1
  ORDER BY c DESC, tender_number`;

function clientFromDsn(dsn) {
  const u = new URL(dsn);
  return new Client({
    host: u.hostname,
    port: Number(u.port || 6432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: (u.pathname || '/').replace(/^\//, ''),
    ssl: { ca: fs.readFileSync(CA_PATH), rejectUnauthorized: true, servername: u.hostname },
    statement_timeout: 120000,
  });
}

async function main() {
  const dsn = readDsnFromEnvFile(ENV_PATH);
  if (!dsn) { console.error(`[FAIL] DATABASE_URL not found in ${ENV_PATH}`); process.exit(2); }
  const u = new URL(dsn);
  assertYandexHost(u);
  console.log(`[info] target: ${u.host}${u.pathname}`);
  console.log(`[info] mode  : ${APPLY ? 'APPLY (will COMMIT if clean)' : 'DRY-RUN (ROLLBACK)'}`);

  const migrationSql = fs.readFileSync(SQL_PATH, 'utf8');
  const client = clientFromDsn(dsn);
  await client.connect();

  try {
    if (process.argv.includes('--show-fn')) {
      const fn = (await client.query(
        `SELECT pg_get_functiondef('public.auto_create_tender_registry'::regproc) AS def`,
      )).rows[0].def;
      const guarded = fn.includes('EXISTS (SELECT 1 FROM tender_registry WHERE tender_number = NEW.tender_number)');
      console.log(`\n[verify] guard в auto_create_tender_registry: ${guarded ? '✓ присутствует' : '✗ ОТСУТСТВУЕТ'}`);
      await client.end();
      return;
    }

    if (ANALYZE) {
      const rows = (await client.query(ANALYZE_SQL)).rows;
      console.log(`\n[analyze] строки дублированных tender_number (keep=строка, которую оставит дедуп):\n`);
      console.table(rows.map((r) => ({
        num: r.tender_number,
        keep: r.keep ? '✓' : '',
        score: r.score,
        status: r.status,
        dash: r.dashboard_status,
        arch: r.is_archived ? 'Y' : '',
        dates: r.dates,
        manual: r.manual_cost,
        chrono: r.chrono,
        pkg: r.pkg,
        created: r.created_at instanceof Date ? r.created_at.toISOString().slice(0, 10) : r.created_at,
      })));
      await client.end();
      return;
    }

    // --- Backup полной таблицы (до любых изменений) ---
    const all = await client.query('SELECT * FROM public.tender_registry ORDER BY tender_number, created_at');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `c:/tmp/tender_registry_backup_${stamp}.json`;
    fs.writeFileSync(backupPath, JSON.stringify(all.rows, null, 2));
    console.log(`[info] backup: ${all.rowCount} rows → ${backupPath}`);

    // --- Сколько дублей ДО ---
    const before = await client.query(DUP_SQL);
    console.log(`\n[info] tender_number с дублями (ДО): ${before.rowCount}`);
    if (before.rowCount > 0) {
      console.table(before.rows.map((r) => ({ tender_number: r.tender_number, rows: r.c })));
      const extra = before.rows.reduce((s, r) => s + (r.c - 1), 0);
      console.log(`[info] лишних (пустых) строк к слиянию/удалению: ${extra}`);
    }

    const dupNums = before.rows.map((r) => r.tender_number);

    await client.query('BEGIN');
    await client.query(migrationSql);

    const after = await client.query(DUP_SQL);
    console.log(`\n[info] tender_number с дублями (ПОСЛЕ миграции, в транзакции): ${after.rowCount}`);

    // Показать выжившую строку по каждому ранее-дублированному номеру — проверить,
    // что статус/даты/сумма перенеслись верно (в транзакции, до rollback/commit).
    if (dupNums.length > 0) {
      const survivors = await client.query(
        `SELECT r.tender_number,
                st.name AS status, r.dashboard_status AS dash, r.is_archived AS arch,
                (r.submission_date IS NOT NULL)::int + (r.construction_start_date IS NOT NULL)::int
                  + (r.site_visit_date IS NOT NULL)::int + (r.invitation_date IS NOT NULL)::int
                  + (r.commission_date IS NOT NULL)::int AS dates,
                r.manual_total_cost AS manual,
                jsonb_array_length(COALESCE(r.chronology_items, '[]'::jsonb)) AS chrono,
                jsonb_array_length(COALESCE(r.tender_package_items, '[]'::jsonb)) AS pkg
         FROM public.tender_registry r
         LEFT JOIN public.tender_statuses st ON st.id = r.status_id
         WHERE r.tender_number = ANY($1)
         ORDER BY r.tender_number`,
        [dupNums],
      );
      console.log('\n[info] выжившие строки (после слияния):');
      console.table(survivors.rows.map((r) => ({
        num: r.tender_number, status: r.status, dash: r.dash, arch: r.arch ? 'Y' : '',
        dates: r.dates, manual: r.manual, chrono: r.chrono, pkg: r.pkg,
      })));
    }

    if (after.rowCount !== 0) {
      console.error('[FAIL] дубли остались — ROLLBACK, изменения отменены');
      console.table(after.rows.map((r) => ({ tender_number: r.tender_number, rows: r.c })));
      await client.query('ROLLBACK');
      process.exit(1);
    }

    if (APPLY) {
      await client.query('COMMIT');
      console.log('\n[OK] COMMIT — миграция применена, дублей реестра нет.');
    } else {
      await client.query('ROLLBACK');
      console.log('\n[OK] DRY-RUN — проверка прошла (дублей не осталось бы). ROLLBACK, прод не изменён.');
      console.log('     Для реального применения: добавьте --apply');
    }
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    console.error('[FAIL]', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error('[FAIL]', err.message); process.exit(1); });
