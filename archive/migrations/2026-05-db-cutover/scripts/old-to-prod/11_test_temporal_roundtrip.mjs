#!/usr/bin/env node
// 11_test_temporal_roundtrip — regression test for the date/timestamp/timestamptz
// corruption that caused VERIFY_FAILED (see docs/old-to-prod/VERIFY_ROOT_CAUSE.md).
//
// Proves the migration pg client now round-trips temporal types as RAW strings
// with full microsecond precision and no ±1-day timezone shift.
//
// SAFETY: never touches a real table. Opens a transaction, creates a
// TEMP TABLE (ON COMMIT DROP), inserts synthetic constants via string
// parameters, reads them back, then ROLLBACKs — zero persisted changes on the
// target DB. Connection string is never logged.
//
// Target DB: env TEMPORAL_TEST_DB = 'prod' (default, disposable) | 'old'.
//
// Exit codes: 0 = PASS, 1 = FAIL (assertion), 2 = missing env / connect error.

import {
  loadDotenv, requireEnv, getClient, redactHostType, tag, fatal,
} from './_lib.mjs';

const SYNTH = {
  date: '2026-05-17',
  timestamp: '2026-05-17 12:34:56.123456',
  timestamptz: '2026-05-17 12:34:56.123456+00',
};

function assert(cond, msg) {
  if (!cond) {
    console.error(`✗ ASSERT FAILED: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log(`  ✓ ${msg}`);
}

async function main() {
  loadDotenv();

  const which = (process.env.TEMPORAL_TEST_DB || 'prod').toLowerCase();
  if (which !== 'prod' && which !== 'old') {
    console.error(`✗ TEMPORAL_TEST_DB must be 'prod' or 'old' (got '${which}').`);
    process.exit(2);
  }
  const envVar = which === 'old' ? 'OLD_SUPABASE_DB_URL' : 'PROD_SUPABASE_DB_URL';
  const url = requireEnv(envVar);

  console.log(`${tag(which.toUpperCase())} temporal round-trip test — host type: ${redactHostType(url)} (TEMP TABLE only, rolled back)`);

  const client = await getClient(url, { applicationName: 'old-to-prod-temporal-test' });
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE _tmp_temporal_rt (
        id   int PRIMARY KEY,
        d    date NOT NULL,
        ts   timestamp NOT NULL,
        tstz timestamptz NOT NULL
      ) ON COMMIT DROP
    `);
    // Insert via STRING parameters — exercises the full param-binding path the
    // importer uses (NDJSON strings → pg params → PG), not SQL literals.
    await client.query(
      `INSERT INTO _tmp_temporal_rt (id, d, ts, tstz)
       VALUES (1, $1::date, $2::timestamp, $3::timestamptz)`,
      [SYNTH.date, SYNTH.timestamp, SYNTH.timestamptz],
    );
    const { rows: [r] } = await client.query(
      'SELECT d, ts, tstz FROM _tmp_temporal_rt WHERE id = 1',
    );

    console.log(`${tag(which.toUpperCase())} read back: d=${r.d} ts=${r.ts} tstz=${r.tstz}`);

    assert(typeof r.d === 'string', `date is a raw string (got ${typeof r.d})`);
    assert(r.d === '2026-05-17', `date is exactly "2026-05-17" — no ±1-day shift (got "${r.d}")`);

    assert(typeof r.ts === 'string', `timestamp is a raw string (got ${typeof r.ts})`);
    assert(r.ts.includes('.123456'), `timestamp keeps microseconds ".123456" (got "${r.ts}")`);

    assert(typeof r.tstz === 'string', `timestamptz is a raw string (got ${typeof r.tstz})`);
    assert(/\.123456/.test(r.tstz), `timestamptz keeps microsecond precision ".123456" (got "${r.tstz}")`);
    assert(/\+00(:00)?$/.test(r.tstz), `timestamptz rendered in UTC (got "${r.tstz}")`);

    await client.query('ROLLBACK'); // nothing persisted; TEMP table dropped
    console.log(`\n✓ TEMPORAL_ROUNDTRIP_OK — raw parsers + UTC/ISO session verified on ${which.toUpperCase()} (no data changed).`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (process.exitCode === 1) {
      console.error(`\n✗ TEMPORAL_ROUNDTRIP_FAILED — ${e.message}`);
      process.exit(1);
    }
    throw e;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((e) => fatal(e, 2));
