// _tables.mjs — single source of truth for OLD → PROD import order.
//
// Order is topological: parents come before children. Reference tables and
// users come first; audit/derived tables come last.
//
// Derived from supabase/migrations FK graph and the 40-table list in the
// project prompt. Every entry is a public.* table; auth.users + auth.identities
// are handled separately by 06_import_prod.mjs (auth phase) before this list.

export const IMPORT_ORDER = [
  // ---- reference tables (PROD-seed wins via ON CONFLICT DO NOTHING) ----
  'roles',
  'units',
  'construction_scopes',
  'tender_statuses',
  'markup_parameters',
  'library_folders',
  'notifications',

  // ---- users (FK target for many tables; requires auth.users imported first) ----
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
  // CRITICAL: 06_import_prod MUST disable trigger_auto_create_tender_registry
  // before importing tenders, regardless of import order. The trigger function
  // public.auto_create_tender_registry() does an unconditional INSERT into
  // tender_registry with no conflict check — so every imported tender creates
  // a NEW tender_registry row even if one already exists for that tender_number.
  // Importing tender_registry first does NOT prevent duplicates (the trigger
  // generates a fresh UUID id every time). ALLOW_DISABLE_IMPORT_TRIGGERS=true
  // is mandatory whenever the 'tenders' table is part of IMPORT_ORDER.
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

  // ---- BOQ (FK on client_positions) ----
  // CRITICAL: 06_import_prod MUST disable trg_boq_items_audit before importing
  // boq_items. The trigger function public.log_boq_items_changes() does an
  // unconditional INSERT into boq_items_audit on every row touched, which
  // would inflate the audit table by `len(boq_items)` rows beyond what we
  // import from boq_items_audit.ndjson. ALLOW_DISABLE_IMPORT_TRIGGERS=true
  // is mandatory whenever the 'boq_items' table is part of IMPORT_ORDER.
  'boq_items',
  'boq_items_audit',
  'template_items',
  'user_position_filters',
  'comparison_notes',
  'cost_redistribution_results',

  // ---- projects (loose FK on tenders, can be imported any time after tenders) ----
  'projects',
  'project_additional_agreements',
  'project_monthly_completion',

  // ---- tender timeline (FK on tenders + users) ----
  'tender_groups',
  'tender_group_members',
  'tender_iterations',
];

/**
 * Triggers on PROD that MUST be temporarily disabled during import of the
 * corresponding parent table, to avoid duplicate / redundant side-effects.
 *
 * If the parent table is in IMPORT_ORDER and the listed trigger exists on
 * PROD, importing without ALLOW_DISABLE_IMPORT_TRIGGERS=true is FORBIDDEN —
 * the importer will abort in 05_prepare_prod. This is enforced regardless
 * of whether PROD is empty or not (the trigger duplicates data either way).
 *
 * Keys are public-schema table names; values are arrays of user trigger names
 * defined in supabase/migrations.
 *
 * NEVER disable system/internal triggers. NEVER use session_replication_role.
 */
export const REQUIRES_TRIGGER_DISABLE = {
  tenders: ['trigger_auto_create_tender_registry'],
  boq_items: ['trg_boq_items_audit'],
};

/** @deprecated use REQUIRES_TRIGGER_DISABLE. Kept for backward-compat. */
export const DANGEROUS_TRIGGERS_BY_TABLE = REQUIRES_TRIGGER_DISABLE;

/**
 * pg_notify triggers — these emit websocket events. We intentionally do NOT
 * disable them during import; the broker has no subscribers during cutover
 * window, and the notify channel is debounced server-side anyway.
 */
export const NOTIFY_TRIGGERS = [
  'trg_notify_row_change_tenders',
  'trg_notify_row_change_notifications',
  'trg_notify_row_change_boq_items',
  'trg_notify_row_change_client_positions',
  'trg_notify_row_change_cost_redistribution_results',
  'trg_notify_row_change_construction_cost_volumes',
];

/**
 * Return tables from IMPORT_ORDER that actually exist in a schema snapshot.
 * Useful when OLD/PROD schemas drift — we skip missing tables rather than fail.
 *
 * @param {object} schemaJson - parsed *_schema.json
 * @returns {string[]} subset of IMPORT_ORDER present in schemaJson.tables (public schema)
 */
export function tablesPresentIn(schemaJson) {
  const present = new Set(
    (schemaJson?.tables || [])
      .filter((t) => t.schema === 'public')
      .map((t) => t.table)
  );
  return IMPORT_ORDER.filter((name) => present.has(name));
}

/**
 * Tables that hold seed data on PROD (from migration 9). Their conflict
 * policy is always DO NOTHING — PROD seed wins over OLD data when the same id
 * exists. Custom user-created rows in OLD will still be imported (different id).
 */
export const SEED_TABLES = new Set([
  'roles',
  'units',
  'construction_scopes',
  'tender_statuses',
  'markup_parameters',
  'cost_categories',
  'detail_cost_categories',
]);

/**
 * Tables which we intentionally never delete during --clean-prod. These hold
 * structural data which PROD owns (seed) or whose deletion cascades
 * destructively.
 */
export const CLEAN_PROD_PROHIBITED = new Set([
  // seed tables — PROD owns these
  ...SEED_TABLES,
]);

/**
 * Tables with self-referencing FK (a column → same table's id). During import
 * from NDJSON, children may appear before their parents in the file order
 * → FK violation. We buffer all rows for these tables and topologically sort
 * (roots first, then children whose parent is already inserted) before any
 * INSERT.
 *
 * Discovered via:
 *   SELECT con_cls.relname, att_from.attname, att_to.attname FROM pg_constraint con
 *   ... WHERE con.contype='f' AND con.conrelid = con.confrelid
 *
 * Memory cost: O(rows × avg_row_size) per table; capped by NDJSON size.
 * client_positions ~40k×500B ≈ 20MB, boq_items ~110k×600B ≈ 65MB — acceptable.
 */
export const SELF_FK_TABLES = Object.freeze({
  boq_items:        { idCol: 'id', parentCol: 'parent_work_item_id' },
  client_positions: { idCol: 'id', parentCol: 'parent_position_id'  },
  library_folders:  { idCol: 'id', parentCol: 'parent_id'           },
  template_items:   { idCol: 'id', parentCol: 'parent_work_item_id' },
  users:            { idCol: 'id', parentCol: 'approved_by'         },
});
