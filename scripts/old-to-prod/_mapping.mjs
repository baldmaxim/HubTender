// _mapping.mjs — per-table conflict policy and primary-key configuration.
//
// Three-level conflict policy (fail-by-default, no silent DO NOTHING):
//
//   FAIL_BY_DEFAULT — default for every table. INSERT without ON CONFLICT;
//     PostgreSQL raises a unique-violation on duplicate PK. The import script
//     surfaces table + conflict-key + remediation hint.
//
//   SKIP_IF_IDENTICAL — for seed tables that PROD owns (roles, units, …).
//     Before insert, SELECT the existing row; if every column matches the
//     export, skip-and-report. If any column differs, FAIL with a diff hint.
//
//   OVERWRITE_REQUIRES_TWO_KEY_GUARD — `ON CONFLICT (pk) DO UPDATE SET …`.
//     Only when `--allow-overwrite` CLI flag AND `ALLOW_PROD_OVERWRITE=true`
//     env var are BOTH set (enforced by 06_import_prod.mjs).
//
// In --resume mode the import script switches transparently to a
// RESUME_DO_NOTHING SQL (`ON CONFLICT (pk) DO NOTHING`), but only for rows
// already marked as imported in `import_state.json`. Outside --resume,
// DO NOTHING is never used.

/** Policy constants for public-schema tables. */
export const CONFLICT_POLICY = Object.freeze({
  FAIL_BY_DEFAULT: 'FAIL_BY_DEFAULT',
  SKIP_IF_IDENTICAL: 'SKIP_IF_IDENTICAL',
  OVERWRITE_REQUIRES_TWO_KEY_GUARD: 'OVERWRITE_REQUIRES_TWO_KEY_GUARD',
  RESUME_DO_NOTHING: 'RESUME_DO_NOTHING',
});

/**
 * Auth-schema policies. Auth tables are NEVER overwritten — we never want to
 * change an `encrypted_password` after a row exists. `ALLOW_PROD_OVERWRITE`
 * does not apply here.
 *
 *   AUTH_FAIL_BY_DEFAULT          — default: INSERT without ON CONFLICT;
 *                                   any conflict (id/email/provider+provider_id)
 *                                   raises with a masked diagnostic.
 *   AUTH_RESUME_IF_IDENTICAL_ONLY — used only in --resume; for each row we
 *                                   SELECT existing → compare row fingerprint
 *                                   AND sha256(encrypted_password) — skip iff
 *                                   both match; otherwise FAIL.
 *   AUTH_BOOTSTRAP_MISSING_IDENTITY_ONLY — for auth.identities where the
 *                                   provider is allowed in
 *                                   PROD_ENABLED_AUTH_PROVIDERS and the user
 *                                   has no email-identity yet. Creates the
 *                                   identity row; never overrides existing.
 */
export const AUTH_CONFLICT_POLICY = Object.freeze({
  AUTH_FAIL_BY_DEFAULT: 'AUTH_FAIL_BY_DEFAULT',
  AUTH_RESUME_IF_IDENTICAL_ONLY: 'AUTH_RESUME_IF_IDENTICAL_ONLY',
  AUTH_BOOTSTRAP_MISSING_IDENTITY_ONLY: 'AUTH_BOOTSTRAP_MISSING_IDENTITY_ONLY',
});

/**
 * Tables whose conflict policy is SKIP_IF_IDENTICAL by default. PROD seeds
 * these from supabase/migrations/00000000000009_seed_reference_data.sql,
 * so when OLD has the same id, we expect byte-equal rows.
 */
const SKIP_IF_IDENTICAL_TABLES = new Set([
  'roles',
  'units',
  'construction_scopes',
  'tender_statuses',
  'markup_parameters',
  'cost_categories',
  'detail_cost_categories',
]);

/**
 * Per-table primary-key / unique-target overrides. Tables not listed default
 * to `(id)` as conflict target.
 */
