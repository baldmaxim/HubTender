-- Baseline migration 4/10: indexes (duplicates skipped, FK gaps filled).
-- Target: pre-prod project ocauafggjrqvopxjihas (TenderHUB_SU10 Prod).
-- Source: snapshot of wkywhjljrhewfpedbjzx (live prod) as of 2026-04-20.
-- Excluded: PK indexes, UNIQUE indexes backed by ADD CONSTRAINT (created elsewhere),
-- and 7 documented duplicates from the Performance Advisor audit.

-- =============================================================================
-- boq_items
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_boq_items_boq_item_type ON public.boq_items USING btree (boq_item_type);
CREATE INDEX IF NOT EXISTS idx_boq_items_client_position_id ON public.boq_items USING btree (client_position_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_detail_cost_category_id ON public.boq_items USING btree (detail_cost_category_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_material_name_id ON public.boq_items USING btree (material_name_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_parent_work_item_id ON public.boq_items USING btree (parent_work_item_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_position_sort ON public.boq_items USING btree (client_position_id, sort_number);
CREATE INDEX IF NOT EXISTS idx_boq_items_tender_id ON public.boq_items USING btree (tender_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_work_name_id ON public.boq_items USING btree (work_name_id);

-- =============================================================================
-- client_positions
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_client_positions_is_additional ON public.client_positions USING btree (tender_id, is_additional);
CREATE INDEX IF NOT EXISTS idx_client_positions_parent_id ON public.client_positions USING btree (parent_position_id);
CREATE INDEX IF NOT EXISTS idx_client_positions_position_number ON public.client_positions USING btree (tender_id, position_number);
CREATE INDEX IF NOT EXISTS idx_client_positions_tender_id ON public.client_positions USING btree (tender_id);

-- =============================================================================
-- construction_cost_volumes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_construction_cost_volumes_detail_cost ON public.construction_cost_volumes USING btree (detail_cost_category_id);
CREATE INDEX IF NOT EXISTS idx_construction_cost_volumes_tender ON public.construction_cost_volumes USING btree (tender_id);

-- =============================================================================
-- cost_categories
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_cost_categories_created_at ON public.cost_categories USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_categories_name ON public.cost_categories USING btree (name);
CREATE INDEX IF NOT EXISTS idx_cost_categories_unit ON public.cost_categories USING btree (unit);

-- =============================================================================
-- cost_redistribution_results
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_redistribution_boq_item ON public.cost_redistribution_results USING btree (boq_item_id);
CREATE INDEX IF NOT EXISTS idx_redistribution_tender_tactic ON public.cost_redistribution_results USING btree (tender_id, markup_tactic_id);

-- =============================================================================
-- detail_cost_categories
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_detail_cost_categories_category_id ON public.detail_cost_categories USING btree (cost_category_id);
CREATE INDEX IF NOT EXISTS idx_detail_cost_categories_composite ON public.detail_cost_categories USING btree (cost_category_id, location);
CREATE INDEX IF NOT EXISTS idx_detail_cost_categories_location ON public.detail_cost_categories USING btree (location);
CREATE INDEX IF NOT EXISTS idx_detail_cost_categories_name ON public.detail_cost_categories USING btree (name);
CREATE INDEX IF NOT EXISTS idx_detail_cost_categories_order_num ON public.detail_cost_categories USING btree (order_num);
CREATE INDEX IF NOT EXISTS idx_detail_cost_categories_unit ON public.detail_cost_categories USING btree (unit);

-- =============================================================================
-- markup_parameters
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_markup_parameters_is_active ON public.markup_parameters USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_markup_parameters_key ON public.markup_parameters USING btree (key);
CREATE INDEX IF NOT EXISTS idx_markup_parameters_order_num ON public.markup_parameters USING btree (order_num);

-- =============================================================================
-- markup_tactics
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_markup_tactics_created_at ON public.markup_tactics USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_markup_tactics_is_global ON public.markup_tactics USING btree (is_global);
CREATE INDEX IF NOT EXISTS idx_markup_tactics_user_id ON public.markup_tactics USING btree (user_id);

-- =============================================================================
-- material_names
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_material_names_name ON public.material_names USING btree (name);
CREATE INDEX IF NOT EXISTS idx_material_names_unit ON public.material_names USING btree (unit);

-- =============================================================================
-- materials_library
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_materials_library_created_at ON public.materials_library USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_materials_library_currency_type ON public.materials_library USING btree (currency_type);
CREATE INDEX IF NOT EXISTS idx_materials_library_delivery_price_type ON public.materials_library USING btree (delivery_price_type);
CREATE INDEX IF NOT EXISTS idx_materials_library_item_type ON public.materials_library USING btree (item_type);
CREATE INDEX IF NOT EXISTS idx_materials_library_material_name_id ON public.materials_library USING btree (material_name_id);
CREATE INDEX IF NOT EXISTS idx_materials_library_material_type ON public.materials_library USING btree (material_type);
CREATE INDEX IF NOT EXISTS idx_materials_library_type_currency ON public.materials_library USING btree (material_type, currency_type);

-- =============================================================================
-- template_items
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_template_items_detail_cost_category_id ON public.template_items USING btree (detail_cost_category_id);
CREATE INDEX IF NOT EXISTS idx_template_items_kind ON public.template_items USING btree (kind);
CREATE INDEX IF NOT EXISTS idx_template_items_material_library_id ON public.template_items USING btree (material_library_id);
CREATE INDEX IF NOT EXISTS idx_template_items_parent_work_item_id ON public.template_items USING btree (parent_work_item_id);
CREATE INDEX IF NOT EXISTS idx_template_items_template_id ON public.template_items USING btree (template_id);
CREATE INDEX IF NOT EXISTS idx_template_items_work_library_id ON public.template_items USING btree (work_library_id);

-- =============================================================================
-- templates
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_templates_detail_cost_category_id ON public.templates USING btree (detail_cost_category_id);

-- =============================================================================
-- tender_documents
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_tender_documents_content_fts ON public.tender_documents USING gin (to_tsvector('russian'::regconfig, content_markdown));
CREATE INDEX IF NOT EXISTS idx_tender_documents_section ON public.tender_documents USING btree (section_type);
CREATE INDEX IF NOT EXISTS idx_tender_documents_tender ON public.tender_documents USING btree (tender_id);
CREATE INDEX IF NOT EXISTS idx_tender_documents_uploaded ON public.tender_documents USING btree (upload_date DESC);

-- =============================================================================
-- tender_markup_percentage
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_tender_markup_percentage_markup_parameter_id ON public.tender_markup_percentage USING btree (markup_parameter_id);
CREATE INDEX IF NOT EXISTS idx_tender_markup_percentage_tender_id ON public.tender_markup_percentage USING btree (tender_id);

-- =============================================================================
-- tender_pricing_distribution
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_tender_pricing_distribution_tactic_id ON public.tender_pricing_distribution USING btree (markup_tactic_id);
CREATE INDEX IF NOT EXISTS idx_tender_pricing_distribution_tender_id ON public.tender_pricing_distribution USING btree (tender_id);

-- =============================================================================
-- tenders
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_tenders_client_name ON public.tenders USING btree (client_name);
CREATE INDEX IF NOT EXISTS idx_tenders_created_at ON public.tenders USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenders_submission_deadline ON public.tenders USING btree (submission_deadline);
CREATE INDEX IF NOT EXISTS idx_tenders_tender_number ON public.tenders USING btree (tender_number);

-- =============================================================================
-- units
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_units_category ON public.units USING btree (category);
CREATE INDEX IF NOT EXISTS idx_units_is_active ON public.units USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_units_sort_order ON public.units USING btree (sort_order);

-- =============================================================================
-- user_tasks
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_user_tasks_status ON public.user_tasks USING btree (task_status);
CREATE INDEX IF NOT EXISTS idx_user_tasks_tender_id ON public.user_tasks USING btree (tender_id);
CREATE INDEX IF NOT EXISTS idx_user_tasks_user_id ON public.user_tasks USING btree (user_id);

-- =============================================================================
-- users
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_users_access_status ON public.users USING btree (access_status);
CREATE INDEX IF NOT EXISTS idx_users_approved_by ON public.users USING btree (approved_by);
CREATE INDEX IF NOT EXISTS idx_users_deadline_extensions ON public.users USING gin (tender_deadline_extensions);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users USING btree (email);
CREATE INDEX IF NOT EXISTS idx_users_role_code ON public.users USING btree (role_code);

-- =============================================================================
-- work_names
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_work_names_name ON public.work_names USING btree (name);
CREATE INDEX IF NOT EXISTS idx_work_names_unit ON public.work_names USING btree (unit);

-- =============================================================================
-- works_library
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_works_library_created_at ON public.works_library USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_works_library_currency_type ON public.works_library USING btree (currency_type);
CREATE INDEX IF NOT EXISTS idx_works_library_item_type ON public.works_library USING btree (item_type);
CREATE INDEX IF NOT EXISTS idx_works_library_type_currency ON public.works_library USING btree (item_type, currency_type);
CREATE INDEX IF NOT EXISTS idx_works_library_work_name_id ON public.works_library USING btree (work_name_id);

-- =============================================================================
-- FK-gap indexes added per Supabase Performance Advisor (unindexed_foreign_keys).
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_boq_items_unit_code ON public.boq_items(unit_code);
CREATE INDEX IF NOT EXISTS idx_client_positions_unit_code ON public.client_positions(unit_code);
CREATE INDEX IF NOT EXISTS idx_comparison_notes_tender_id_2 ON public.comparison_notes(tender_id_2);
CREATE INDEX IF NOT EXISTS idx_comparison_notes_created_by ON public.comparison_notes(created_by);
CREATE INDEX IF NOT EXISTS idx_cost_redistribution_created_by ON public.cost_redistribution_results(created_by);
CREATE INDEX IF NOT EXISTS idx_import_sessions_cancelled_by ON public.import_sessions(cancelled_by);
CREATE INDEX IF NOT EXISTS idx_subcontract_growth_detail_cost ON public.subcontract_growth_exclusions(detail_cost_category_id);
CREATE INDEX IF NOT EXISTS idx_tender_group_members_user_id ON public.tender_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tender_groups_quality_updated_by ON public.tender_groups(quality_updated_by);
CREATE INDEX IF NOT EXISTS idx_tender_iterations_manager_id ON public.tender_iterations(manager_id);
CREATE INDEX IF NOT EXISTS idx_tender_iterations_user_id ON public.tender_iterations(user_id);
CREATE INDEX IF NOT EXISTS idx_tender_registry_created_by ON public.tender_registry(created_by);
CREATE INDEX IF NOT EXISTS idx_tenders_created_by ON public.tenders(created_by);
CREATE INDEX IF NOT EXISTS idx_tenders_markup_tactic_id ON public.tenders(markup_tactic_id);
CREATE INDEX IF NOT EXISTS idx_user_position_filters_tender_id ON public.user_position_filters(tender_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_audit_item_date ON public.boq_items_audit(boq_item_id, changed_at DESC);
