-- Baseline migration 3/10: foreign keys and unique constraints.
-- Target: pre-prod project ocauafggjrqvopxjihas (TenderHUB_SU10 Prod).
-- Source: snapshot of wkywhjljrhewfpedbjzx (live prod) as of 2026-04-20.

-- =============================================================================
-- UNIQUE constraints (named to match live prod).
-- =============================================================================

ALTER TABLE public.roles ADD CONSTRAINT roles_name_key UNIQUE (name);
ALTER TABLE public.users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE public.construction_scopes ADD CONSTRAINT construction_scopes_name_key UNIQUE (name);
ALTER TABLE public.tender_statuses ADD CONSTRAINT tender_statuses_name_key UNIQUE (name);
ALTER TABLE public.markup_parameters ADD CONSTRAINT markup_parameters_key_key UNIQUE (key);
ALTER TABLE public.tenders ADD CONSTRAINT tenders_tender_number_version_key UNIQUE (tender_number, version);
ALTER TABLE public.tender_groups ADD CONSTRAINT tender_groups_tender_id_name_key UNIQUE (tender_id, name);
ALTER TABLE public.tender_group_members ADD CONSTRAINT tender_group_members_group_id_user_id_key UNIQUE (group_id, user_id);
ALTER TABLE public.tender_iterations ADD CONSTRAINT tender_iterations_group_id_user_id_iteration_number_key UNIQUE (group_id, user_id, iteration_number);
ALTER TABLE public.tender_insurance ADD CONSTRAINT tender_insurance_tender_id_unique UNIQUE (tender_id);
ALTER TABLE public.tender_markup_percentage ADD CONSTRAINT tender_markup_percentage_unique UNIQUE (tender_id, markup_parameter_id);
ALTER TABLE public.tender_notes ADD CONSTRAINT tender_notes_tender_id_user_id_key UNIQUE (tender_id, user_id);
ALTER TABLE public.tender_pricing_distribution ADD CONSTRAINT tender_pricing_distribution_tender_id_markup_tactic_id_key UNIQUE (tender_id, markup_tactic_id);
ALTER TABLE public.subcontract_growth_exclusions ADD CONSTRAINT subcontract_growth_exclusions_unique UNIQUE (tender_id, detail_cost_category_id, exclusion_type);
ALTER TABLE public.project_monthly_completion ADD CONSTRAINT project_monthly_completion_unique UNIQUE (project_id, year, month);
ALTER TABLE public.comparison_notes ADD CONSTRAINT comparison_notes_tender_id_1_tender_id_2_cost_category_name_key UNIQUE (tender_id_1, tender_id_2, cost_category_name, detail_category_key);
ALTER TABLE public.tender_documents ADD CONSTRAINT unique_tender_section_file UNIQUE (tender_id, section_type, original_filename);
ALTER TABLE public.cost_redistribution_results ADD CONSTRAINT uq_cost_redistribution_results_tender_tactic_boq UNIQUE (tender_id, markup_tactic_id, boq_item_id);
ALTER TABLE public.user_position_filters ADD CONSTRAINT unique_user_tender_position UNIQUE (user_id, tender_id, position_id);

-- =============================================================================
-- FOREIGN KEYS: users (self / auth / roles).
-- =============================================================================

ALTER TABLE public.users ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.users ADD CONSTRAINT users_role_code_fkey FOREIGN KEY (role_code) REFERENCES public.roles(code);
ALTER TABLE public.users ADD CONSTRAINT users_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);

-- =============================================================================
-- FOREIGN KEYS: cost_categories / detail_cost_categories.
-- =============================================================================

ALTER TABLE public.cost_categories ADD CONSTRAINT cost_categories_unit_fkey FOREIGN KEY (unit) REFERENCES public.units(code);
ALTER TABLE public.detail_cost_categories ADD CONSTRAINT detail_cost_categories_cost_category_id_fkey FOREIGN KEY (cost_category_id) REFERENCES public.cost_categories(id);
ALTER TABLE public.detail_cost_categories ADD CONSTRAINT detail_cost_categories_unit_fkey FOREIGN KEY (unit) REFERENCES public.units(code);