const TABLE_CONFLICTS = {
  roles: { conflictTarget: '(code)', pkColumns: ['code'] },
  units: { conflictTarget: '(code)', pkColumns: ['code'] },
  tender_insurance: { conflictTarget: '(tender_id)', pkColumns: ['tender_id'] },
  tender_markup_percentage: { conflictTarget: '(tender_id, markup_parameter_id)', pkColumns: ['tender_id', 'markup_parameter_id'] },
  tender_pricing_distribution: { conflictTarget: '(tender_id, markup_tactic_id)', pkColumns: ['tender_id', 'markup_tactic_id'] },
  subcontract_growth_exclusions: { conflictTarget: '(tender_id, detail_cost_category_id, exclusion_type)', pkColumns: ['tender_id', 'detail_cost_category_id', 'exclusion_type'] },
  project_monthly_completion: { conflictTarget: '(project_id, year, month)', pkColumns: ['project_id', 'year', 'month'] },
  comparison_notes: { conflictTarget: '(tender_id_1, tender_id_2, cost_category_name, detail_category_key)', pkColumns: ['tender_id_1', 'tender_id_2', 'cost_category_name', 'detail_category_key'] },
  tender_documents: { conflictTarget: '(tender_id, section_type, original_filename)', pkColumns: ['tender_id', 'section_type', 'original_filename'] },
  cost_redistribution_results: { conflictTarget: '(tender_id, markup_tactic_id, boq_item_id)', pkColumns: ['tender_id', 'markup_tactic_id', 'boq_item_id'] },
  user_position_filters: { conflictTarget: '(user_id, tender_id, position_id)', pkColumns: ['user_id', 'tender_id', 'position_id'] },
  tender_groups: { conflictTarget: '(tender_id, name)', pkColumns: ['tender_id', 'name'] },
  tender_group_members: { conflictTarget: '(group_id, user_id)', pkColumns: ['group_id', 'user_id'] },
  tender_iterations: { conflictTarget: '(group_id, user_id, iteration_number)', pkColumns: ['group_id', 'user_id', 'iteration_number'] },
  tender_notes: { conflictTarget: '(tender_id, user_id)', pkColumns: ['tender_id', 'user_id'] },
};

/**
 * Return the conflict target (e.g. "(id)") and PK column list for a table.
 */
export function getConflictTarget(table) {
  const cfg = TABLE_CONFLICTS[table];
  if (cfg) return { conflictTarget: cfg.conflictTarget, pkColumns: cfg.pkColumns };
  return { conflictTarget: '(id)', pkColumns: ['id'] };
}

/**
 * Decide the conflict policy for a table given the import context.
 *
 * Precedence (highest first):
 *   1. resumeRows[table] truthy → RESUME_DO_NOTHING (for already-imported rows)
 *   2. allowOverwrite true     → OVERWRITE_REQUIRES_TWO_KEY_GUARD
 *   3. seed-table              → SKIP_IF_IDENTICAL
 *   4. otherwise               → FAIL_BY_DEFAULT
 */
export function getConflictPolicy(table, { allowOverwrite = false, resume = false } = {}) {
  if (resume) return CONFLICT_POLICY.RESUME_DO_NOTHING;
  if (allowOverwrite) return CONFLICT_POLICY.OVERWRITE_REQUIRES_TWO_KEY_GUARD;
  if (SKIP_IF_IDENTICAL_TABLES.has(table)) return CONFLICT_POLICY.SKIP_IF_IDENTICAL;
  return CONFLICT_POLICY.FAIL_BY_DEFAULT;
}

/**
 * Columns we intentionally do NOT copy from OLD even if they exist.
 *
 * - tenders.cached_grand_total — recomputed after import via
 *   public.recalculate_tender_grand_total(id).
 */
const SKIP_COLUMNS = {
  tenders: ['cached_grand_total'],
};

/**
 * For auth.users — columns we hard-set rather than copy from OLD. They belong
 * to the PROD Supabase project's instance, not OLD's.
 */
export const AUTH_USERS_OVERRIDES = {
  instance_id: '00000000-0000-0000-0000-000000000000',
  aud: 'authenticated',
};

