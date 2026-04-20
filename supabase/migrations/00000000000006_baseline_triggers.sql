-- Baseline migration 6/10: triggers.
-- Target: pre-prod project ocauafggjrqvopxjihas (TenderHUB_SU10 Prod).
-- Source: snapshot of wkywhjljrhewfpedbjzx (live prod) as of 2026-04-20.
-- All update_*_updated_at / update_updated_at_column / set_updated_at variants
-- are consolidated to call handle_updated_at() (created in migration 05).

-- =============================================================================
-- boq_items
-- =============================================================================

CREATE TRIGGER boq_items_updated_at_trigger
  BEFORE UPDATE ON public.boq_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_boq_items_audit
  AFTER INSERT OR DELETE OR UPDATE ON public.boq_items
  FOR EACH ROW EXECUTE FUNCTION public.log_boq_items_changes();

CREATE TRIGGER trg_boq_items_grand_total
  AFTER INSERT OR DELETE OR UPDATE OF total_amount ON public.boq_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_boq_items_update_grand_total();

-- =============================================================================
-- client_positions
-- =============================================================================

CREATE TRIGGER trigger_update_client_positions_updated_at
  BEFORE UPDATE ON public.client_positions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- construction_cost_volumes
-- =============================================================================

CREATE TRIGGER update_construction_cost_volumes_updated_at
  BEFORE UPDATE ON public.construction_cost_volumes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- cost_categories
-- =============================================================================

CREATE TRIGGER update_cost_categories_updated_at
  BEFORE UPDATE ON public.cost_categories
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- cost_redistribution_results
-- =============================================================================

CREATE TRIGGER trigger_update_cost_redistribution_results_updated_at
  BEFORE UPDATE ON public.cost_redistribution_results
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- detail_cost_categories
-- =============================================================================

CREATE TRIGGER update_detail_cost_categories_updated_at
  BEFORE UPDATE ON public.detail_cost_categories
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- markup_parameters
-- =============================================================================

CREATE TRIGGER trigger_update_markup_parameters_updated_at
  BEFORE UPDATE ON public.markup_parameters
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- markup_tactics
-- =============================================================================

CREATE TRIGGER trigger_update_markup_tactics_updated_at
  BEFORE UPDATE ON public.markup_tactics
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- material_names
-- =============================================================================

CREATE TRIGGER update_material_names_updated_at
  BEFORE UPDATE ON public.material_names
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- materials_library
-- =============================================================================

CREATE TRIGGER update_materials_library_updated_at
  BEFORE UPDATE ON public.materials_library
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- project_additional_agreements
-- =============================================================================

CREATE TRIGGER update_project_additional_agreements_updated_at
  BEFORE UPDATE ON public.project_additional_agreements
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- project_monthly_completion
-- =============================================================================

CREATE TRIGGER update_project_monthly_completion_updated_at
  BEFORE UPDATE ON public.project_monthly_completion
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- projects
-- =============================================================================

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- roles
-- =============================================================================

CREATE TRIGGER roles_updated_at_trigger
  BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- subcontract_growth_exclusions
-- =============================================================================

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.subcontract_growth_exclusions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_subcontract_excl_grand_total
  AFTER INSERT OR DELETE OR UPDATE ON public.subcontract_growth_exclusions
  FOR EACH ROW EXECUTE FUNCTION public.trg_subcontract_excl_update_grand_total();

-- =============================================================================
-- template_items
-- =============================================================================

CREATE TRIGGER set_updated_at_template_items
  BEFORE UPDATE ON public.template_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- templates
-- =============================================================================

CREATE TRIGGER set_updated_at_templates
  BEFORE UPDATE ON public.templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- tender_documents
-- =============================================================================

CREATE TRIGGER trigger_update_tender_documents_timestamp
  BEFORE UPDATE ON public.tender_documents
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- tender_groups
-- =============================================================================

CREATE TRIGGER update_tender_groups_updated_at
  BEFORE UPDATE ON public.tender_groups
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- tender_insurance
-- =============================================================================

CREATE TRIGGER trg_insurance_grand_total
  AFTER INSERT OR DELETE OR UPDATE ON public.tender_insurance
  FOR EACH ROW EXECUTE FUNCTION public.trg_insurance_update_grand_total();

CREATE TRIGGER update_tender_insurance_updated_at
  BEFORE UPDATE ON public.tender_insurance
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- tender_iterations
-- =============================================================================

CREATE TRIGGER update_tender_iterations_updated_at
  BEFORE UPDATE ON public.tender_iterations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- tender_markup_percentage
-- =============================================================================

CREATE TRIGGER trg_markup_pct_grand_total
  AFTER INSERT OR DELETE OR UPDATE ON public.tender_markup_percentage
  FOR EACH ROW EXECUTE FUNCTION public.trg_markup_pct_update_grand_total();

CREATE TRIGGER trigger_update_tender_markup_percentage_updated_at
  BEFORE UPDATE ON public.tender_markup_percentage
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- tender_notes
-- =============================================================================

CREATE TRIGGER tender_notes_updated_at
  BEFORE UPDATE ON public.tender_notes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- tender_pricing_distribution
-- =============================================================================

CREATE TRIGGER set_updated_at_tender_pricing_distribution
  BEFORE UPDATE ON public.tender_pricing_distribution
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- tender_registry
-- =============================================================================

CREATE TRIGGER set_tender_registry_updated_at
  BEFORE UPDATE ON public.tender_registry
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trigger_auto_archive_tender_registry
  BEFORE UPDATE ON public.tender_registry
  FOR EACH ROW
  WHEN (OLD.status_id IS DISTINCT FROM NEW.status_id)
  EXECUTE FUNCTION public.auto_archive_tender_registry();

-- =============================================================================
-- tenders
-- =============================================================================

CREATE TRIGGER trigger_auto_create_tender_registry
  AFTER INSERT ON public.tenders
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_tender_registry();

CREATE TRIGGER update_tenders_updated_at
  BEFORE UPDATE ON public.tenders
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- units
-- =============================================================================

CREATE TRIGGER update_units_updated_at
  BEFORE UPDATE ON public.units
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- user_tasks
-- =============================================================================

CREATE TRIGGER set_user_tasks_updated_at
  BEFORE UPDATE ON public.user_tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- users
-- =============================================================================

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- work_names
-- =============================================================================

CREATE TRIGGER update_work_names_updated_at
  BEFORE UPDATE ON public.work_names
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =============================================================================
-- works_library
-- =============================================================================

CREATE TRIGGER update_works_library_updated_at
  BEFORE UPDATE ON public.works_library
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