-- =============================================================================
-- FOREIGN KEYS: material_names / work_names.
-- =============================================================================

ALTER TABLE public.material_names ADD CONSTRAINT material_names_unit_fkey FOREIGN KEY (unit) REFERENCES public.units(code);
ALTER TABLE public.work_names ADD CONSTRAINT work_names_unit_fkey FOREIGN KEY (unit) REFERENCES public.units(code);

-- =============================================================================
-- FOREIGN KEYS: libraries.
-- =============================================================================

ALTER TABLE public.library_folders ADD CONSTRAINT library_folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.library_folders(id) ON DELETE CASCADE;
ALTER TABLE public.materials_library ADD CONSTRAINT materials_library_material_name_id_fkey FOREIGN KEY (material_name_id) REFERENCES public.material_names(id);
ALTER TABLE public.materials_library ADD CONSTRAINT materials_library_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.library_folders(id) ON DELETE SET NULL;
ALTER TABLE public.works_library ADD CONSTRAINT works_library_work_name_id_fkey FOREIGN KEY (work_name_id) REFERENCES public.work_names(id);
ALTER TABLE public.works_library ADD CONSTRAINT works_library_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.library_folders(id) ON DELETE SET NULL;

-- =============================================================================
-- FOREIGN KEYS: tenders.
-- =============================================================================

ALTER TABLE public.tenders ADD CONSTRAINT tenders_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.tenders ADD CONSTRAINT tenders_markup_tactic_id_fkey FOREIGN KEY (markup_tactic_id) REFERENCES public.markup_tactics(id);

-- =============================================================================
-- FOREIGN KEYS: markup_tactics.
-- =============================================================================

ALTER TABLE public.markup_tactics ADD CONSTRAINT markup_tactics_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

-- =============================================================================
-- FOREIGN KEYS: tender_registry.
-- =============================================================================

ALTER TABLE public.tender_registry ADD CONSTRAINT tender_registry_status_id_fkey FOREIGN KEY (status_id) REFERENCES public.tender_statuses(id);
ALTER TABLE public.tender_registry ADD CONSTRAINT tender_registry_construction_scope_id_fkey FOREIGN KEY (construction_scope_id) REFERENCES public.construction_scopes(id);
ALTER TABLE public.tender_registry ADD CONSTRAINT tender_registry_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

-- =============================================================================
-- FOREIGN KEYS: client_positions.
-- =============================================================================

ALTER TABLE public.client_positions ADD CONSTRAINT client_positions_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE;
ALTER TABLE public.client_positions ADD CONSTRAINT client_positions_parent_position_id_fkey FOREIGN KEY (parent_position_id) REFERENCES public.client_positions(id) ON DELETE CASCADE;
ALTER TABLE public.client_positions ADD CONSTRAINT client_positions_unit_code_fkey FOREIGN KEY (unit_code) REFERENCES public.units(code);

-- =============================================================================
-- FOREIGN KEYS: boq_items and audit.
-- =============================================================================

ALTER TABLE public.boq_items ADD CONSTRAINT boq_items_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE;
ALTER TABLE public.boq_items ADD CONSTRAINT boq_items_client_position_id_fkey FOREIGN KEY (client_position_id) REFERENCES public.client_positions(id) ON DELETE CASCADE;
ALTER TABLE public.boq_items ADD CONSTRAINT boq_items_material_name_id_fkey FOREIGN KEY (material_name_id) REFERENCES public.material_names(id);
ALTER TABLE public.boq_items ADD CONSTRAINT boq_items_work_name_id_fkey FOREIGN KEY (work_name_id) REFERENCES public.work_names(id);
ALTER TABLE public.boq_items ADD CONSTRAINT boq_items_unit_code_fkey FOREIGN KEY (unit_code) REFERENCES public.units(code);
ALTER TABLE public.boq_items ADD CONSTRAINT boq_items_detail_cost_category_id_fkey FOREIGN KEY (detail_cost_category_id) REFERENCES public.detail_cost_categories(id);
ALTER TABLE public.boq_items ADD CONSTRAINT boq_items_parent_work_item_id_fkey FOREIGN KEY (parent_work_item_id) REFERENCES public.boq_items(id) ON DELETE CASCADE;
ALTER TABLE public.boq_items ADD CONSTRAINT boq_items_import_session_id_fkey FOREIGN KEY (import_session_id) REFERENCES public.import_sessions(id) ON DELETE SET NULL;
ALTER TABLE public.boq_items_audit ADD CONSTRAINT boq_items_audit_boq_item_id_fkey FOREIGN KEY (boq_item_id) REFERENCES public.boq_items(id) ON DELETE CASCADE;
ALTER TABLE public.boq_items_audit ADD CONSTRAINT boq_items_audit_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);

