// _auth.mjs — Auth-specific helpers for OLD → PROD migration.
//
// Security:
//  - Email addresses are logged only via redactEmail() from _lib.mjs.
//  - encrypted_password, access_token, refresh_token NEVER leave a function
//    boundary as a logged string.
//  - smokeLogin() returns the raw response object to its caller; the caller
//    is responsible for not logging .access_token.

import { redactEmail } from './_lib.mjs';

/**
 * Stream OLD auth.users in batches, projecting only the columns we actually
 * migrate. Keeps memory bounded for large dumps.
 */
export async function* loadAuthUsersForExport(client, { batchSize = 500 } = {}) {
  let offset = 0;
  while (true) {
    const { rows } = await client.query(
      `SELECT id, email, encrypted_password, email_confirmed_at,
              raw_user_meta_data, raw_app_meta_data, role, phone,
              phone_confirmed_at, created_at, updated_at, last_sign_in_at,
              banned_until, deleted_at, is_sso_user, is_anonymous
         FROM auth.users
         ORDER BY id
         LIMIT $1 OFFSET $2`,
      [batchSize, offset]
    );
    if (rows.length === 0) return;
    for (const r of rows) yield r;
    if (rows.length < batchSize) return;
    offset += batchSize;
  }
}

/**
 * AUTH_BOOTSTRAP_MISSING_IDENTITY_ONLY policy.
 *
 * For OLD users without an email-identity row (legacy GoTrue artefact),
 * bootstrap one in PROD. Gated on:
 *   - email-provider is in `enabledProviders` (from PROD_ENABLED_AUTH_PROVIDERS)
 *   - user has no email-identity yet (NOT EXISTS guard inside SQL)
 *
 * The function returns {created, candidates, skipped_provider_not_enabled,
 * created_user_ids} — `created_user_ids` is a list of UUIDs (no emails) for
 * IMPORT_REPORT.md provenance. ON CONFLICT (provider, provider_id) DO NOTHING
 * guards against the rare case where two rows happen to collide on the
 * (provider, provider_id) compound unique — but if they collide the row was
 * not created and we count it as skipped.
 *
 * Requires PROD service-role connection (writes to auth.*).
 *
 * @param {object} client - pg.Client to PROD
 * @param {{enabledProviders?: Set<string>}} opts
 */
export async function bootstrapMissingIdentities(client, { enabledProviders } = {}) {
  const allowed = enabledProviders ?? new Set(['email']);
  if (!allowed.has('email')) {
    // Cannot bootstrap email identities if PROD doesn't enable the email
    // provider. Return zero — caller should surface this in IMPORT_REPORT.md.
    return {
      created: 0,
      candidates: null,
      skipped_provider_not_enabled: true,
      created_user_ids: [],
    };
  }

  // Count candidates first so we can report skipped-due-to-conflict
  // (candidates - created).
  const { rows: [c] } = await client.query(`
    SELECT COUNT(*)::int AS n FROM auth.users u
     WHERE u.email IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM auth.identities i
          WHERE i.user_id = u.id AND i.provider = 'email'
       )
  `);
  const candidates = c.n;

  const { rows: created } = await client.query(`
    INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    SELECT
      gen_random_uuid(),
      u.email,
      u.id,
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', u.email_confirmed_at IS NOT NULL),
      'email',
      u.last_sign_in_at,
      u.created_at,
      now()
    FROM auth.users u
    WHERE u.email IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email'
      )
    ON CONFLICT (provider, provider_id) DO NOTHING
    RETURNING user_id
  `);
  return {
    created: created.length,
    candidates,
    skipped_provider_not_enabled: false,
    created_user_ids: created.map((r) => r.user_id),
  };
}

/**
 * Stream OLD auth.identities for export. Skips internal columns we don't need.
 */
export async function* loadIdentitiesForExport(client, { batchSize = 500 } = {}) {
  let offset = 0;
  while (true) {
    const { rows } = await client.query(
      `SELECT id, provider_id, user_id, identity_data, provider,
              last_sign_in_at, created_at, updated_at, email
         FROM auth.identities
         ORDER BY id
         LIMIT $1 OFFSET $2`,
      [batchSize, offset]
    );
    if (rows.length === 0) return;
    for (const r of rows) yield r;
    if (rows.length < batchSize) return;
    offset += batchSize;
  }
}

/**
 * Aggregate auth statistics for an OLD/PROD snapshot. Returns counts only —
 * no email addresses or password hashes leak through this function.
 */
