-- =============================================================================
-- 03_tables.sql — application public tables (columns only).
--
-- Source: supabase/migrations/00000000000002_baseline_tables.sql.
--
-- IMPORT-FRIENDLY SPLIT:
--   * This file creates tables with columns + column defaults + NOT NULL only.
--   * PRIMARY KEY / UNIQUE / CHECK / FOREIGN KEY constraints live in
--     06_indexes_constraints.sql so a bulk PROD->Yandex data load can run
--     before constraints/indexes are validated.
--
-- CLEANING APPLIED vs the Supabase migration:
--   * DEFAULT extensions.uuid_generate_v4()  ->  DEFAULT gen_random_uuid()
--     (no schema-qualified extension calls; gen_random_uuid() is from pgcrypto,
--      already enabled on the Yandex cluster — see 07_SCHEMA_BUILD_REPORT.md §10).
--   * No CREATE EXTENSION. No Supabase-internal objects.
--
-- 40 tables. Order = original migration levels (independent -> dependent), kept
-- for readability only (no FKs here, so order is not load-critical).
-- =============================================================================

-- ----- LEVEL 0: independent tables -----------------------------------------

CREATE TABLE IF NOT EXISTS public.roles (
    code text NOT NULL,
    name text NOT NULL,
    allowed_pages jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_system_role boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    color text DEFAULT 'default'::text
);