-- =============================================================================
-- FOREIGN KEYS: import_sessions.
-- =============================================================================

ALTER TABLE public.import_sessions ADD CONSTRAINT import_sessions_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE;
ALTER TABLE public.import_sessions ADD CONSTRAINT import_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE public.import_sessions ADD CONSTRAINT import_sessions_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES auth.users(id);

-- =============================================================================
-- FOREIGN KEYS: templates / template_items.
-- =============================================================================

ALTER TABLE public.templates ADD CONSTRAINT templates_detail_cost_category_id_fkey FOREIGN KEY (detail_cost_category_id) REFERENCES public.detail_cost_categories(id);
ALTER TABLE public.templates ADD CONSTRAINT templates_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.library_folders(id) ON DELETE SET NULL;
ALTER TABLE public.template_items ADD CONSTRAINT template_items_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE CASCADE;
ALTER TABLE public.template_items ADD CONSTRAINT template_items_work_library_id_fkey FOREIGN KEY (work_library_id) REFERENCES public.works_library(id);
ALTER TABLE public.template_items ADD CONSTRAINT template_items_material_library_id_fkey FOREIGN KEY (material_library_id) REFERENCES public.materials_library(id);
ALTER TABLE public.template_items ADD CONSTRAINT template_items_parent_work_item_id_fkey FOREIGN KEY (parent_work_item_id) REFERENCES public.template_items(id) ON DELETE CASCADE;
ALTER TABLE public.template_items ADD CONSTRAINT template_items_detail_cost_category_id_fkey FOREIGN KEY (detail_cost_category_id) REFERENCES public.detail_cost_categories(id);

-- =============================================================================
-- FOREIGN KEYS: construction_cost_volumes.
-- =============================================================================

ALTER TABLE public.construction_cost_volumes ADD CONSTRAINT construction_cost_volumes_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE;
ALTER TABLE public.construction_cost_volumes ADD CONSTRAINT construction_cost_volumes_detail_cost_category_id_fkey FOREIGN KEY (detail_cost_category_id) REFERENCES public.detail_cost_categories(id) ON DELETE CASCADE;

-- =============================================================================
-- FOREIGN KEYS: tender_insurance / tender_markup / tender_notes / tender_pricing / tender_documents.
-- =============================================================================

ALTER TABLE public.tender_insurance ADD CONSTRAINT tender_insurance_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE;
ALTER TABLE public.tender_markup_percentage ADD CONSTRAINT tender_markup_percentage_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE;
ALTER TABLE public.tender_markup_percentage ADD CONSTRAINT tender_markup_percentage_markup_parameter_id_fkey FOREIGN KEY (markup_parameter_id) REFERENCES public.markup_parameters(id) ON DELETE CASCADE;
ALTER TABLE public.tender_notes ADD CONSTRAINT tender_notes_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE;
ALTER TABLE public.tender_notes ADD CONSTRAINT tender_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.tender_pricing_distribution ADD CONSTRAINT tender_pricing_distribution_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE;
ALTER TABLE public.tender_pricing_distribution ADD CONSTRAINT tender_pricing_distribution_markup_tactic_id_fkey FOREIGN KEY (markup_tactic_id) REFERENCES public.markup_tactics(id) ON DELETE SET NULL;
ALTER TABLE public.tender_documents ADD CONSTRAINT tender_documents_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE;

