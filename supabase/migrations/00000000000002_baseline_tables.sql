-- Baseline migration 2/10: tables, PK, CHECK constraints.
-- Target: pre-prod project ocauafggjrqvopxjihas (TenderHUB_SU10 Prod).
-- Source: snapshot of wkywhjljrhewfpedbjzx (live prod) as of 2026-04-20.
-- 40 tables total. Foreign keys live in migration 3; indexes live in migration 4.

-- =============================================================================
-- LEVEL 0: independent tables (no FK to other public tables).
-- =============================================================================

CREATE TABLE public.roles (
    code text NOT NULL,
    name text NOT NULL,
    allowed_pages jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_system_role boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    color text DEFAULT 'default'::text,
    CONSTRAINT roles_pkey PRIMARY KEY (code),
    CONSTRAINT roles_code_format CHECK (code ~ '^[a-z_]+$'::text),
    CONSTRAINT roles_name_not_empty CHECK (btrim(name) <> ''::text)
);

CREATE TABLE public.units (
    code text NOT NULL,
    name text NOT NULL,
    description text,
    category text,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT units_pkey PRIMARY KEY (code)
);

CREATE TABLE public.construction_scopes (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT construction_scopes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tender_statuses (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tender_statuses_pkey PRIMARY KEY (id)
);

CREATE TABLE public.markup_parameters (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    key text NOT NULL,
    label text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    order_num integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    default_value numeric NOT NULL DEFAULT 0,
    CONSTRAINT markup_parameters_pkey PRIMARY KEY (id),
    CONSTRAINT markup_parameters_default_value_range CHECK (default_value >= (0)::numeric AND default_value <= 999.99),
    CONSTRAINT markup_parameters_key_check CHECK (key ~ '^[a-z0-9_]+$'::text)
);

CREATE TABLE public.library_folders (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    name text NOT NULL,
    type text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    parent_id uuid,
    CONSTRAINT library_folders_pkey PRIMARY KEY (id),
    CONSTRAINT library_folders_type_check CHECK (type = ANY (ARRAY['works'::text, 'materials'::text, 'templates'::text]))
);

CREATE TABLE public.notifications (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    related_entity_type text,
    related_entity_id uuid,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT notifications_pkey PRIMARY KEY (id),
    CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY['success'::text, 'info'::text, 'warning'::text, 'pending'::text]))
);

-- =============================================================================
-- LEVEL 1: depend on units / roles / library_folders / markup_parameters.
-- =============================================================================

CREATE TABLE public.users (
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
    current_work_status public.work_status DEFAULT 'working'::public.work_status,
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_email_check CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::text),
    CONSTRAINT users_full_name_check CHECK (btrim(full_name) <> ''::text)
);

CREATE TABLE public.cost_categories (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    name text NOT NULL,
    unit text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT cost_categories_pkey PRIMARY KEY (id)
);

CREATE TABLE public.material_names (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    name text NOT NULL,
    unit text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT material_names_pkey PRIMARY KEY (id)
);

CREATE TABLE public.work_names (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    name text NOT NULL,
    unit text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT work_names_pkey PRIMARY KEY (id)
);

-- =============================================================================
-- LEVEL 2: tenders / detail_cost_categories / markup_tactics / libraries.
-- =============================================================================

CREATE TABLE public.tenders (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
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
    cached_grand_total numeric NOT NULL DEFAULT 0,
    CONSTRAINT tenders_pkey PRIMARY KEY (id)
);

CREATE TABLE public.detail_cost_categories (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    cost_category_id uuid NOT NULL,
    location text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    order_num integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT detail_cost_categories_pkey PRIMARY KEY (id)
);

CREATE TABLE public.markup_tactics (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    name text,
    sequences jsonb NOT NULL DEFAULT '{"мат": [], "раб": [], "суб-мат": [], "суб-раб": [], "мат-комп.": [], "раб-комп.": []}'::jsonb,
    base_costs jsonb NOT NULL DEFAULT '{"мат": 0, "раб": 0, "суб-мат": 0, "суб-раб": 0, "мат-комп.": 0, "раб-комп.": 0}'::jsonb,
    user_id uuid,
    is_global boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT markup_tactics_pkey PRIMARY KEY (id)
);

CREATE TABLE public.materials_library (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
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
    folder_id uuid,
    CONSTRAINT materials_library_pkey PRIMARY KEY (id)
);

