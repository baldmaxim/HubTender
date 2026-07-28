-- =============================================================================
-- 2026_07_insurance_distribute_flag.sql — переключатель «Распределить во все
-- строки» для страхования от судимостей.
--
-- SCOPE: одна колонка public.tender_insurance.distribute_to_rows.
--
--   distribute_to_rows boolean — управляет ТОЛЬКО разнесением суммы страхования
--       по строкам заказчика на страницах «Перераспределение затрат» и «Форма КП»
--       (per-row insurance_share; см. src/services/redistributionPipeline/applyPipeline.ts).
--       По умолчанию TRUE — существующие тендеры сохраняют текущее поведение
--       (разнесение работало всегда). Флаг НЕ влияет на слагаемое страхования в
--       итоге «Финансовых показателей» и в tenders.cached_grand_total — там оно
--       учитывается отдельным скаляром всегда (recalculate_tender_grand_total).
--
-- Realtime: таблица несёт tender_id → generic-ветка public.notify_row_change()
-- (db/yandex/sql/07_pgnotify.sql) → топик `tender:<tender_id>` без правок бэкенда.
--
-- Transaction wrapping (BEGIN/COMMIT) выполняет apply-скрипт. Идемпотентно.
-- =============================================================================

ALTER TABLE public.tender_insurance
    ADD COLUMN IF NOT EXISTS distribute_to_rows boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- Redeploy public.clone_tender_as_new_version, чтобы клон новой версии копировал
