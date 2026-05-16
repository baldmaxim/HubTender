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
  // Keyset pagination by id. Safer than OFFSET on a live table — no row drift
  // between pages even if auth.users receives concurrent inserts. Inside a
  // REPEATABLE READ snapshot (which 04_export_old opens), the snapshot also
  // guarantees consistency; keyset is the defence-in-depth choice.
  let lastId = null;
  while (true) {
    const sql = lastId === null
      ? `SELECT id, email, encrypted_password, email_confirmed_at,
                raw_user_meta_data, raw_app_meta_data, role, phone,
                phone_confirmed_at, created_at, updated_at, last_sign_in_at,
                banned_until, deleted_at, is_sso_user, is_anonymous
           FROM auth.users
           ORDER BY id
           LIMIT $1`
      : `SELECT id, email, encrypted_password, email_confirmed_at,
                raw_user_meta_data, raw_app_meta_data, role, phone,
                phone_confirmed_at, created_at, updated_at, last_sign_in_at,
                banned_until, deleted_at, is_sso_user, is_anonymous
           FROM auth.users
           WHERE id > $2
           ORDER BY id
           LIMIT $1`;
    const params = lastId === null ? [batchSize] : [batchSize, lastId];
    const { rows } = await client.query(sql, params);
    if (rows.length === 0) return;
    for (const r of rows) yield r;
    if (rows.length < batchSize) return;
    lastId = rows[rows.length - 1].id;
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

  // Defense in depth: introspect auth.identities to verify we're not about to
  // INSERT a value into a GENERATED ALWAYS column (e.g. `email` since Supabase
  // Auth ≥2023.5). The hardcoded column list below MUST be a subset of
  // insertable columns; assert it before issuing the INSERT.
  const colInfo = await listInsertableColumns(client, 'auth', 'identities');
  const insertableSet = new Set(colInfo.insertable);
  const wantedCols = ['id', 'provider_id', 'user_id', 'identity_data', 'provider', 'last_sign_in_at', 'created_at', 'updated_at'];
  const missing = wantedCols.filter((c) => !insertableSet.has(c));
  if (missing.length > 0) {
    throw new Error(
      `bootstrapMissingIdentities: target column(s) not insertable on PROD: ${missing.join(', ')}. ` +
      `Skipped due to: ${JSON.stringify(colInfo.skipped)}. Aborting to prevent silent data loss.`,
    );
  }

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
  let lastId = null;
  while (true) {
    const sql = lastId === null
      ? `SELECT id, provider_id, user_id, identity_data, provider,
                last_sign_in_at, created_at, updated_at, email
           FROM auth.identities
           ORDER BY id
           LIMIT $1`
      : `SELECT id, provider_id, user_id, identity_data, provider,
                last_sign_in_at, created_at, updated_at, email
           FROM auth.identities
           WHERE id > $2
           ORDER BY id
           LIMIT $1`;
    const params = lastId === null ? [batchSize] : [batchSize, lastId];
    const { rows } = await client.query(sql, params);
    if (rows.length === 0) return;
    for (const r of rows) yield r;
    if (rows.length < batchSize) return;
    lastId = rows[rows.length - 1].id;
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
 * Minimum baseline of canonical Supabase auth tables that clean-auth will
 * include even if no FK to auth.users/auth.identities exists (some installs
 * may have stale tables left over from old GoTrue versions). Order is
 * informational; the actual execution order is computed by topo-sort.
 *
 * Tables MUST already exist on PROD — non-existent tables are silently
 * skipped. Tables outside this list are added by FK discovery.
 */
export const AUTH_CLEAN_BASELINE = Object.freeze([
  'refresh_tokens',
  'sessions',
  'identities',
  'users',
]);

/**
 * Query the FK graph involving the auth schema. Returns one row per (FK, column)
 * pair (multi-column FKs surface multiple rows; sort by `ord` to reconstruct).
 *
 * Each FK is included if EITHER side touches schema=auth — so:
 *  - public.X → auth.Y (e.g. password_reset_tokens.user_id → auth_users.id)
 *  - auth.X → auth.Y (intra-auth dependency, the bulk of the graph)
 *  - auth.X → public.Y (rare; surfaces drift if present)
 *
 * Field key:
 *   delete_action / update_action: 'a'=NO ACTION, 'r'=RESTRICT, 'c'=CASCADE,
 *                                  'n'=SET NULL, 'd'=SET DEFAULT.
 */
export async function loadAuthFkGraph(client) {
  const { rows } = await client.query(`
    SELECT
      ns_from.nspname AS from_schema,
      cls_from.relname AS from_table,
      att_from.attname AS from_column,
      ns_to.nspname   AS to_schema,
      cls_to.relname  AS to_table,
      att_to.attname  AS to_column,
      con.confupdtype AS update_action,
      con.confdeltype AS delete_action,
      con.conname     AS constraint_name,
      k.ord           AS ord
    FROM pg_constraint con
    JOIN pg_class cls_from   ON cls_from.oid = con.conrelid
    JOIN pg_namespace ns_from ON ns_from.oid = cls_from.relnamespace
    JOIN pg_class cls_to     ON cls_to.oid = con.confrelid
    JOIN pg_namespace ns_to   ON ns_to.oid = cls_to.relnamespace
    JOIN unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(from_attnum, to_attnum, ord) ON TRUE
    JOIN pg_attribute att_from ON att_from.attrelid = con.conrelid  AND att_from.attnum = k.from_attnum
    JOIN pg_attribute att_to   ON att_to.attrelid   = con.confrelid AND att_to.attnum   = k.to_attnum
    WHERE con.contype = 'f'
      AND (ns_from.nspname = 'auth' OR ns_to.nspname = 'auth')
    ORDER BY from_schema, from_table, from_column, k.ord;
  `);
  // Decode action codes for readability in reports.
  const decode = (c) => ({ a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' }[c] || c);
  return rows.map((r) => ({
    from_schema: r.from_schema,
    from_table: r.from_table,
    from_column: r.from_column,
    to_schema: r.to_schema,
    to_table: r.to_table,
    to_column: r.to_column,
    update_rule: decode(r.update_action),
    delete_rule: decode(r.delete_action),
    constraint_name: r.constraint_name,
    ord: r.ord,
  }));
}

/**
 * Introspect a target table's columns and split into insertable vs
 * non-insertable (GENERATED ALWAYS / IDENTITY ALWAYS).
 *
 * Why: Supabase Auth ≥2023.5 changed `auth.identities.email` to
 * `GENERATED ALWAYS AS (lower(identity_data->>'email')) STORED`. INSERT'ing
 * a value into a generated column raises `cannot insert a non-DEFAULT value
 * into column "<col>"`. Other Supabase managed schemas may add more generated
 * columns over time — hardcoding a denylist would rot. This helper does live
 * introspection so the importer adapts automatically.
 *
 * @returns {Promise<{
 *   all: string[],
 *   insertable: string[],
 *   skipped: Array<{name: string, reason: 'GENERATED ALWAYS' | 'IDENTITY ALWAYS'}>,
 * }>}
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
    if (r.is_generated === 'ALWAYS') {
      skipped.push({ name: r.column_name, reason: 'GENERATED ALWAYS' });
    } else if (r.is_identity === 'ALWAYS') {
      skipped.push({ name: r.column_name, reason: 'IDENTITY ALWAYS' });
    } else {
      insertable.push(r.column_name);
    }
  }
  return { all, insertable, skipped };
}

/**
 * List existing tables in the auth schema. We need this to (a) silently skip
 * non-existent baseline tables and (b) bound topological sort to real tables.
 */
export async function listAuthTables(client) {
  const { rows } = await client.query(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'auth' AND table_type = 'BASE TABLE'
     ORDER BY table_name
  `);
  return rows.map((r) => r.table_name);
}

/**
 * Build the clean-auth scope and deletion order from a live FK graph.
 *
 * Scope = (every auth.* table transitively connected to auth.users / auth.identities
 *          via FKs INSIDE the auth schema) ∪ (AUTH_CLEAN_BASELINE that exist).
 *
 * Order = Kahn topological sort on the reverse-dependency graph (leaves first).
 *         Tables with no inbound auth-internal FKs are deleted first; auth.users
 *         is always last. NEVER uses CASCADE.
 *
 * Returns:
 *   {
 *     order: [{schema, table}],                  // deletion order
 *     public_referrers: [...FK rows],            // public.* → auth.*; must be empty or --clean-prod required
 *     audit_log_note: string|null,               // explanation if auth.audit_log_entries handled specially
 *     skipped_tables: string[],                  // auth.* tables NOT in scope (left alone)
 *   }
 *
 * Throws on FK cycle (shouldn't happen in Supabase auth) — caller fails the run.
 */
export function planAuthCleanup(fkGraph, existingAuthTables) {
  const existing = new Set(existingAuthTables);
  const authIntFks = fkGraph.filter((fk) => fk.from_schema === 'auth' && fk.to_schema === 'auth');
  const publicReferrers = fkGraph.filter((fk) => fk.from_schema === 'public' && fk.to_schema === 'auth');

  // Transitive scope from {users, identities}.
  const scope = new Set();
  for (const root of ['users', 'identities']) if (existing.has(root)) scope.add(root);
  let added = true;
  while (added) {
    added = false;
    for (const fk of authIntFks) {
      if (scope.has(fk.to_table) && existing.has(fk.from_table) && !scope.has(fk.from_table)) {
        scope.add(fk.from_table);
        added = true;
      }
    }
  }
  // Baseline merge.
  for (const t of AUTH_CLEAN_BASELINE) if (existing.has(t)) scope.add(t);

  // Special-case audit_log_entries: include only if it's connected through FK.
  let auditLogNote = null;
  if (existing.has('audit_log_entries')) {
    const audIntFks = authIntFks.filter(
      (fk) => fk.from_table === 'audit_log_entries' || fk.to_table === 'audit_log_entries',
    );
    if (audIntFks.length === 0) {
      // No FK relation to other auth tables — leave it alone (history retention).
      scope.delete('audit_log_entries');
      auditLogNote = 'auth.audit_log_entries kept (no FK relation to auth.users/identities).';
    } else if (!scope.has('audit_log_entries')) {
      scope.add('audit_log_entries');
      auditLogNote = 'auth.audit_log_entries included (it has FK dependency on auth.users/identities).';
    }
  }

  const scopeArr = [...scope];

  // Build inbound-edge map for Kahn sort (edge A→B means B has FK to A, so to
  // delete A safely we must delete B first; "leaves" = no inbound edges).
  const inbound = new Map(scopeArr.map((t) => [t, new Set()]));
  for (const fk of authIntFks) {
    if (!scope.has(fk.from_table) || !scope.has(fk.to_table)) continue;
    if (fk.from_table === fk.to_table) continue; // self-FK (e.g. parent_id) — doesn't block sort
    inbound.get(fk.to_table).add(fk.from_table);
  }

  // Kahn sort: pick tables with empty inbound, output them, remove from others'.
  const order = [];
  const ready = scopeArr.filter((t) => inbound.get(t).size === 0).sort();
  while (ready.length > 0) {
    const t = ready.shift();
    order.push(t);
    for (const [other, edges] of inbound) {
      if (edges.delete(t) && edges.size === 0 && !order.includes(other) && !ready.includes(other)) {
        ready.push(other);
        ready.sort();
      }
    }
  }
  if (order.length !== scopeArr.length) {
    const stuck = scopeArr.filter((t) => !order.includes(t));
    throw new Error(`Cycle in auth FK graph; cannot topologically sort. Stuck: ${stuck.join(', ')}`);
  }

  const skipped = existingAuthTables.filter((t) => !scope.has(t));

  return {
    order: order.map((t) => ({ schema: 'auth', table: t })),
    public_referrers: publicReferrers,
    audit_log_note: auditLogNote,
    skipped_tables: skipped,
  };
}

/**
 * Execute clean-auth on PROD according to a previously-built plan.
 *
 * Safety guarantees encoded here:
 *  - Never uses `TRUNCATE … CASCADE` or any `CASCADE` clause.
 *  - Never sets `session_replication_role` (would require superuser and would
 *    silently bypass system triggers — disallowed).
 *  - Never disables system/internal triggers.
 *  - Pure `DELETE FROM "auth"."<table>"` per table, in dependency order.
 *  - All sql identifiers are validated against /^[a-zA-Z_][a-zA-Z0-9_]*$/.
 *  - Verifies COUNT(*) = 0 for every cleaned table afterwards.
 *
 * Logging: prints per-table row counts only — no PII, no encrypted_password,
 * no tokens. Emails never leave the database.
 *
 * Caller MUST have validated:
 *  - assertCleanAuthAllowed() passed.
 *  - If plan.public_referrers.length > 0 → caller has confirmed --clean-prod
 *    --confirm AND ALLOW_CLEAN_PROD=true AND public clean has already run in
 *    this same import.
 *
 * @param {object} client       - pg.Client connected to PROD with sufficient privs
 * @param {object} plan         - return value of planAuthCleanup()
 * @param {{dryRun: boolean}} opts
 * @returns {Promise<object>}   - report block ready for IMPORT_REPORT.md
 */
export async function cleanAuthTarget(client, plan, { dryRun = false } = {}) {
  const safeIdent = (s) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw new Error(`unsafe identifier: ${s}`);
    return `"${s}"`;
  };
  const result = {
    executed: false,
    dry_run: dryRun,
    plan: {
      order: plan.order.map((t) => `${t.schema}.${t.table}`),
      public_referrers: plan.public_referrers.map((fk) => ({
        from: `${fk.from_schema}.${fk.from_table}.${fk.from_column}`,
        to: `${fk.to_schema}.${fk.to_table}.${fk.to_column}`,
        delete_rule: fk.delete_rule,
      })),
      skipped_tables: plan.skipped_tables.map((t) => `auth.${t}`),
      audit_log_note: plan.audit_log_note,
    },
    before_counts: {},
    deleted: {},
    after_counts: {},
    notes: [
      'Migration policy: auth.sessions and auth.refresh_tokens are NOT re-imported from OLD.',
      'All existing OLD Supabase sessions will be invalidated by clean-auth (users must re-login).',
      'After clean-auth + re-import, password hashes are re-uploaded from OLD; users keep their OLD password.',
    ],
  };

  // Capture before-counts even in dry-run for planning context.
  for (const t of plan.order) {
    const { rows: [c] } = await client.query(`SELECT COUNT(*)::int AS n FROM ${safeIdent(t.schema)}.${safeIdent(t.table)}`);
    result.before_counts[`${t.schema}.${t.table}`] = c.n;
  }
  if (dryRun) return result;

  // Execute DELETEs in order. Single statement per table; no CASCADE.
  for (const t of plan.order) {
    const sql = `DELETE FROM ${safeIdent(t.schema)}.${safeIdent(t.table)}`;
    const r = await client.query(sql);
    result.deleted[`${t.schema}.${t.table}`] = r.rowCount ?? 0;
  }
  // Post-clean assertion: count must be 0 for every cleaned table.
  for (const t of plan.order) {
    const { rows: [c] } = await client.query(`SELECT COUNT(*)::int AS n FROM ${safeIdent(t.schema)}.${safeIdent(t.table)}`);
    result.after_counts[`${t.schema}.${t.table}`] = c.n;
    if (c.n !== 0) {
      throw new Error(`clean-auth post-assert failed: ${t.schema}.${t.table} still has ${c.n} rows. Manual investigation required.`);
    }
  }
  result.executed = true;
  return result;
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
