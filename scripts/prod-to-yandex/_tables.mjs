// _tables.mjs — single source of truth for PROD Supabase → Yandex import order.
//
// Order is FK-topological: auth.users → auth.identities (handled by the auth
// phase before this list) → reference tables → public.users → business tables
// → audit / history tables. Parents always precede children.
//
// Derived from the applied Yandex schema (db/yandex/sql/03_tables.sql columns +
// db/yandex/sql/06_indexes_constraints.sql FK graph). All 40 public tables.
// Ported from scripts/old-to-prod/_tables.mjs and adapted to the 40-table list.

export const IMPORT_ORDER = [
  // ---- reference / independent tables (no FK to other public tables) ----
  'roles',
  'units',
  'construction_scopes',
  'tender_statuses',
  'markup_parameters',
  'library_folders',
  'notifications',

  // ---- public.users (FK target for many tables; needs auth.users first) ----
  'users',

  // ---- nomenclatures + cost taxonomy ----
  'cost_categories',
  'material_names',
  'work_names',
  'detail_cost_categories',
  'markup_tactics',
  'materials_library',
  'works_library',

  // ---- tenders (parent of most business tables) ----
  // CRITICAL: 04_import_yandex MUST disable any tender_registry
  // auto-create trigger before importing tenders (if present in the applied
  // Yandex schema). The applied foundation does NOT port
  // auto_create_tender_registry (see db/yandex/sql/05_triggers.sql), so this
  // is defensive; ALLOW_DISABLE_IMPORT_TRIGGERS gates it when found.
  'tender_registry',
  'tenders',

  // ---- per-tender data (FK on tenders) ----
  'client_positions',
  'import_sessions',
  'templates',
  'construction_cost_volumes',
  'tender_insurance',
  'tender_markup_percentage',
  'tender_notes',
  'tender_pricing_distribution',
  'tender_documents',
  'subcontract_growth_exclusions',
  'user_tasks',

  // ---- BOQ (FK on client_positions / tenders) ----
  // CRITICAL: 04_import_yandex MUST disable trg_boq_items_audit before
  // importing boq_items if it exists on the target — log_boq_items_changes()
  // does an unconditional INSERT into boq_items_audit per row touched, which
  // would inflate the audit table beyond what boq_items_audit.ndjson holds.
  // ALLOW_DISABLE_IMPORT_TRIGGERS=true is required whenever boq_items is in
  // IMPORT_ORDER and the trigger exists on the Yandex target.
  'boq_items',
  'boq_items_audit',
  'template_items',
  'user_position_filters',
  'comparison_notes',
  'cost_redistribution_results',

  // ---- projects (loose FK on tenders) ----
  'projects',
  'project_additional_agreements',
  'project_monthly_completion',

  // ---- tender timeline (FK on tenders + users) ----
  'tender_groups',
  'tender_group_members',
  'tender_iterations',
];

/**
 * Auth-schema import order (handled by the auth phase BEFORE IMPORT_ORDER).
 * auth.users must precede auth.identities (FK identities.user_id → users.id).
 */
export const AUTH_IMPORT_ORDER = ['users', 'identities'];

/**
 * Triggers on the target that MUST be temporarily disabled during import of
 * the corresponding parent table to avoid duplicate / redundant side-effects.
 *
 * Keys are public-schema table names; values are arrays of candidate user
 * trigger names. Disable is best-effort + introspected at runtime: only
 * triggers that actually EXIST on the Yandex target are disabled, and only if
 * ALLOW_DISABLE_IMPORT_TRIGGERS=true. NEVER session_replication_role, NEVER
 * system/internal triggers; re-enabled in finally.
 *
 * The applied Yandex foundation ports the boq_items audit trigger
 * (trg_boq_items_audit) and handle_updated_at triggers but NOT
 * auto_create_tender_registry. We keep the tenders entry defensively.
 */
export const REQUIRES_TRIGGER_DISABLE = {
  tenders: ['trigger_auto_create_tender_registry', 'trg_auto_create_tender_registry'],
  boq_items: ['trg_boq_items_audit'],
};

/**
 * pg_notify triggers — emit `rowchange` websocket events. We do NOT permanently
 * remove them; the broker has no subscribers during the cutover window. They
 * MAY be disabled DURING the bulk import only when ALLOW_DISABLE_IMPORT_TRIGGERS
 * is set, to suppress notify noise. They stay in the final schema either way.
 */
export const NOTIFY_TRIGGERS_BY_TABLE = Object.freeze({
  tenders: ['trg_notify_row_change_tenders'],
  notifications: ['trg_notify_row_change_notifications'],
  boq_items: ['trg_notify_row_change_boq_items'],
  client_positions: ['trg_notify_row_change_client_positions'],
  cost_redistribution_results: ['trg_notify_row_change_cost_redistribution_results'],
  construction_cost_volumes: ['trg_notify_row_change_construction_cost_volumes'],
});

/**
 * Tables with a self-referencing FK (a column → same table's id). During
 * NDJSON import, children may precede parents in file order → FK violation
 * once constraints are present. Buffer + topo-sort (roots first) before INSERT.
 *
 * From db/yandex/sql/06_indexes_constraints.sql:
 *   - client_positions.parent_position_id → client_positions.id
 *   - boq_items.parent_work_item_id → boq_items.id
 *   - library_folders.parent_id → library_folders.id
 *   - template_items.parent_work_item_id → template_items.id
 *   - users.approved_by → users.id
 */
