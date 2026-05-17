// _auth.mjs — auth.users / auth.identities export · import · verify for the
// PROD Supabase → Yandex migration. Ported from scripts/old-to-prod/_auth.mjs
// and adapted to the applied Yandex auth-compat schema
// (db/yandex/sql/01_auth_compat_or_app_auth.sql).
//
// SECURITY:
//  - encrypted_password is preserved BYTE-FOR-BYTE: never rehashed, never
//    logged, never leaves a function boundary as a logged string.
//  - emails are logged only via redactEmail().
//
// Yandex auth.users column set (matches the applied bridge table):
//   id, email, encrypted_password, email_confirmed_at, phone,
//   phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, role, aud,
//   last_sign_in_at, banned_until, deleted_at, is_sso_user, is_anonymous,
//   confirmation_token, recovery_token, email_change_token_new,
//   email_change_token_current, email_change, reauthentication_token,
//   phone_change, phone_change_token, created_at, updated_at
//
//   NOTE: the Yandex bridge has NO `instance_id` column (unlike Supabase
//   GoTrue). We therefore DO NOT project/insert instance_id. `aud` IS a plain
//   column on the bridge and is preserved as exported from PROD.
//
// Yandex auth.identities column set:
//   id, provider_id, user_id, identity_data, provider, last_sign_in_at,
//   created_at, updated_at  (email is GENERATED ALWAYS — never inserted).

import { redactEmail } from './_lib.mjs';

/** Columns projected out of PROD Supabase auth.users for the migration. */
export const AUTH_USERS_PROJECTION = [
  'id', 'email', 'encrypted_password', 'email_confirmed_at',
  'phone', 'phone_confirmed_at',
  'raw_app_meta_data', 'raw_user_meta_data', 'role', 'aud',
  'last_sign_in_at', 'banned_until', 'deleted_at',
  'is_sso_user', 'is_anonymous',
  // GoTrue NOT-NULL token/change string columns (PROD repaired NULL -> '').
  'confirmation_token', 'recovery_token',
  'email_change_token_new', 'email_change_token_current', 'email_change',
  'reauthentication_token', 'phone_change', 'phone_change_token',
  'created_at', 'updated_at',
];

/**
 * Token/change columns the Yandex bridge does NOT mark NOT NULL, but the Go
 * app-auth path (and any future GoTrue parity) expects as non-NULL strings.
 * On import we coerce NULL → '' for every column in this list. This mirrors
 * scripts/old-to-prod/_mapping.mjs AUTH_USERS_NOT_NULL_TOKENS and the bridge
 * DEFAULT '' (db/yandex/sql/01_auth_compat_or_app_auth.sql).
 */
export const AUTH_USERS_NOT_NULL_TOKENS = [
  'confirmation_token',
  'recovery_token',
  'email_change_token_new',
  'email_change_token_current',
  'email_change',
  'reauthentication_token',
  'phone_change',
  'phone_change_token',
];

/** Columns projected out of PROD Supabase auth.identities (email is GENERATED). */
export const AUTH_IDENTITIES_PROJECTION = [
  'id', 'provider_id', 'user_id', 'identity_data', 'provider',
  'last_sign_in_at', 'created_at', 'updated_at',
];

/**
 * Stream PROD auth.users for export, projecting only migrated columns. Keyset
 * pagination by id (safe on a live table; defence in depth inside a snapshot).
 */
export async function* loadAuthUsersForExport(client, { batchSize = 500 } = {}) {
  const cols = AUTH_USERS_PROJECTION.map((c) => `"${c}"`).join(', ');
  let lastId = null;
  while (true) {
    const sql = lastId === null
      ? `SELECT ${cols} FROM auth.users ORDER BY id LIMIT $1`
      : `SELECT ${cols} FROM auth.users WHERE id > $2 ORDER BY id LIMIT $1`;
    const params = lastId === null ? [batchSize] : [batchSize, lastId];
    const { rows } = await client.query(sql, params);
    if (rows.length === 0) return;
    for (const r of rows) yield r;
    if (rows.length < batchSize) return;
    lastId = rows[rows.length - 1].id;
  }
}

/**
 * Stream PROD auth.identities for export. `email` is intentionally NOT
 * projected — it is GENERATED ALWAYS on the Yandex target.
 */