/**
 * String token/change columns in auth.users that Supabase GoTrue scans into
 * non-pointer Go `string` fields. GoTrue's `database/sql` row scan fails with
 * `converting NULL to string is unsupported` → HTTP 500
 * "Database error querying schema" on ANY login if any of these is NULL,
 * even though the column is `is_nullable = YES` at the DB level.
 *
 * On import we coerce NULL → '' for every column in this list (see
 * 06_import_prod flushAuthUsersBuffer). Post-import drift is repaired by
 * 10_repair_prod_auth_tokens.mjs and asserted by 08_verify_auth.mjs.
 *
 * Keep this list in sync with the GoTrue schema. As of Supabase Auth 2024+
 * the relevant set is: confirmation_token, recovery_token,
 * email_change_token_new, email_change_token_current, email_change,
 * reauthentication_token, phone_change, phone_change_token.
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

/**
 * Build the SQL fragment that should be appended after the VALUES clause,
 * for a given policy. Returns null for SKIP_IF_IDENTICAL — that path doesn't
 * use a single INSERT; it does row-by-row SELECT+compare+INSERT, handled in
 * _copy.batchInsert.
 *
 * @param {string} table
 * @param {string[]} columns
 * @param {string} policy - one of CONFLICT_POLICY values
 * @returns {string|null} SQL fragment OR null when caller must use SELECT-first path
 */
export function buildConflictSql(table, columns, policy) {
  const { conflictTarget, pkColumns } = getConflictTarget(table);
  const skipSet = new Set(SKIP_COLUMNS[table] ?? []);

  switch (policy) {
    case CONFLICT_POLICY.FAIL_BY_DEFAULT:
      // No ON CONFLICT — let PG raise unique-violation.
      return '';
    case CONFLICT_POLICY.RESUME_DO_NOTHING:
      return `ON CONFLICT ${conflictTarget} DO NOTHING`;
    case CONFLICT_POLICY.SKIP_IF_IDENTICAL:
      // Handled by caller: SELECT existing, compare, then either skip or
      // INSERT with FAIL_BY_DEFAULT semantics. We never combine SKIP_IF_IDENTICAL
      // with a blanket DO NOTHING — that would mask real diffs.
      return null;
    case CONFLICT_POLICY.OVERWRITE_REQUIRES_TWO_KEY_GUARD: {
      const pkSet = new Set(pkColumns);
      const setCols = columns.filter((c) => !pkSet.has(c) && !skipSet.has(c));
      if (setCols.length === 0) {
        // Pure join table — nothing to update; treat like RESUME_DO_NOTHING.
        return `ON CONFLICT ${conflictTarget} DO NOTHING`;
      }
      const setClause = setCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
      return `ON CONFLICT ${conflictTarget} DO UPDATE SET ${setClause}`;
    }
    default:
      throw new Error(`Unknown conflict policy: ${policy}`);
  }
}

/**
 * Return the list of columns to actually insert for a table, given the full
 * column list from OLD. Drops columns in SKIP_COLUMNS.
 */
export function getInsertColumns(table, allColumns) {
  const skip = new Set(SKIP_COLUMNS[table] ?? []);
  return allColumns.filter((c) => !skip.has(c));
}

/**
 * Foreign-key references we verify after import (see 07_verify.mjs).
 * Format: [{table, column, refTable, refColumn}].
 */
export const FK_CHECKS = [
  { table: 'tenders', column: 'created_by', refTable: 'users', refColumn: 'id' },
  { table: 'tender_notes', column: 'user_id', refTable: 'users', refColumn: 'id' },
  { table: 'comparison_notes', column: 'created_by', refTable: 'users', refColumn: 'id' },
  { table: 'cost_redistribution_results', column: 'created_by', refTable: 'users', refColumn: 'id' },
  { table: 'import_sessions', column: 'user_id', refTable: 'users', refColumn: 'id' },
  { table: 'import_sessions', column: 'cancelled_by', refTable: 'users', refColumn: 'id' },
  { table: 'client_positions', column: 'tender_id', refTable: 'tenders', refColumn: 'id' },
  { table: 'boq_items', column: 'client_position_id', refTable: 'client_positions', refColumn: 'id' },
  { table: 'boq_items', column: 'tender_id', refTable: 'tenders', refColumn: 'id' },
  { table: 'tender_iterations', column: 'user_id', refTable: 'users', refColumn: 'id' },
  { table: 'tender_iterations', column: 'manager_id', refTable: 'users', refColumn: 'id' },
  { table: 'tender_iterations', column: 'group_id', refTable: 'tender_groups', refColumn: 'id' },
];