-- distribute_to_rows. Тело — вербатим из db/yandex/sql/04_functions.sql
-- (единственное отличие от прежней версии — +колонка distribute_to_rows в
-- INSERT ... SELECT для public.tender_insurance).
-- (execute_version_transfer выполняется в Go — backend/internal/repository/
--  tender_transfer.go — и здесь не переразвёртывается.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clone_tender_as_new_version(p_source_tender_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
declare
  v_source public.tenders%rowtype;
  v_new public.tenders%rowtype;
  v_new_version integer;
  v_positions_copied integer := 0;
  v_boq_copied integer := 0;
  v_parent_links_restored integer := 0;
  v_position_parent_links_restored integer := 0;
  v_cost_volumes_copied integer := 0;
  v_insurance_rows_copied integer := 0;
  v_subcontract_exclusions_copied integer := 0;
  v_pricing_distribution_copied integer := 0;
  v_markup_percentage_copied integer := 0;
  v_documents_copied integer := 0;
  v_notes_copied integer := 0;
  v_groups_copied integer := 0;
begin
  select * into v_source from public.tenders where id = p_source_tender_id;
  if not found then
    raise exception 'Source tender % not found', p_source_tender_id;
  end if;

  select coalesce(max(version), 0) + 1
  into v_new_version
  from public.tenders
  where tender_number = v_source.tender_number;

  insert into public.tenders (
    title, description, client_name, tender_number, submission_deadline, version,
    area_client, area_sp, usd_rate, eur_rate, cny_rate, upload_folder, bsm_link,
    tz_link, qa_form_link, markup_tactic_id, apply_subcontract_works_growth,
    apply_subcontract_materials_growth, housing_class, construction_scope,
    project_folder_link, is_archived, volume_title
  )
  values (
    v_source.title, v_source.description, v_source.client_name,
    v_source.tender_number, v_source.submission_deadline, v_new_version,
    v_source.area_client, v_source.area_sp, v_source.usd_rate,
    v_source.eur_rate, v_source.cny_rate, v_source.upload_folder,
    v_source.bsm_link, v_source.tz_link, v_source.qa_form_link,
    v_source.markup_tactic_id, v_source.apply_subcontract_works_growth,
    v_source.apply_subcontract_materials_growth, v_source.housing_class,
    v_source.construction_scope, v_source.project_folder_link,
    v_source.is_archived, v_source.volume_title
  )
  returning * into v_new;

  -- Pre-generate new UUIDs for client_positions to make remapping deterministic.
  create temporary table tmp_cp_map on commit drop as
  select
    gen_random_uuid() as new_id,
    cp.id as old_id,
    cp.position_number, cp.item_no, cp.work_name, cp.unit_code, cp.volume,
    cp.client_note, cp.hierarchy_level, cp.is_additional, cp.parent_position_id,
    cp.manual_volume, cp.manual_note, cp.total_material, cp.total_works,
    cp.material_cost_per_unit, cp.work_cost_per_unit,
    cp.total_commercial_material, cp.total_commercial_work,
    cp.total_commercial_material_per_unit, cp.total_commercial_work_per_unit
  from public.client_positions cp
  where cp.tender_id = p_source_tender_id;

  insert into public.client_positions (
    id, tender_id, position_number, item_no, work_name, unit_code, volume,
    client_note, hierarchy_level, is_additional, parent_position_id,
    manual_volume, manual_note, total_material, total_works,
    material_cost_per_unit, work_cost_per_unit,
    total_commercial_material, total_commercial_work,
    total_commercial_material_per_unit, total_commercial_work_per_unit
  )
  select
    src.new_id, v_new.id, src.position_number, src.item_no, src.work_name,
    src.unit_code, src.volume, src.client_note, src.hierarchy_level,
    src.is_additional, null, src.manual_volume, src.manual_note,
    src.total_material, src.total_works, src.material_cost_per_unit,
    src.work_cost_per_unit, src.total_commercial_material,
    src.total_commercial_work, src.total_commercial_material_per_unit,
    src.total_commercial_work_per_unit
  from tmp_cp_map src;

  get diagnostics v_positions_copied = row_count;

  -- Restore parent_position_id (additional works link to their parent position).
  update public.client_positions target_cp
  set parent_position_id = parent_src.new_id
  from tmp_cp_map src
  join tmp_cp_map parent_src on parent_src.old_id = src.parent_position_id
  where target_cp.id = src.new_id and src.parent_position_id is not null;

  get diagnostics v_position_parent_links_restored = row_count;

  -- Pre-generate new UUIDs for boq_items.
  create temporary table tmp_boq_map on commit drop as
  select
    gen_random_uuid() as new_id,
    old_boq.id as old_id,
    cp_map.new_id as new_position_id,
    old_boq.sort_number, old_boq.boq_item_type, old_boq.material_type,
    old_boq.material_name_id, old_boq.work_name_id, old_boq.unit_code,
    old_boq.quantity, old_boq.base_quantity, old_boq.consumption_coefficient,
    old_boq.conversion_coefficient, old_boq.delivery_price_type,
    old_boq.delivery_amount, old_boq.currency_type, old_boq.total_amount,
    old_boq.detail_cost_category_id, old_boq.quote_link, old_boq.commercial_markup,
    old_boq.total_commercial_material_cost, old_boq.total_commercial_work_cost,
    old_boq.description, old_boq.unit_rate, old_boq.parent_work_item_id
  from public.boq_items old_boq
  join tmp_cp_map cp_map on cp_map.old_id = old_boq.client_position_id
  where old_boq.tender_id = p_source_tender_id;

  insert into public.boq_items (
    id, tender_id, client_position_id, sort_number, boq_item_type, material_type,
    material_name_id, work_name_id, unit_code, quantity, base_quantity,
    consumption_coefficient, conversion_coefficient, delivery_price_type,
    delivery_amount, currency_type, total_amount, detail_cost_category_id,
    quote_link, commercial_markup, total_commercial_material_cost,
    total_commercial_work_cost, parent_work_item_id, description, unit_rate
  )
  select
    src.new_id, v_new.id, src.new_position_id, src.sort_number,
    src.boq_item_type, src.material_type, src.material_name_id, src.work_name_id,
    src.unit_code, src.quantity, src.base_quantity, src.consumption_coefficient,
    src.conversion_coefficient, src.delivery_price_type, src.delivery_amount,
    src.currency_type, src.total_amount, src.detail_cost_category_id,
    src.quote_link, src.commercial_markup, src.total_commercial_material_cost,
    src.total_commercial_work_cost, null, src.description, src.unit_rate
  from tmp_boq_map src;

  get diagnostics v_boq_copied = row_count;

  -- Restore parent_work_item_id for materials linking to parent works.
  update public.boq_items target_boq
  set parent_work_item_id = parent_src.new_id
  from tmp_boq_map src
  join tmp_boq_map parent_src on parent_src.old_id = src.parent_work_item_id
  where target_boq.id = src.new_id and src.parent_work_item_id is not null;

  get diagnostics v_parent_links_restored = row_count;

  insert into public.construction_cost_volumes (tender_id, detail_cost_category_id, volume, group_key)
  select v_new.id, detail_cost_category_id, volume, group_key
  from public.construction_cost_volumes
  where tender_id = p_source_tender_id;
  get diagnostics v_cost_volumes_copied = row_count;

  insert into public.tender_insurance (
    tender_id, judicial_pct, total_pct, apt_price_m2, apt_area,
    parking_price_m2, parking_area, storage_price_m2, storage_area,
    distribute_to_rows
  )
  select
    v_new.id, judicial_pct, total_pct, apt_price_m2, apt_area,
    parking_price_m2, parking_area, storage_price_m2, storage_area,
    distribute_to_rows
  from public.tender_insurance
  where tender_id = p_source_tender_id
  on conflict (tender_id) do nothing;
  get diagnostics v_insurance_rows_copied = row_count;

  insert into public.subcontract_growth_exclusions (tender_id, detail_cost_category_id, exclusion_type)
  select v_new.id, detail_cost_category_id, exclusion_type
  from public.subcontract_growth_exclusions
  where tender_id = p_source_tender_id
  on conflict (tender_id, detail_cost_category_id, exclusion_type) do nothing;
  get diagnostics v_subcontract_exclusions_copied = row_count;

  insert into public.tender_pricing_distribution (
    tender_id, markup_tactic_id,
    basic_material_base_target, basic_material_markup_target,
    auxiliary_material_base_target, auxiliary_material_markup_target,
    work_base_target, work_markup_target,
    subcontract_basic_material_base_target, subcontract_basic_material_markup_target,
    subcontract_auxiliary_material_base_target, subcontract_auxiliary_material_markup_target,
    component_material_base_target, component_material_markup_target,
    component_work_base_target, component_work_markup_target
  )
  select
    v_new.id, markup_tactic_id,
    basic_material_base_target, basic_material_markup_target,
    auxiliary_material_base_target, auxiliary_material_markup_target,
    work_base_target, work_markup_target,
    subcontract_basic_material_base_target, subcontract_basic_material_markup_target,
    subcontract_auxiliary_material_base_target, subcontract_auxiliary_material_markup_target,
    component_material_base_target, component_material_markup_target,
    component_work_base_target, component_work_markup_target
  from public.tender_pricing_distribution
  where tender_id = p_source_tender_id
  on conflict (tender_id, markup_tactic_id) do nothing;
  get diagnostics v_pricing_distribution_copied = row_count;

  insert into public.tender_markup_percentage (tender_id, markup_parameter_id, value)
  select v_new.id, markup_parameter_id, value
  from public.tender_markup_percentage
  where tender_id = p_source_tender_id
  on conflict (tender_id, markup_parameter_id) do nothing;
  get diagnostics v_markup_percentage_copied = row_count;

  insert into public.tender_documents (
    tender_id, section_type, title, original_filename, content_markdown, file_size, upload_date
  )
  select v_new.id, section_type, title, original_filename, content_markdown, file_size, upload_date
  from public.tender_documents
  where tender_id = p_source_tender_id;
  get diagnostics v_documents_copied = row_count;

  insert into public.tender_notes (tender_id, user_id, note_text)
  select v_new.id, user_id, note_text
  from public.tender_notes
  where tender_id = p_source_tender_id;
  get diagnostics v_notes_copied = row_count;

  insert into public.tender_groups (
    tender_id, name, color, sort_order, quality_level, quality_comment,
    quality_updated_by, quality_updated_at
  )
  select
    v_new.id, name, color, sort_order, quality_level, quality_comment,
    quality_updated_by, quality_updated_at
  from public.tender_groups
  where tender_id = p_source_tender_id;
  get diagnostics v_groups_copied = row_count;

  return jsonb_build_object(
    'tenderId', v_new.id,
    'version', v_new_version,
    'positionsCopied', v_positions_copied,
    'positionParentLinksRestored', v_position_parent_links_restored,
    'boqItemsCopied', v_boq_copied,
    'parentLinksRestored', v_parent_links_restored,
    'costVolumesCopied', v_cost_volumes_copied,
    'insuranceRowsCopied', v_insurance_rows_copied,
    'subcontractExclusionsCopied', v_subcontract_exclusions_copied,
    'pricingDistributionCopied', v_pricing_distribution_copied,
    'markupPercentageCopied', v_markup_percentage_copied,
    'documentsCopied', v_documents_copied,
    'notesCopied', v_notes_copied,
    'groupsCopied', v_groups_copied
  );
end;
$function$;

