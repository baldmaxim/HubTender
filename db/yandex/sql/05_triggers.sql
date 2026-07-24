-- =============================================================================
-- 05_triggers.sql — application business triggers.
--
-- Source: supabase/migrations/00000000000006_baseline_triggers.sql.
--
-- Scope: updated_at maintenance, BOQ audit, grand-total recalculation,
--        tender_registry auto-archive / auto-create. NO Supabase
--        realtime/storage triggers. The pg_notify `rowchange` triggers are NOT
--        here — they live in 07_pgnotify.sql.
--
-- Each trigger is DROP IF EXISTS + CREATE so a ranged --from/--to re-apply is
-- idempotent (CREATE TRIGGER has no OR REPLACE before PG 14 syntax norms).
-- =============================================================================

-- ----- boq_items ------------------------------------------------------------
DROP TRIGGER IF EXISTS boq_items_updated_at_trigger ON public.boq_items;
CREATE TRIGGER boq_items_updated_at_trigger
  BEFORE UPDATE ON public.boq_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_boq_items_audit ON public.boq_items;
CREATE TRIGGER trg_boq_items_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.boq_items
  FOR EACH ROW EXECUTE FUNCTION public.log_boq_items_changes();

DROP TRIGGER IF EXISTS trg_boq_items_grand_total ON public.boq_items;
CREATE TRIGGER trg_boq_items_grand_total
  AFTER INSERT OR DELETE OR UPDATE OF total_amount ON public.boq_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_boq_items_update_grand_total();

-- ----- client_positions -----------------------------------------------------
DROP TRIGGER IF EXISTS trigger_update_client_positions_updated_at ON public.client_positions;
CREATE TRIGGER trigger_update_client_positions_updated_at
  BEFORE UPDATE ON public.client_positions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- construction_cost_volumes -------------------------------------------
DROP TRIGGER IF EXISTS update_construction_cost_volumes_updated_at ON public.construction_cost_volumes;
CREATE TRIGGER update_construction_cost_volumes_updated_at
  BEFORE UPDATE ON public.construction_cost_volumes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- cost_categories ------------------------------------------------------
DROP TRIGGER IF EXISTS update_cost_categories_updated_at ON public.cost_categories;
CREATE TRIGGER update_cost_categories_updated_at
  BEFORE UPDATE ON public.cost_categories
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- cost_redistribution_results -----------------------------------------
DROP TRIGGER IF EXISTS trigger_update_cost_redistribution_results_updated_at ON public.cost_redistribution_results;
CREATE TRIGGER trigger_update_cost_redistribution_results_updated_at
  BEFORE UPDATE ON public.cost_redistribution_results
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- tender_fi_discounts --------------------------------------------------
DROP TRIGGER IF EXISTS trigger_update_tender_fi_discounts_updated_at ON public.tender_fi_discounts;
CREATE TRIGGER trigger_update_tender_fi_discounts_updated_at
  BEFORE UPDATE ON public.tender_fi_discounts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- detail_cost_categories ----------------------------------------------
DROP TRIGGER IF EXISTS update_detail_cost_categories_updated_at ON public.detail_cost_categories;
CREATE TRIGGER update_detail_cost_categories_updated_at
  BEFORE UPDATE ON public.detail_cost_categories
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- markup_parameters ----------------------------------------------------
DROP TRIGGER IF EXISTS trigger_update_markup_parameters_updated_at ON public.markup_parameters;
CREATE TRIGGER trigger_update_markup_parameters_updated_at
  BEFORE UPDATE ON public.markup_parameters
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- markup_tactics -------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_update_markup_tactics_updated_at ON public.markup_tactics;
CREATE TRIGGER trigger_update_markup_tactics_updated_at
  BEFORE UPDATE ON public.markup_tactics
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- material_names -------------------------------------------------------
DROP TRIGGER IF EXISTS update_material_names_updated_at ON public.material_names;
CREATE TRIGGER update_material_names_updated_at
  BEFORE UPDATE ON public.material_names
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- materials_library ----------------------------------------------------
DROP TRIGGER IF EXISTS update_materials_library_updated_at ON public.materials_library;
CREATE TRIGGER update_materials_library_updated_at
  BEFORE UPDATE ON public.materials_library
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- project_additional_agreements ---------------------------------------
DROP TRIGGER IF EXISTS update_project_additional_agreements_updated_at ON public.project_additional_agreements;
CREATE TRIGGER update_project_additional_agreements_updated_at
  BEFORE UPDATE ON public.project_additional_agreements
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- project_monthly_completion ------------------------------------------
DROP TRIGGER IF EXISTS update_project_monthly_completion_updated_at ON public.project_monthly_completion;
CREATE TRIGGER update_project_monthly_completion_updated_at
  BEFORE UPDATE ON public.project_monthly_completion
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- projects -------------------------------------------------------------
DROP TRIGGER IF EXISTS update_projects_updated_at ON public.projects;
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- roles ----------------------------------------------------------------
DROP TRIGGER IF EXISTS roles_updated_at_trigger ON public.roles;
CREATE TRIGGER roles_updated_at_trigger
  BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- subcontract_growth_exclusions ---------------------------------------
DROP TRIGGER IF EXISTS set_updated_at ON public.subcontract_growth_exclusions;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.subcontract_growth_exclusions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_subcontract_excl_grand_total ON public.subcontract_growth_exclusions;
CREATE TRIGGER trg_subcontract_excl_grand_total
  AFTER INSERT OR DELETE OR UPDATE ON public.subcontract_growth_exclusions
  FOR EACH ROW EXECUTE FUNCTION public.trg_subcontract_excl_update_grand_total();