export async function* loadIdentitiesForExport(client, { batchSize = 500 } = {}) {
  const cols = AUTH_IDENTITIES_PROJECTION.map((c) => `"${c}"`).join(', ');
  let lastId = null;
  while (true) {
    const sql = lastId === null
      ? `SELECT ${cols} FROM auth.identities ORDER BY id LIMIT $1`
      : `SELECT ${cols} FROM auth.identities WHERE id > $2 ORDER BY id LIMIT $1`;
    const params = lastId === null ? [batchSize] : [batchSize, lastId];
    const { rows } = await client.query(sql, params);
    if (rows.length === 0) return;
    for (const r of rows) yield r;
    if (rows.length < batchSize) return;
    lastId = rows[rows.length - 1].id;
  }
}

/**
 * Aggregate auth statistics for a PROD/Yandex snapshot. Counts only — no email
 * addresses or password hashes leak. `auth.identities` is optional.
 */
export async function collectAuthStats(client) {
  const out = {
    auth_users_count: 0,
    public_users_count: 0,
    users_with_encrypted_password: 0,
    users_without_encrypted_password: 0,
    oauth_only_users_count: 0,
    email_confirmed_at_null_count: 0,
    orphan_auth_users: 0,
    orphan_public_users: 0,
    duplicate_emails_in_auth: [],
    auth_identities_count: 0,
    providers: [],
  };

  const { rows: [au] } = await client.query(`
    SELECT COUNT(*)::int AS auth_users,
           COUNT(*) FILTER (WHERE encrypted_password IS NOT NULL)::int AS with_password,
           COUNT(*) FILTER (WHERE encrypted_password IS NULL)::int AS without_password,
           COUNT(*) FILTER (WHERE email_confirmed_at IS NULL)::int AS conf_null
      FROM auth.users
  `);
  out.auth_users_count = au.auth_users;
  out.users_with_encrypted_password = au.with_password;
  out.users_without_encrypted_password = au.without_password;
  out.oauth_only_users_count = au.without_password;
  out.email_confirmed_at_null_count = au.conf_null;

  const { rows: [pu] } = await client.query('SELECT COUNT(*)::int AS n FROM public.users');
  out.public_users_count = pu.n;

  const { rows: [oa] } = await client.query(`
    SELECT COUNT(*)::int AS n FROM auth.users au
    LEFT JOIN public.users pu ON pu.id = au.id WHERE pu.id IS NULL
  `);
  out.orphan_auth_users = oa.n;

  const { rows: [op] } = await client.query(`
    SELECT COUNT(*)::int AS n FROM public.users pu
    LEFT JOIN auth.users au ON au.id = pu.id WHERE au.id IS NULL
  `);
  out.orphan_public_users = op.n;

  const { rows: dup } = await client.query(`
    SELECT email FROM auth.users
     WHERE email IS NOT NULL
     GROUP BY email HAVING COUNT(*) > 1 ORDER BY email LIMIT 100
  `);
  out.duplicate_emails_in_auth = dup.map((r) => redactEmail(r.email));

  // auth.identities is an optional bridge — tolerate absence.
  try {
    const { rows: [id] } = await client.query('SELECT COUNT(*)::int AS n FROM auth.identities');
    out.auth_identities_count = id.n;
    const { rows: pr } = await client.query(
      'SELECT provider, COUNT(*)::int AS n FROM auth.identities GROUP BY provider ORDER BY provider',
    );
    out.providers = pr;
  } catch {
    out.auth_identities_count = 0;
    out.providers = [];
  }
  return out;
}

/**
 * Introspect a target table's columns; split insertable vs non-insertable
 * (GENERATED ALWAYS / IDENTITY ALWAYS). Used so the importer never tries to
 * INSERT into auth.identities.email (GENERATED ALWAYS on the Yandex bridge).
 */
export async function listInsertableColumns(client, schema, table) {
  const { rows } = await client.query(
    `SELECT column_name, is_generated, is_identity
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
    [schema, table],
  );
  const skipped = [];
  const insertable = [];
  const all = [];
  for (const r of rows) {
    all.push(r.column_name);
    if (r.is_generated === 'ALWAYS') skipped.push({ name: r.column_name, reason: 'GENERATED ALWAYS' });
    else if (r.is_identity === 'ALWAYS') skipped.push({ name: r.column_name, reason: 'IDENTITY ALWAYS' });
    else insertable.push(r.column_name);
  }
  return { all, insertable, skipped };
}

/** List existing base tables in the auth schema on the target. */
export async function listAuthTables(client) {
  const { rows } = await client.query(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'auth' AND table_type = 'BASE TABLE'
     ORDER BY table_name
  `);
  return rows.map((r) => r.table_name);
}
