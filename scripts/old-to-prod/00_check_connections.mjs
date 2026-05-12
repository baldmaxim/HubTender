#!/usr/bin/env node
// 00_check_connections — verify reachability of OLD and PROD Supabase Postgres
// endpoints. Does not modify either database. Logs version + table presence,
// never credentials.
//
// Usage: npm run old-to-prod:check
// Required env: OLD_SUPABASE_DB_URL, PROD_SUPABASE_DB_URL (see .env.old-to-prod.example).

import { loadDotenv, requireEnv, getClient, tag } from './_lib.mjs';

loadDotenv();

async function probe(label, url) {
  let client;
  try {
    client = await getClient(url);
  } catch (e) {
    console.error(`${tag(label)} ✗ connect failed: ${e.code || e.message}`);
    return false;
  }
  try {
    const { rows: [v] } = await client.query('SELECT version() AS version');
    const major = (v.version.match(/PostgreSQL (\d+)/) || [])[1] || '?';

    const { rows: [t] } = await client.query(`
      SELECT
        to_regclass('public.users') IS NOT NULL AS public_users,
        to_regclass('auth.users')   IS NOT NULL AS auth_users,
        to_regclass('auth.identities') IS NOT NULL AS auth_identities
    `);

    const status = [
      `PostgreSQL ${major}`,
      `public.users=${t.public_users ? 'ok' : 'MISSING'}`,
      `auth.users=${t.auth_users ? 'ok' : 'MISSING'}`,
      `auth.identities=${t.auth_identities ? 'ok' : 'MISSING'}`,
    ].join(' — ');
    console.log(`${tag(label)} ${status}`);

    const ok = t.public_users && t.auth_users;
    return ok;
  } catch (e) {
    console.error(`${tag(label)} ✗ query failed: ${e.message}`);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  let oldUrl, prodUrl;
  try {
    oldUrl = requireEnv('OLD_SUPABASE_DB_URL');
    prodUrl = requireEnv('PROD_SUPABASE_DB_URL');
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(2);
  }

  const [okOld, okProd] = await Promise.all([
    probe('OLD', oldUrl),
    probe('PROD', prodUrl),
  ]);

  if (okOld && okProd) {
    console.log('✓ both databases reachable, required tables present.');
    process.exit(0);
  } else {
    console.error('✗ one or more checks failed.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`✗ unexpected error: ${e.message}`);
  process.exit(1);
});