CREATE TABLE public.works_library (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    work_name_id uuid NOT NULL,
    item_type public.boq_item_type NOT NULL,
    unit_rate numeric NOT NULL,
    currency_type public.currency_type NOT NULL DEFAULT 'RUB'::public.currency_type,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    folder_id uuid,
    CONSTRAINT works_library_pkey PRIMARY KEY (id)
);

-- =============================================================================
-- LEVEL 3: depend on tenders / users / detail_cost_categories / markup_tactics.
-- =============================================================================

CREATE TABLE public.tender_registry (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
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
    dashboard_status text DEFAULT 'calc'::text,
    CONSTRAINT tender_registry_pkey PRIMARY KEY (id),
    CONSTRAINT tender_registry_dashboard_status_check CHECK (dashboard_status = ANY (ARRAY['calc'::text, 'sent'::text, 'waiting_pd'::text, 'archive'::text]) OR dashboard_status IS NULL)
);

CREATE TABLE public.client_positions (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
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
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT client_positions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.import_sessions (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    user_id uuid,
    tender_id uuid,
    file_name text,
    items_count integer NOT NULL DEFAULT 0,
    positions_snapshot jsonb,
    imported_at timestamp with time zone NOT NULL DEFAULT now(),
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    CONSTRAINT import_sessions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.templates (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    name text NOT NULL,
    detail_cost_category_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    folder_id uuid,
    CONSTRAINT templates_pkey PRIMARY KEY (id)
);

CREATE TABLE public.construction_cost_volumes (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    tender_id uuid NOT NULL,
    detail_cost_category_id uuid,
    volume numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    group_key text,
    CONSTRAINT construction_cost_volumes_pkey PRIMARY KEY (id),
    CONSTRAINT check_volume_type CHECK ((detail_cost_category_id IS NOT NULL AND group_key IS NULL) OR (detail_cost_category_id IS NULL AND group_key IS NOT NULL))
);

CREATE TABLE public.tender_insurance (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
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
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tender_insurance_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tender_markup_percentage (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    tender_id uuid NOT NULL,
    markup_parameter_id uuid NOT NULL,
    value numeric NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT tender_markup_percentage_pkey PRIMARY KEY (id),
    CONSTRAINT tender_markup_percentage_value_check CHECK (value >= (0)::numeric AND value <= (100)::numeric)
);

CREATE TABLE public.tender_notes (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    tender_id uuid NOT NULL,
    user_id uuid NOT NULL,
    note_text text NOT NULL DEFAULT ''::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT tender_notes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tender_pricing_distribution (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
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
    component_work_markup_target text NOT NULL DEFAULT 'work'::text,
    CONSTRAINT tender_pricing_distribution_pkey PRIMARY KEY (id),
    CONSTRAINT tender_pricing_distribution_basic_material_base_target_check CHECK (basic_material_base_target = ANY (ARRAY['material'::text, 'work'::text])),
    CONSTRAINT tender_pricing_distribution_basic_material_markup_target_check CHECK (basic_material_markup_target = ANY (ARRAY['material'::text, 'work'::text])),
    CONSTRAINT tender_pricing_distribution_auxiliary_material_base_target_check CHECK (auxiliary_material_base_target = ANY (ARRAY['material'::text, 'work'::text])),
    CONSTRAINT tender_pricing_distribution_auxiliary_material_markup_target_check CHECK (auxiliary_material_markup_target = ANY (ARRAY['material'::text, 'work'::text])),
    CONSTRAINT tender_pricing_distribution_work_base_target_check CHECK (work_base_target = ANY (ARRAY['material'::text, 'work'::text])),
    CONSTRAINT tender_pricing_distribution_work_markup_target_check CHECK (work_markup_target = ANY (ARRAY['material'::text, 'work'::text])),
    CONSTRAINT tender_pricing_distribution_subcontract_basic_material_base_target_check CHECK (subcontract_basic_material_base_target = ANY (ARRAY['material'::text, 'work'::text])),
    CONSTRAINT tender_pricing_distribution_subcontract_basic_material_markup_target_check CHECK (subcontract_basic_material_markup_target = ANY (ARRAY['material'::text, 'work'::text])),
    CONSTRAINT tender_pricing_distribution_component_material_base_target_check CHECK (component_material_base_target = ANY (ARRAY['material'::text, 'work'::text])),
    CONSTRAINT tender_pricing_distribution_component_material_markup_target_check CHECK (component_material_markup_target = ANY (ARRAY['material'::text, 'work'::text])),
    CONSTRAINT tender_pricing_distribution_component_work_base_target_check CHECK (component_work_base_target = ANY (ARRAY['material'::text, 'work'::text])),
    CONSTRAINT tender_pricing_distribution_component_work_markup_target_check CHECK (component_work_markup_target = ANY (ARRAY['material'::text, 'work'::text])),
    CONSTRAINT tender_pricing_distribution_subcontract_auxiliary_material_base_target_check CHECK (subcontract_auxiliary_material_base_target = ANY (ARRAY['material'::text, 'work'::text])),
    CONSTRAINT tender_pricing_distribution_subcontract_auxiliary_material_markup_target_check CHECK (subcontract_auxiliary_material_markup_target = ANY (ARRAY['material'::text, 'work'::text]))
);

CREATE TABLE public.tender_documents (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    tender_id uuid NOT NULL,
    section_type varchar NOT NULL,
    title varchar NOT NULL,
    original_filename varchar,
    content_markdown text NOT NULL,
    file_size bigint,
    upload_date timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tender_documents_pkey PRIMARY KEY (id)
);

CREATE TABLE public.subcontract_growth_exclusions (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    tender_id uuid NOT NULL,
    detail_cost_category_id uuid NOT NULL,
    exclusion_type text NOT NULL DEFAULT 'works'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT subcontract_growth_exclusions_pkey PRIMARY KEY (id),
    CONSTRAINT subcontract_growth_exclusions_exclusion_type_check CHECK (exclusion_type = ANY (ARRAY['works'::text, 'materials'::text]))
);

CREATE TABLE public.user_tasks (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    user_id uuid NOT NULL,
    tender_id uuid,
    description text NOT NULL,
    task_status public.task_status DEFAULT 'running'::public.task_status,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_tasks_pkey PRIMARY KEY (id),
    CONSTRAINT user_tasks_description_check CHECK (btrim(description) <> ''::text)
);

-- =============================================================================
-- LEVEL 4: depend on client_positions / tenders / import_sessions / templates.
-- =============================================================================

CREATE TABLE public.boq_items (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
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
    import_session_id uuid,
    CONSTRAINT boq_items_pkey PRIMARY KEY (id),
    CONSTRAINT boq_items_material_check CHECK ((boq_item_type = ANY (ARRAY['мат'::public.boq_item_type, 'суб-мат'::public.boq_item_type, 'мат-комп.'::public.boq_item_type]) AND material_name_id IS NOT NULL AND work_name_id IS NULL) OR (boq_item_type = ANY (ARRAY['раб'::public.boq_item_type, 'суб-раб'::public.boq_item_type, 'раб-комп.'::public.boq_item_type]) AND work_name_id IS NOT NULL AND material_name_id IS NULL)),
    CONSTRAINT boq_items_parent_work_check CHECK ((boq_item_type = ANY (ARRAY['мат'::public.boq_item_type, 'суб-мат'::public.boq_item_type, 'мат-комп.'::public.boq_item_type])) OR (boq_item_type = ANY (ARRAY['раб'::public.boq_item_type, 'суб-раб'::public.boq_item_type, 'раб-комп.'::public.boq_item_type]) AND parent_work_item_id IS NULL)),
    CONSTRAINT boq_items_delivery_amount_check CHECK ((delivery_price_type = 'суммой'::public.delivery_price_type AND delivery_amount IS NOT NULL) OR (delivery_price_type = ANY (ARRAY['в цене'::public.delivery_price_type, 'не в цене'::public.delivery_price_type]) AND (delivery_amount IS NULL OR delivery_amount = (0)::numeric)) OR delivery_price_type IS NULL),
    CONSTRAINT boq_items_quantity_positive CHECK (quantity IS NULL OR quantity > (0)::numeric),
    CONSTRAINT boq_items_base_quantity_positive CHECK (base_quantity IS NULL OR base_quantity > (0)::numeric),
    CONSTRAINT boq_items_consumption_coefficient_positive CHECK (consumption_coefficient IS NULL OR consumption_coefficient > (0)::numeric),
    CONSTRAINT boq_items_conversion_coefficient_positive CHECK (conversion_coefficient IS NULL OR conversion_coefficient > (0)::numeric)
);

CREATE TABLE public.boq_items_audit (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    boq_item_id uuid NOT NULL,
    operation_type text NOT NULL,
    changed_at timestamp with time zone NOT NULL DEFAULT now(),
    changed_by uuid,
    old_data jsonb,
    new_data jsonb,
    changed_fields text[],
    CONSTRAINT boq_items_audit_pkey PRIMARY KEY (id),
    CONSTRAINT boq_items_audit_operation_type_check CHECK (operation_type = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])),
    CONSTRAINT audit_data_check CHECK ((operation_type = 'INSERT'::text AND old_data IS NULL AND new_data IS NOT NULL) OR (operation_type = 'UPDATE'::text AND old_data IS NOT NULL AND new_data IS NOT NULL) OR (operation_type = 'DELETE'::text AND old_data IS NOT NULL AND new_data IS NULL))
);

CREATE TABLE public.template_items (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
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
    detail_cost_category_id uuid,
    CONSTRAINT template_items_pkey PRIMARY KEY (id),
    CONSTRAINT template_items_kind_check CHECK (kind = ANY (ARRAY['work'::text, 'material'::text])),
    CONSTRAINT template_items_work_logic_check CHECK (kind <> 'work'::text OR (work_library_id IS NOT NULL AND material_library_id IS NULL AND parent_work_item_id IS NULL AND conversation_coeff IS NULL)),
    CONSTRAINT template_items_material_logic_check CHECK (kind <> 'material'::text OR (work_library_id IS NULL AND material_library_id IS NOT NULL AND ((parent_work_item_id IS NULL AND conversation_coeff IS NULL) OR (parent_work_item_id IS NOT NULL AND conversation_coeff IS NOT NULL))))
);

CREATE TABLE public.user_position_filters (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    user_id uuid NOT NULL,
    tender_id uuid NOT NULL,
    position_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_position_filters_pkey PRIMARY KEY (id)
);

CREATE TABLE public.comparison_notes (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    tender_id_1 uuid NOT NULL,
    tender_id_2 uuid NOT NULL,
    cost_category_name text NOT NULL,
    detail_category_key text,
    note text NOT NULL DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    CONSTRAINT comparison_notes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.cost_redistribution_results (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
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
    created_by uuid,
    CONSTRAINT cost_redistribution_results_pkey PRIMARY KEY (id)
);

-- =============================================================================
-- LEVEL 5: projects and monthly completion (tenders FK optional).
-- =============================================================================

CREATE TABLE public.projects (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
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
    contract_date date,
    CONSTRAINT projects_pkey PRIMARY KEY (id)
);

CREATE TABLE public.project_additional_agreements (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    project_id uuid NOT NULL,
    agreement_date date NOT NULL,
    amount numeric NOT NULL,
    description text,
    agreement_number text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT project_additional_agreements_pkey PRIMARY KEY (id)
);

CREATE TABLE public.project_monthly_completion (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    project_id uuid NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    actual_amount numeric NOT NULL DEFAULT 0,
    forecast_amount numeric,
    note text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT project_monthly_completion_pkey PRIMARY KEY (id),
    CONSTRAINT project_monthly_completion_month_check CHECK (month >= 1 AND month <= 12)
);

-- =============================================================================
-- LEVEL 6: tender_groups, tender_group_members, tender_iterations.
-- =============================================================================

CREATE TABLE public.tender_groups (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    tender_id uuid NOT NULL,
    name text NOT NULL,
    color text NOT NULL DEFAULT '#1677ff'::text,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    quality_level smallint,
    quality_comment text,
    quality_updated_by uuid,
    quality_updated_at timestamp with time zone,
    CONSTRAINT tender_groups_pkey PRIMARY KEY (id),
    CONSTRAINT tender_groups_quality_level_check CHECK (quality_level IS NULL OR (quality_level >= 1 AND quality_level <= 10))
);

CREATE TABLE public.tender_group_members (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT tender_group_members_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tender_iterations (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
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
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT tender_iterations_pkey PRIMARY KEY (id),
    CONSTRAINT tender_iterations_approval_status_check CHECK (approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
    CONSTRAINT tender_iterations_manager_required_for_approved CHECK (approval_status <> 'approved'::text OR manager_id IS NOT NULL),
    CONSTRAINT tender_iterations_manager_required_for_rejected CHECK (approval_status <> 'rejected'::text OR manager_id IS NOT NULL),
    CONSTRAINT tender_iterations_response_date_required_for_approved CHECK (approval_status <> 'approved'::text OR manager_responded_at IS NOT NULL),
    CONSTRAINT tender_iterations_response_date_required_for_rejected CHECK (approval_status <> 'rejected'::text OR manager_responded_at IS NOT NULL)
);
