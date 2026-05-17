#!/usr/bin/env node
// 12_test_raw_type_roundtrip — regression test for ALL raw type parsers
// (date / timestamp / timestamptz / json / jsonb). Superset of 11; proves the
// migration pg client round-trips temporal AND json/jsonb as RAW strings, so
// the server-side md5(string_agg(t::text)) checksum is byte-stable OLD↔PROD.
// See docs/old-to-prod/VERIFY_ROOT_CAUSE.md.
//
// SAFETY: never touches a real table. Opens a transaction, creates a
// TEMP TABLE (ON COMMIT DROP), inserts synthetic constants via string
// parameters, reads them back, then ROLLBACKs — zero persisted changes.
// Connection string is never logged.
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
  // Keys deliberately NOT in sorted order — proves jsonb stays PG-canonical
  // text, not a JS object re-stringified in insertion order.
  jsonb: '{"b": 2, "a": 1, "n": 2.50}',
  json: '{"b": 2, "a": 1}',
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

  console.log(`${tag(which.toUpperCase())} raw-type round-trip — host type: ${redactHostType(url)} (TEMP TABLE only, rolled back)`);

  const client = await getClient(url, { applicationName: 'old-to-prod-rawtype-test' });
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE _tmp_rawtype_rt (
        id   int PRIMARY KEY,
        d    date NOT NULL,
        ts   timestamp NOT NULL,
        tstz timestamptz NOT NULL,
        jb   jsonb NOT NULL,
        js   json NOT NULL
      ) ON COMMIT DROP
    `);
    // Insert via STRING parameters — exercises the full param-binding path the
    // importer uses (NDJSON strings → pg params → PG), not SQL literals.
    await client.query(
      `INSERT INTO _tmp_rawtype_rt (id, d, ts, tstz, jb, js)
       VALUES (1, $1::date, $2::timestamp, $3::timestamptz, $4::jsonb, $5::json)`,
      [SYNTH.date, SYNTH.timestamp, SYNTH.timestamptz, SYNTH.jsonb, SYNTH.json],
    );
    const { rows: [r] } = await client.query(
      'SELECT d, ts, tstz, jb, js FROM _tmp_rawtype_rt WHERE id = 1',
    );

    console.log(`${tag(which.toUpperCase())} read back: d=${r.d} ts=${r.ts} tstz=${r.tstz} jb=${r.jb} js=${r.js}`);

    assert(typeof r.d === 'string', `date is a raw string (got ${typeof r.d})`);
    assert(r.d === '2026-05-17', `date is exactly "2026-05-17" — no ±1-day shift (got "${r.d}")`);

    assert(typeof r.ts === 'string', `timestamp is a raw string (got ${typeof r.ts})`);
    assert(r.ts.includes('.123456'), `timestamp keeps microseconds ".123456" (got "${r.ts}")`);

    assert(typeof r.tstz === 'string', `timestamptz is a raw string (got ${typeof r.tstz})`);
    assert(/\.123456/.test(r.tstz), `timestamptz keeps microsecond precision ".123456" (got "${r.tstz}")`);
    assert(/\+00(:00)?$/.test(r.tstz), `timestamptz rendered in UTC (got "${r.tstz}")`);

    assert(typeof r.jb === 'string', `jsonb is a raw string, NOT a JS object (got ${typeof r.jb})`);
    assert(typeof r.js === 'string', `json is a raw string, NOT a JS object (got ${typeof r.js})`);
    // PG jsonb canonicalises: keys sorted, numeric scale preserved per PG rules.
    // The point is determinism, not a specific layout — re-reading the SAME
    // value twice must yield the SAME string (idempotent → checksum-stable).
    const { rows: [r2] } = await client.query('SELECT jb::text AS jb2 FROM _tmp_rawtype_rt WHERE id = 1');
    assert(r.jb === r2.jb2, `jsonb text representation is deterministic/idempotent (got "${r.jb}" vs "${r2.jb2}")`);

    await client.query('ROLLBACK'); // nothing persisted; TEMP table dropped
    console.log(`\n✓ RAW_TYPE_ROUNDTRIP_OK — date/timestamp/timestamptz/json/jsonb raw parsers + UTC/ISO session verified on ${which.toUpperCase()} (no data changed).`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (process.exitCode === 1) {
      console.error(`\n✗ RAW_TYPE_ROUNDTRIP_FAILED — ${e.message}`);
      process.exit(1);
    }
    throw e;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((e) => fatal(e, 2));