export async function collectAuthStats(client) {
  const [{ rows: [authU] }, { rows: [pubU] }, { rows: [orphAuth] }, { rows: [orphPub] }, { rows: dupEmails }, { rows: [ident] }, { rows: providers }] = await Promise.all([
    client.query(`
      SELECT COUNT(*)::int AS auth_users,
             COUNT(*) FILTER (WHERE encrypted_password IS NOT NULL)::int AS with_password,
             COUNT(*) FILTER (WHERE encrypted_password IS NULL)::int AS without_password,
             COUNT(*) FILTER (WHERE email_confirmed_at IS NULL)::int AS conf_null
        FROM auth.users
    `),
    client.query(`SELECT COUNT(*)::int AS public_users FROM public.users`),
    client.query(`
      SELECT COUNT(*)::int AS n
        FROM auth.users au
        LEFT JOIN public.users pu ON pu.id = au.id
       WHERE pu.id IS NULL
    `),
    client.query(`
      SELECT COUNT(*)::int AS n
        FROM public.users pu
        LEFT JOIN auth.users au ON au.id = pu.id
       WHERE au.id IS NULL
    `),
    client.query(`
      SELECT email FROM auth.users
       WHERE email IS NOT NULL
       GROUP BY email HAVING COUNT(*) > 1
       ORDER BY email
       LIMIT 100
    `),
    client.query(`SELECT COUNT(*)::int AS identities FROM auth.identities`),
    client.query(`SELECT provider, COUNT(*)::int AS n FROM auth.identities GROUP BY provider ORDER BY provider`),
  ]);

  return {
    auth_users_count: authU.auth_users,
    public_users_count: pubU.public_users,
    users_with_encrypted_password: authU.with_password,
    users_without_encrypted_password: authU.without_password,
    oauth_only_users_count: authU.without_password,
    email_confirmed_at_null_count: authU.conf_null,
    orphan_auth_users: orphAuth.n,
    orphan_public_users: orphPub.n,
    duplicate_emails_in_auth: dupEmails.map((r) => redactEmail(r.email)),
    auth_identities_count: ident.identities,
    providers: providers,
  };
}

/**
 * Compare emails between OLD and PROD public.users to detect duplicates that
 * would block UNIQUE (email) on import. Returns masked email list.
 */
export async function detectPublicUserEmailDuplicates(client) {
  const { rows } = await client.query(`
    SELECT email FROM public.users
     WHERE email IS NOT NULL
     GROUP BY email HAVING COUNT(*) > 1
     ORDER BY email
     LIMIT 100
  `);
  return rows.map((r) => redactEmail(r.email));
}

/**
 * Parse PROD_ENABLED_AUTH_PROVIDERS env (comma-separated) into a Set.
 * Always includes 'email' as a baseline.
 */
export function getEnabledProviders(envCsv) {
  const list = (envCsv || 'email')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(list);
}

/**
 * Returns provider names present in OLD auth.identities that are NOT in
 * PROD_ENABLED_AUTH_PROVIDERS. An empty array means PROD can authenticate
 * every OLD identity.
 *
 * @param {object} oldAuthStats - shape from auth_stats.json
 * @param {Set<string>} enabled - from getEnabledProviders()
 */
export function validateProvidersAgainstOld(oldAuthStats, enabled) {
  const oldProviders = (oldAuthStats.providers ?? []).map((p) => p.provider.toLowerCase());
  return oldProviders.filter((p) => !enabled.has(p));
}

/**
 * Smoke-login against Supabase Auth REST endpoint. Returns the parsed body on
 * success; throws on failure. The caller is responsible for NOT logging
 * `result.access_token` or `result.refresh_token`.
 *
 * @param {{url, anonKey, email, password}} opts
 * @returns {Promise<{access_token, refresh_token, user, ...}>}
 */
export async function smokeLogin({ url, anonKey, email, password }) {
  if (!url || !anonKey) throw new Error('smokeLogin: url and anonKey are required');
  if (!email || !password) throw new Error('smokeLogin: email and password are required');

  const endpoint = `${url.replace(/\/$/, '')}/auth/v1/token?grant_type=password`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Strip any token-looking strings from error message before throwing.
    const safe = text.replace(/eyJ[A-Za-z0-9._-]+/g, '<redacted-token>');
    throw new Error(`smokeLogin failed: HTTP ${res.status} ${safe.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Call Go BFF /api/v1/me with a bearer token. Returns parsed body; throws on
 * non-2xx. Token is passed in Authorization header only, never logged.
 */
export async function callGoBffMe({ baseUrl, accessToken }) {
  if (!baseUrl) throw new Error('callGoBffMe: baseUrl is required');
  if (!accessToken) throw new Error('callGoBffMe: accessToken is required');

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/me`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Go BFF /api/v1/me failed: HTTP ${res.status}`);
  }
  return res.json();
}