export const SELF_FK_TABLES = Object.freeze({
  boq_items:        { idCol: 'id', parentCol: 'parent_work_item_id' },
  client_positions: { idCol: 'id', parentCol: 'parent_position_id'  },
  library_folders:  { idCol: 'id', parentCol: 'parent_id'           },
  template_items:   { idCol: 'id', parentCol: 'parent_work_item_id' },
  users:            { idCol: 'id', parentCol: 'approved_by'         },
});

/**
 * Per-table primary-key / unique-target overrides for conflict detection and
 * SELECT-by-PK comparisons. Tables not listed default to (id).
 * Mirrors db/yandex/sql/06_indexes_constraints.sql PK + UNIQUE.
 */
const TABLE_PK = {
  roles: ['code'],
  units: ['code'],
  tender_insurance: ['tender_id'],
  tender_markup_percentage: ['tender_id', 'markup_parameter_id'],
  tender_pricing_distribution: ['tender_id', 'markup_tactic_id'],
  subcontract_growth_exclusions: ['tender_id', 'detail_cost_category_id', 'exclusion_type'],
  project_monthly_completion: ['project_id', 'year', 'month'],
  comparison_notes: ['tender_id_1', 'tender_id_2', 'cost_category_name', 'detail_category_key'],
  tender_documents: ['tender_id', 'section_type', 'original_filename'],
  cost_redistribution_results: ['tender_id', 'markup_tactic_id', 'boq_item_id'],
  user_position_filters: ['user_id', 'tender_id', 'position_id'],
  tender_groups: ['tender_id', 'name'],
  tender_group_members: ['group_id', 'user_id'],
  tender_iterations: ['group_id', 'user_id', 'iteration_number'],
  tender_notes: ['tender_id', 'user_id'],
};

/** Return PK column list for a table (defaults to ['id']). */
export function pkColumnsFor(table) {
  return TABLE_PK[table] ?? ['id'];
}

/** Best stable ordering column for tables without an `id` PK. */
export function defaultOrderBy(table) {
  switch (table) {
    case 'roles':
    case 'units':
      return 'code';
    default:
      return 'id';
  }
}

/**
 * Heavy tables whose server-side md5(string_agg(t::text ORDER BY pk)) over the
 * whole table is too expensive on the Supabase pooler — they use the chunked
 * deterministic fold instead (raw-type-safe, identical PROD↔Yandex).
 */
export const HEAVY_CHECKSUM_TABLES = new Set([
  'boq_items',
  'boq_items_audit',
  'client_positions',
]);

/**
 * Tables that 05_verify_yandex MUST explicitly verify (counts + checksum)
 * even if the generic loop covers them. Matches the task spec list.
 */
export const STRICT_VERIFY_TABLES = [
  'users',
  'roles',
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
];

/**
 * Tables compared by md5(string_agg(t::text ORDER BY pk)) checksum during
 * verify. auth.users is excluded — its encrypted_password is verified
 * separately, byte-safe, by 06_verify_passwords.
 */
export const CHECKSUM_TABLES = [
  'roles',
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
];

/**
 * Foreign-key references 05_verify_yandex checks for orphans after import.
 * NOTE: created_by / user_id FKs point at auth.users in the applied Yandex
 * schema (Option A bridge) — verify against auth.users for those.
 */
export const FK_CHECKS = [
  { table: 'users', column: 'id', refSchema: 'auth', refTable: 'users', refColumn: 'id' },
  { table: 'tenders', column: 'created_by', refSchema: 'auth', refTable: 'users', refColumn: 'id' },
  { table: 'tender_registry', column: 'created_by', refSchema: 'auth', refTable: 'users', refColumn: 'id' },
  { table: 'tender_notes', column: 'user_id', refSchema: 'auth', refTable: 'users', refColumn: 'id' },
  { table: 'comparison_notes', column: 'created_by', refSchema: 'auth', refTable: 'users', refColumn: 'id' },
  { table: 'cost_redistribution_results', column: 'created_by', refSchema: 'auth', refTable: 'users', refColumn: 'id' },
  { table: 'import_sessions', column: 'user_id', refSchema: 'auth', refTable: 'users', refColumn: 'id' },
  { table: 'import_sessions', column: 'cancelled_by', refSchema: 'auth', refTable: 'users', refColumn: 'id' },
  { table: 'client_positions', column: 'tender_id', refSchema: 'public', refTable: 'tenders', refColumn: 'id' },
  { table: 'boq_items', column: 'client_position_id', refSchema: 'public', refTable: 'client_positions', refColumn: 'id' },
  { table: 'boq_items', column: 'tender_id', refSchema: 'public', refTable: 'tenders', refColumn: 'id' },
  { table: 'boq_items_audit', column: 'boq_item_id', refSchema: 'public', refTable: 'boq_items', refColumn: 'id' },
  { table: 'tender_iterations', column: 'user_id', refSchema: 'public', refTable: 'users', refColumn: 'id' },
  { table: 'tender_iterations', column: 'manager_id', refSchema: 'public', refTable: 'users', refColumn: 'id' },
  { table: 'tender_iterations', column: 'group_id', refSchema: 'public', refTable: 'tender_groups', refColumn: 'id' },
];

/**
 * Return tables from IMPORT_ORDER that actually exist on a target snapshot.
 * Used when the applied schema and IMPORT_ORDER drift (skip missing rather
 * than fail). `existingTables` is a Set of public table names.
 */
export function tablesPresentIn(existingTables) {
  const present = existingTables instanceof Set ? existingTables : new Set(existingTables);
  return IMPORT_ORDER.filter((name) => present.has(name));
}