CREATE TABLE IF NOT EXISTS public.units (
    code text NOT NULL,
    name text NOT NULL,
    description text,
    category text,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.construction_scopes (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tender_statuses (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.markup_parameters (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    key text NOT NULL,
    label text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    order_num integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    default_value numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.library_folders (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    type text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    parent_id uuid
);

CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    related_entity_type text,
    related_entity_id uuid,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- ----- LEVEL 1 --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.users (
    id uuid NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    access_status public.access_status_type NOT NULL DEFAULT 'pending'::public.access_status_type,
    approved_by uuid,
    approved_at timestamp with time zone,
    registration_date timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    access_enabled boolean DEFAULT true,
    role_code text NOT NULL,
    allowed_pages jsonb DEFAULT '[]'::jsonb,
    tender_deadline_extensions jsonb DEFAULT '[]'::jsonb,
    current_work_mode public.work_mode DEFAULT 'office'::public.work_mode,
    current_work_status public.work_status DEFAULT 'working'::public.work_status
);

CREATE TABLE IF NOT EXISTS public.cost_categories (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    unit text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.material_names (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    unit text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.work_names (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    unit text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- ----- LEVEL 2 --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tenders (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    title text NOT NULL,
    description text,
    client_name text NOT NULL,
    tender_number text NOT NULL,
    submission_deadline timestamp with time zone,
    version integer DEFAULT 1,
    area_client numeric,
    area_sp numeric,
    usd_rate numeric,
    eur_rate numeric,
    cny_rate numeric,
    upload_folder text,
    bsm_link text,
    tz_link text,
    qa_form_link text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    markup_tactic_id uuid,
    apply_subcontract_works_growth boolean DEFAULT true,
    apply_subcontract_materials_growth boolean DEFAULT true,
    housing_class public.housing_class_type,
    construction_scope public.construction_scope_type,
    project_folder_link text,
    is_archived boolean NOT NULL DEFAULT false,
    volume_title text DEFAULT 'Полный объём строительства'::text,
    cached_grand_total numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.detail_cost_categories (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    cost_category_id uuid NOT NULL,
    location text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    order_num integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.markup_tactics (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text,
    sequences jsonb NOT NULL DEFAULT '{"мат": [], "раб": [], "суб-мат": [], "суб-раб": [], "мат-комп.": [], "раб-комп.": []}'::jsonb,
    base_costs jsonb NOT NULL DEFAULT '{"мат": 0, "раб": 0, "суб-мат": 0, "суб-раб": 0, "мат-комп.": 0, "раб-комп.": 0}'::jsonb,
    user_id uuid,
    is_global boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.materials_library (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    material_type public.material_type NOT NULL,
    item_type public.boq_item_type NOT NULL,
    consumption_coefficient numeric DEFAULT 1.0000,
    unit_rate numeric NOT NULL,
    currency_type public.currency_type NOT NULL DEFAULT 'RUB'::public.currency_type,
    delivery_price_type public.delivery_price_type NOT NULL DEFAULT 'в цене'::public.delivery_price_type,
    delivery_amount numeric DEFAULT 0.00000,
    material_name_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    folder_id uuid
);

CREATE TABLE IF NOT EXISTS public.works_library (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    work_name_id uuid NOT NULL,
    item_type public.boq_item_type NOT NULL,
    unit_rate numeric NOT NULL,
    currency_type public.currency_type NOT NULL DEFAULT 'RUB'::public.currency_type,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    folder_id uuid
);

-- ----- LEVEL 3 --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tender_registry (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    title text NOT NULL,
    client_name text NOT NULL,
    construction_scope_id uuid,
    area numeric,
    submission_date timestamp with time zone,
    construction_start_date timestamp with time zone,
    site_visit_photo_url text,
    site_visit_date timestamp with time zone,
    has_tender_package text,
    invitation_date timestamp with time zone,
    status_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    chronology text,
    sort_order integer NOT NULL,
    object_address text,
    tender_number text,
    is_archived boolean NOT NULL DEFAULT false,
    chronology_items jsonb DEFAULT '[]'::jsonb,
    tender_package_items jsonb DEFAULT '[]'::jsonb,
    manual_total_cost numeric,
    object_coordinates text,
    commission_date timestamp with time zone,
    dashboard_status text DEFAULT 'calc'::text
);

CREATE TABLE IF NOT EXISTS public.client_positions (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id uuid NOT NULL,
    position_number numeric NOT NULL,
    unit_code text,
    volume numeric,
    client_note text,
    item_no text,
    work_name text NOT NULL,
    manual_volume numeric,
    manual_note text,
    hierarchy_level integer DEFAULT 0,
    is_additional boolean DEFAULT false,
    parent_position_id uuid,
    total_material numeric DEFAULT 0,
    total_works numeric DEFAULT 0,
    material_cost_per_unit numeric DEFAULT 0,
    work_cost_per_unit numeric DEFAULT 0,
    total_commercial_material numeric DEFAULT 0,
    total_commercial_work numeric DEFAULT 0,
    total_commercial_material_per_unit numeric DEFAULT 0,
    total_commercial_work_per_unit numeric DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.import_sessions (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid,
    tender_id uuid,
    file_name text,
    items_count integer NOT NULL DEFAULT 0,
    positions_snapshot jsonb,
    imported_at timestamp with time zone NOT NULL DEFAULT now(),
    cancelled_at timestamp with time zone,
    cancelled_by uuid
);

CREATE TABLE IF NOT EXISTS public.templates (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    detail_cost_category_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    folder_id uuid
);

CREATE TABLE IF NOT EXISTS public.construction_cost_volumes (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id uuid NOT NULL,
    detail_cost_category_id uuid,
    volume numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    group_key text
);

CREATE TABLE IF NOT EXISTS public.tender_insurance (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id uuid NOT NULL,
    judicial_pct numeric NOT NULL DEFAULT 0,
    total_pct numeric NOT NULL DEFAULT 0,
    apt_price_m2 numeric NOT NULL DEFAULT 0,
    apt_area numeric NOT NULL DEFAULT 0,
    parking_price_m2 numeric NOT NULL DEFAULT 0,
    parking_area numeric NOT NULL DEFAULT 0,
    storage_price_m2 numeric NOT NULL DEFAULT 0,
    storage_area numeric NOT NULL DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tender_markup_percentage (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id uuid NOT NULL,
    markup_parameter_id uuid NOT NULL,
    value numeric NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tender_notes (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id uuid NOT NULL,
    user_id uuid NOT NULL,
    note_text text NOT NULL DEFAULT ''::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tender_pricing_distribution (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id uuid NOT NULL,
    markup_tactic_id uuid,
    basic_material_base_target text NOT NULL DEFAULT 'material'::text,
    basic_material_markup_target text NOT NULL DEFAULT 'work'::text,
    auxiliary_material_base_target text NOT NULL DEFAULT 'work'::text,
    auxiliary_material_markup_target text NOT NULL DEFAULT 'work'::text,
    work_base_target text NOT NULL DEFAULT 'work'::text,
    work_markup_target text NOT NULL DEFAULT 'work'::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    subcontract_basic_material_base_target text NOT NULL DEFAULT 'work'::text,
    subcontract_basic_material_markup_target text NOT NULL DEFAULT 'work'::text,
    subcontract_auxiliary_material_base_target text NOT NULL DEFAULT 'work'::text,
    subcontract_auxiliary_material_markup_target text NOT NULL DEFAULT 'work'::text,
    component_material_base_target text NOT NULL DEFAULT 'work'::text,
    component_material_markup_target text NOT NULL DEFAULT 'work'::text,
    component_work_base_target text NOT NULL DEFAULT 'work'::text,
    component_work_markup_target text NOT NULL DEFAULT 'work'::text
);

CREATE TABLE IF NOT EXISTS public.tender_documents (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id uuid NOT NULL,
    section_type varchar NOT NULL,
    title varchar NOT NULL,
    original_filename varchar,
    content_markdown text NOT NULL,
    file_size bigint,
    upload_date timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subcontract_growth_exclusions (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id uuid NOT NULL,
    detail_cost_category_id uuid NOT NULL,
    exclusion_type text NOT NULL DEFAULT 'works'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_tasks (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    tender_id uuid,
    description text NOT NULL,
    task_status public.task_status DEFAULT 'running'::public.task_status,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- ----- LEVEL 4 --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.boq_items (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id uuid NOT NULL,
    client_position_id uuid NOT NULL,
    sort_number integer NOT NULL DEFAULT 0,
    boq_item_type public.boq_item_type NOT NULL,
    material_type public.material_type,
    material_name_id uuid,
    work_name_id uuid,
    unit_code text,
    quantity numeric,
    base_quantity numeric,
    consumption_coefficient numeric,
    conversion_coefficient numeric,
    delivery_price_type public.delivery_price_type,
    delivery_amount numeric DEFAULT 0.00000,
    currency_type public.currency_type DEFAULT 'RUB'::public.currency_type,
    total_amount numeric,
    detail_cost_category_id uuid,
    quote_link text,
    commercial_markup numeric,
    total_commercial_material_cost numeric,
    total_commercial_work_cost numeric,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    parent_work_item_id uuid,
    description text,
    unit_rate numeric DEFAULT 0.00,
    import_session_id uuid
);

CREATE TABLE IF NOT EXISTS public.boq_items_audit (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    boq_item_id uuid NOT NULL,
    operation_type text NOT NULL,
    changed_at timestamp with time zone NOT NULL DEFAULT now(),
    changed_by uuid,
    old_data jsonb,
    new_data jsonb,
    changed_fields text[]
);

CREATE TABLE IF NOT EXISTS public.template_items (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    template_id uuid NOT NULL,
    kind text NOT NULL,
    work_library_id uuid,
    material_library_id uuid,
    parent_work_item_id uuid,
    conversation_coeff numeric,
    position integer NOT NULL DEFAULT 0,
    note text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    detail_cost_category_id uuid
);

CREATE TABLE IF NOT EXISTS public.user_position_filters (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    tender_id uuid NOT NULL,
    position_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.comparison_notes (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id_1 uuid NOT NULL,
    tender_id_2 uuid NOT NULL,
    cost_category_name text NOT NULL,
    detail_category_key text,
    note text NOT NULL DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid
);

CREATE TABLE IF NOT EXISTS public.cost_redistribution_results (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id uuid NOT NULL,
    markup_tactic_id uuid NOT NULL,
    boq_item_id uuid NOT NULL,
    original_work_cost numeric,
    deducted_amount numeric NOT NULL DEFAULT 0,
    added_amount numeric NOT NULL DEFAULT 0,
    final_work_cost numeric,
    redistribution_rules jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    created_by uuid
);

-- ----- LEVEL 5 --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.projects (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    client_name text NOT NULL,
    contract_cost numeric NOT NULL DEFAULT 0,
    area numeric,
    construction_end_date date,
    tender_id uuid,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    created_by uuid,
    contract_date date
);

CREATE TABLE IF NOT EXISTS public.project_additional_agreements (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    agreement_date date NOT NULL,
    amount numeric NOT NULL,
    description text,
    agreement_number text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_monthly_completion (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    actual_amount numeric NOT NULL DEFAULT 0,
    forecast_amount numeric,
    note text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- ----- LEVEL 6 --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tender_groups (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tender_id uuid NOT NULL,
    name text NOT NULL,
    color text NOT NULL DEFAULT '#1677ff'::text,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    quality_level smallint,
    quality_comment text,
    quality_updated_by uuid,
    quality_updated_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.tender_group_members (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tender_iterations (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    iteration_number integer NOT NULL,
    user_comment text NOT NULL,
    user_amount numeric,
    submitted_at timestamp with time zone NOT NULL DEFAULT now(),
    manager_id uuid,
    manager_comment text,
    manager_responded_at timestamp with time zone,
    approval_status text NOT NULL DEFAULT 'pending'::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);