-- =============================================================================
-- FOREIGN KEYS: subcontract_growth_exclusions / user_tasks / user_position_filters.
-- =============================================================================

ALTER TABLE public.subcontract_growth_exclusions ADD CONSTRAINT subcontract_growth_exclusions_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE;
ALTER TABLE public.subcontract_growth_exclusions ADD CONSTRAINT subcontract_growth_exclusions_detail_cost_category_id_fkey FOREIGN KEY (detail_cost_category_id) REFERENCES public.detail_cost_categories(id) ON DELETE CASCADE;
ALTER TABLE public.user_tasks ADD CONSTRAINT user_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_tasks ADD CONSTRAINT user_tasks_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE SET NULL;
ALTER TABLE public.user_position_filters ADD CONSTRAINT user_position_filters_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_position_filters ADD CONSTRAINT user_position_filters_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE;
ALTER TABLE public.user_position_filters ADD CONSTRAINT user_position_filters_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.client_positions(id) ON DELETE CASCADE;

-- =============================================================================
-- FOREIGN KEYS: comparison_notes / cost_redistribution_results.
-- =============================================================================

ALTER TABLE public.comparison_notes ADD CONSTRAINT comparison_notes_tender_id_1_fkey FOREIGN KEY (tender_id_1) REFERENCES public.tenders(id) ON DELETE CASCADE;
ALTER TABLE public.comparison_notes ADD CONSTRAINT comparison_notes_tender_id_2_fkey FOREIGN KEY (tender_id_2) REFERENCES public.tenders(id) ON DELETE CASCADE;
ALTER TABLE public.comparison_notes ADD CONSTRAINT comparison_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.cost_redistribution_results ADD CONSTRAINT cost_redistribution_results_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE;
ALTER TABLE public.cost_redistribution_results ADD CONSTRAINT cost_redistribution_results_markup_tactic_id_fkey FOREIGN KEY (markup_tactic_id) REFERENCES public.markup_tactics(id) ON DELETE CASCADE;
ALTER TABLE public.cost_redistribution_results ADD CONSTRAINT cost_redistribution_results_boq_item_id_fkey FOREIGN KEY (boq_item_id) REFERENCES public.boq_items(id) ON DELETE CASCADE;
ALTER TABLE public.cost_redistribution_results ADD CONSTRAINT cost_redistribution_results_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

-- =============================================================================
-- FOREIGN KEYS: projects.
-- =============================================================================

ALTER TABLE public.projects ADD CONSTRAINT projects_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id);
ALTER TABLE public.projects ADD CONSTRAINT projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
ALTER TABLE public.project_additional_agreements ADD CONSTRAINT project_additional_agreements_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.project_monthly_completion ADD CONSTRAINT project_monthly_completion_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

-- =============================================================================
-- FOREIGN KEYS: tender_groups / tender_group_members / tender_iterations.
-- =============================================================================

ALTER TABLE public.tender_groups ADD CONSTRAINT tender_groups_tender_id_fkey FOREIGN KEY (tender_id) REFERENCES public.tenders(id) ON DELETE CASCADE;
ALTER TABLE public.tender_groups ADD CONSTRAINT tender_groups_quality_updated_by_fkey FOREIGN KEY (quality_updated_by) REFERENCES public.users(id);
ALTER TABLE public.tender_group_members ADD CONSTRAINT tender_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.tender_groups(id) ON DELETE CASCADE;
ALTER TABLE public.tender_group_members ADD CONSTRAINT tender_group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.tender_iterations ADD CONSTRAINT tender_iterations_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.tender_groups(id) ON DELETE CASCADE;
ALTER TABLE public.tender_iterations ADD CONSTRAINT tender_iterations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.tender_iterations ADD CONSTRAINT tender_iterations_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.users(id);