-- ----- template_items -------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at_template_items ON public.template_items;
CREATE TRIGGER set_updated_at_template_items
  BEFORE UPDATE ON public.template_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- templates ------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at_templates ON public.templates;
CREATE TRIGGER set_updated_at_templates
  BEFORE UPDATE ON public.templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- tender_documents -----------------------------------------------------
DROP TRIGGER IF EXISTS trigger_update_tender_documents_timestamp ON public.tender_documents;
CREATE TRIGGER trigger_update_tender_documents_timestamp
  BEFORE UPDATE ON public.tender_documents
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- tender_groups --------------------------------------------------------
DROP TRIGGER IF EXISTS update_tender_groups_updated_at ON public.tender_groups;
CREATE TRIGGER update_tender_groups_updated_at
  BEFORE UPDATE ON public.tender_groups
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- tender_insurance -----------------------------------------------------
DROP TRIGGER IF EXISTS trg_insurance_grand_total ON public.tender_insurance;
CREATE TRIGGER trg_insurance_grand_total
  AFTER INSERT OR DELETE OR UPDATE ON public.tender_insurance
  FOR EACH ROW EXECUTE FUNCTION public.trg_insurance_update_grand_total();

DROP TRIGGER IF EXISTS update_tender_insurance_updated_at ON public.tender_insurance;
CREATE TRIGGER update_tender_insurance_updated_at
  BEFORE UPDATE ON public.tender_insurance
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- tender_iterations ----------------------------------------------------
DROP TRIGGER IF EXISTS update_tender_iterations_updated_at ON public.tender_iterations;
CREATE TRIGGER update_tender_iterations_updated_at
  BEFORE UPDATE ON public.tender_iterations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- tender_markup_percentage --------------------------------------------
DROP TRIGGER IF EXISTS trg_markup_pct_grand_total ON public.tender_markup_percentage;
CREATE TRIGGER trg_markup_pct_grand_total
  AFTER INSERT OR DELETE OR UPDATE ON public.tender_markup_percentage
  FOR EACH ROW EXECUTE FUNCTION public.trg_markup_pct_update_grand_total();

DROP TRIGGER IF EXISTS trigger_update_tender_markup_percentage_updated_at ON public.tender_markup_percentage;
CREATE TRIGGER trigger_update_tender_markup_percentage_updated_at
  BEFORE UPDATE ON public.tender_markup_percentage
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- tender_notes ---------------------------------------------------------
DROP TRIGGER IF EXISTS tender_notes_updated_at ON public.tender_notes;
CREATE TRIGGER tender_notes_updated_at
  BEFORE UPDATE ON public.tender_notes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- tender_pricing_distribution -----------------------------------------
DROP TRIGGER IF EXISTS set_updated_at_tender_pricing_distribution ON public.tender_pricing_distribution;
CREATE TRIGGER set_updated_at_tender_pricing_distribution
  BEFORE UPDATE ON public.tender_pricing_distribution
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- tender_registry ------------------------------------------------------
DROP TRIGGER IF EXISTS set_tender_registry_updated_at ON public.tender_registry;
CREATE TRIGGER set_tender_registry_updated_at
  BEFORE UPDATE ON public.tender_registry
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trigger_auto_archive_tender_registry ON public.tender_registry;
CREATE TRIGGER trigger_auto_archive_tender_registry
  BEFORE UPDATE ON public.tender_registry
  FOR EACH ROW
  WHEN (OLD.status_id IS DISTINCT FROM NEW.status_id)
  EXECUTE FUNCTION public.auto_archive_tender_registry();

-- ----- tenders --------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_auto_create_tender_registry ON public.tenders;
CREATE TRIGGER trigger_auto_create_tender_registry
  AFTER INSERT ON public.tenders
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_tender_registry();

DROP TRIGGER IF EXISTS update_tenders_updated_at ON public.tenders;
CREATE TRIGGER update_tenders_updated_at
  BEFORE UPDATE ON public.tenders
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- units ----------------------------------------------------------------
DROP TRIGGER IF EXISTS update_units_updated_at ON public.units;
CREATE TRIGGER update_units_updated_at
  BEFORE UPDATE ON public.units
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- user_tasks -----------------------------------------------------------
DROP TRIGGER IF EXISTS set_user_tasks_updated_at ON public.user_tasks;
CREATE TRIGGER set_user_tasks_updated_at
  BEFORE UPDATE ON public.user_tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- users ----------------------------------------------------------------
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- work_names -----------------------------------------------------------
DROP TRIGGER IF EXISTS update_work_names_updated_at ON public.work_names;
CREATE TRIGGER update_work_names_updated_at
  BEFORE UPDATE ON public.work_names
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- works_library --------------------------------------------------------
DROP TRIGGER IF EXISTS update_works_library_updated_at ON public.works_library;
CREATE TRIGGER update_works_library_updated_at
  BEFORE UPDATE ON public.works_library
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ----- quality_acknowledgements ---------------------------------------------
DROP TRIGGER IF EXISTS quality_acknowledgements_updated_at ON public.quality_acknowledgements;
CREATE TRIGGER quality_acknowledgements_updated_at
  BEFORE UPDATE ON public.quality_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