/**
 * Tables that legitimately may have pre-existing rows in PROD beyond what we
 * import from OLD. For these, `PROD count > OLD count` after import is a
 * WARNING (not FAIL). For every other table (the default), a non-zero
 * pre-existing PROD delta is treated as a hard verify failure — extra rows
 * indicate either incomplete import or polluted PROD.
 *
 * Seed/reference tables (`roles`, `units`, `cost_categories`, …) and
 * `templates`/`template_items` (where tests added rows post-baseline) are
 * the natural fit here.
 */
const ALLOW_PREEXISTING_ROWS_TABLES = new Set([
  // seed tables — PROD baseline-9 seeds these:
  'roles',
  'units',
  'construction_scopes',
  'tender_statuses',
  'markup_parameters',
  'cost_categories',
  'detail_cost_categories',
  // template-content that QA added on PROD post-baseline (see audit § 3.8.1):
  'templates',
  'template_items',
]);

/**
 * Whether a table is allowed to have rows in PROD that did not come from OLD.
 * Used by 07_verify.mjs strict extra-rows policy.
 */
export function allowsPreexistingRows(table) {
  return ALLOW_PREEXISTING_ROWS_TABLES.has(table);
}

/**
 * Business tables for which 07_verify.mjs MUST be strict: PROD count
 * exceeding OLD count is a hard failure unless the table is in
 * `ALLOW_PREEXISTING_ROWS_TABLES`. This is the explicit minimum set the
 * verifier always checks even if more tables appear in IMPORT_ORDER.
 */
export const STRICT_BUSINESS_TABLES = [
  'users',
  'tenders',
  'tender_registry',
  'client_positions',
  'boq_items',
  'boq_items_audit',
  'import_sessions',
  'notifications',
  'cost_redistribution_results',
  'tender_iterations',
  'projects',
  'project_additional_agreements',
  'project_monthly_completion',
  'tender_groups',
  'tender_group_members',
];

/**
 * Tables that 07_verify.mjs compares by md5(string_agg(row::text)) checksum.
 * Excludes auth.users — its password column is sensitive; 08_verify_auth
 * verifies passwords row-by-row via sha256 without printing the hashes.
 */
/**
 * Tables whose server-side `md5(string_agg(t::text, ',' ORDER BY pk))` checksum
 * is too expensive to compute via a Session Pooler connection — a single
 * aggregate over 100k+ wide rows can pin a pool slot for >5 minutes and is
 * the primary cause of pool saturation we hit in earlier export runs. In
 * pool-safe mode these tables are validated via:
 *   - exact row count (per snapshot or per-statement)
 *   - file-level sha256 of NDJSON
 *   - post-export duplicate-PK scan (validateNdjsonPks)
 *
 * Tables not in this set OR with row_count > 100_000 are also skipped by the
 * runtime threshold in 04_export_old.mjs (`isHeavyForChecksum`).
 */
export const HEAVY_CHECKSUM_SKIP = new Set([
  'boq_items',
  'boq_items_audit',
]);

export const CHECKSUM_TABLES = [
  'users',
  'roles',
  'tenders',
  'tender_registry',
  'client_positions',
  'boq_items',
  // 'boq_items_audit' — DELIBERATELY EXCLUDED. Server-side md5 over
  // string_agg(...::text) on 300k+ rows with two large jsonb columns
  // (old_data, new_data) routinely exceeds 10 minutes and pegs CPU on the
  // OLD instance. Integrity for this table is verified via per-row count
  // equality + file sha256 + post-export duplicate-PK scan, which is
  // sufficient for an append-only audit log. Adding the checksum back
  // would require a smarter source-side aggregation (e.g., chunked md5)
  // or running it OUTSIDE the export snapshot.
  'import_sessions',
  'notifications',
  'cost_redistribution_results',
  'tender_iterations',
  'projects',
];

/**
 * Backward-compat shim for callers that still pass `conflictClause` as a
 * string. New code should use `getConflictPolicy` + `buildConflictSql` +
 * `batchInsert({ policy, ... })`.
 *
 * @deprecated use getConflictPolicy + batchInsert({policy})
 */
export function getConflictClause(table, columns, { allowOverwrite }) {
  const policy = allowOverwrite
    ? CONFLICT_POLICY.OVERWRITE_REQUIRES_TWO_KEY_GUARD
    : CONFLICT_POLICY.FAIL_BY_DEFAULT;
  return buildConflictSql(table, columns, policy) ?? '';
}
