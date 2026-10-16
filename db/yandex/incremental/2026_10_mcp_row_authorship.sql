-- =============================================================================
-- 2026_10_mcp_row_authorship.sql — авторство строк ВОР и журнал ГП для MCP.
--
-- SCOPE:
--   1. boq_audit_counts_as_authorship / boq_item_last_authorship — «последний
--      автор» строки ВОР по boq_items_audit: последнее изменение под учёткой
--      пользователя. Пересчёты автором не делают: итог строки, коммерция,
--      порядок строк, количество привязанного материала от его работы.
--   2. client_position_gp_audit + триггер — журнал количества и примечания ГП
--      (кто, когда, было → стало; request_key записи через MCP).
--   3. copy_boq_item_authorship / copy_position_gp_authorship — перенос
--      последнего автора строк и ГП в новую версию тендера. Тот, кто создаёт
--      версию или выполняет перенос, автором чужих строк не становится.
--   4. clone_tender_as_new_version — «Новая версия» пишет в аудит автора из
--      предыдущей версии (пометка changed_fields = {version_copy}) вместо
--      «Системной операции» от триггера на каждую строку.
--
-- ЗАЧЕМ: через MCP можно менять и удалять только строки и ГП, которые последним
-- менял сам пользователь (docs/mcp/AUTHORSHIP.md). Портал не ограничивается.
--
-- ИДЕМПОТЕНТНО: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS.
-- Существующие данные не переписываются, обратного заполнения нет.
--
-- ПОРЯДОК ВЫКАТКИ: миграция → бэкенд → фронтенд. Старый бэкенд с этой
-- миграцией работает: журнал ГП пишет изменения, «Новая версия» переносит
-- авторов. Остановка портала не нужна.
--
-- БЛОКИРОВКИ: CREATE TRIGGER на client_positions держит SHARE ROW EXCLUSIVE
-- доли секунды; новая таблица пустая; индексы по большим таблицам не создаются.
--
-- Каноничный аналог: 03_tables.sql, 04_functions.sql, 05_triggers.sql,
-- 06_indexes_constraints.sql.
-- =============================================================================

BEGIN;

-- ─── Авторство строки ВОР ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.boq_audit_counts_as_authorship(
    p_operation text, p_fields text[], p_new_data jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN p_operation = 'INSERT' THEN true
    WHEN p_operation <> 'UPDATE' THEN false
    -- UPDATE без списка полей пишет бэкенд, когда пересчёт ничего не изменил
    -- (changedFields пуст): например, пересчёт привязанных материалов при смене
    -- цены работы. Триггерный аудит пустые правки не пишет вовсе.
    WHEN p_fields IS NULL THEN false
    WHEN p_fields <@ ARRAY['total_amount', 'sort_number', 'updated_at', 'created_at',
                           'commercial_markup', 'total_commercial_material_cost',
                           'total_commercial_work_cost']::text[] THEN false
    -- Количество привязанного материала сервер пересчитывает от его работы.
    WHEN (p_new_data ->> 'parent_work_item_id') IS NOT NULL
     AND p_fields <@ ARRAY['quantity', 'base_quantity', 'total_amount', 'sort_number',
                           'updated_at', 'created_at', 'commercial_markup',
                           'total_commercial_material_cost',
                           'total_commercial_work_cost']::text[] THEN false
    ELSE true
  END
$function$;

COMMENT ON FUNCTION public.boq_audit_counts_as_authorship(text, text[], jsonb) IS
    'Делает ли запись boq_items_audit её автора автором строки: добавление и правка входных полей — да; пересчёты (итог, коммерция, порядок, количество привязанного материала) — нет.';

CREATE OR REPLACE FUNCTION public.boq_item_last_authorship(p_item uuid)
RETURNS TABLE (changed_by uuid, changed_at timestamptz)
LANGUAGE sql
STABLE
AS $function$
  SELECT a.changed_by, a.changed_at
  FROM public.boq_items_audit a
  WHERE a.boq_item_id = p_item
    AND a.changed_by IS NOT NULL
    AND public.boq_audit_counts_as_authorship(a.operation_type, a.changed_fields, a.new_data)
  ORDER BY a.changed_at DESC, a.id DESC
  LIMIT 1
$function$;

COMMENT ON FUNCTION public.boq_item_last_authorship(uuid) IS
    'Последний автор строки ВОР: последнее добавление/правка под учёткой пользователя. Нет строки — автора нет («Системная операция»).';

-- ─── Журнал ГП ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_position_gp_audit (
    id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
    client_position_id uuid        NOT NULL,
    tender_id          uuid        NOT NULL,
    changed_by         uuid,
    origin             text        NOT NULL DEFAULT 'edit',
    request_key        text,
    old_manual_volume  numeric,
    new_manual_volume  numeric,
    old_manual_note    text,
    new_manual_note    text,
    changed_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT client_position_gp_audit_pkey PRIMARY KEY (id),
    CONSTRAINT client_position_gp_audit_origin_check CHECK (origin IN ('edit', 'version_copy')),
    CONSTRAINT client_position_gp_audit_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id)
);

COMMENT ON TABLE public.client_position_gp_audit IS
    'Журнал количества и примечания ГП: кто, когда, было → стало. edit — изменение (портал, импорт, MCP); version_copy — автор перенесён из предыдущей версии тендера. Без FK на позицию: история остаётся после удаления.';

CREATE INDEX IF NOT EXISTS client_position_gp_audit_position_idx
    ON public.client_position_gp_audit (client_position_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.log_client_position_gp_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  -- Перенос версии пишет авторов из предыдущей версии сам
  -- (copy_position_gp_authorship), без записи от имени того, кто переносит.
  IF current_setting('app.skip_gp_audit', true) = 'on' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_user_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  INSERT INTO public.client_position_gp_audit (
    client_position_id, tender_id, changed_by, origin, request_key,
    old_manual_volume, new_manual_volume, old_manual_note, new_manual_note
  ) VALUES (
    NEW.id, NEW.tender_id, v_user_id, 'edit',
    NULLIF(current_setting('app.pricing_request_key', true), ''),
    OLD.manual_volume, NEW.manual_volume, OLD.manual_note, NEW.manual_note
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_client_positions_gp_audit ON public.client_positions;
CREATE TRIGGER trg_client_positions_gp_audit
    AFTER UPDATE OF manual_volume, manual_note ON public.client_positions
    FOR EACH ROW
    WHEN (OLD.manual_volume IS DISTINCT FROM NEW.manual_volume
          OR OLD.manual_note IS DISTINCT FROM NEW.manual_note)
    EXECUTE FUNCTION public.log_client_position_gp_change();

CREATE OR REPLACE FUNCTION public.client_position_gp_last_authorship(p_position uuid, p_field text)
RETURNS TABLE (changed_by uuid, changed_at timestamptz)
LANGUAGE sql
STABLE
AS $function$
  SELECT g.changed_by, g.changed_at
  FROM public.client_position_gp_audit g
  WHERE g.client_position_id = p_position
    AND g.changed_by IS NOT NULL
    AND CASE p_field
          WHEN 'volume' THEN g.old_manual_volume IS DISTINCT FROM g.new_manual_volume
          WHEN 'note'   THEN g.old_manual_note IS DISTINCT FROM g.new_manual_note
          ELSE false
        END
  ORDER BY g.changed_at DESC, g.id DESC
  LIMIT 1
$function$;

COMMENT ON FUNCTION public.client_position_gp_last_authorship(uuid, text) IS
    'Последний автор количества (volume) или примечания (note) ГП позиции по client_position_gp_audit.';

-- ─── Перенос авторства в новую версию ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.copy_boq_item_authorship(p_old_ids uuid[], p_new_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- Одна запись на скопированную строку: автор и время его последнего
  -- изменения в предыдущей версии. Нет автора — запись «Системная операция»,
  -- как раньше писал триггер. Полная история остаётся у исходной строки.
  INSERT INTO public.boq_items_audit (
    boq_item_id, operation_type, changed_by, old_data, new_data, changed_fields, changed_at
  )
  SELECT b.id, 'INSERT', la.changed_by, NULL, to_jsonb(b.*),
         ARRAY['version_copy']::text[], COALESCE(la.changed_at, now())
  FROM unnest(p_old_ids, p_new_ids) AS m(old_id, new_id)
  JOIN public.boq_items b ON b.id = m.new_id
  LEFT JOIN LATERAL public.boq_item_last_authorship(m.old_id) la ON true;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION public.copy_boq_item_authorship(uuid[], uuid[]) IS
    'Пишет в boq_items_audit для каждой новой строки копии автора исходной строки (changed_fields = {version_copy}). Вызывать при выключенном триггерном аудите (app.skip_boq_audit = on).';

CREATE OR REPLACE FUNCTION public.copy_position_gp_authorship(p_old_ids uuid[], p_new_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_volumes integer;
  v_notes integer;
BEGIN
  INSERT INTO public.client_position_gp_audit (
    client_position_id, tender_id, changed_by, origin, old_manual_volume, new_manual_volume, changed_at
  )
  SELECT cp.id, cp.tender_id, g.changed_by, 'version_copy', NULL, cp.manual_volume, g.changed_at
  FROM unnest(p_old_ids, p_new_ids) AS m(old_id, new_id)
  JOIN public.client_positions cp ON cp.id = m.new_id
  JOIN LATERAL public.client_position_gp_last_authorship(m.old_id, 'volume') g ON true
  WHERE cp.manual_volume IS NOT NULL;
  GET DIAGNOSTICS v_volumes = ROW_COUNT;

  INSERT INTO public.client_position_gp_audit (
    client_position_id, tender_id, changed_by, origin, old_manual_note, new_manual_note, changed_at
  )
  SELECT cp.id, cp.tender_id, g.changed_by, 'version_copy', NULL, cp.manual_note, g.changed_at
  FROM unnest(p_old_ids, p_new_ids) AS m(old_id, new_id)
  JOIN public.client_positions cp ON cp.id = m.new_id
  JOIN LATERAL public.client_position_gp_last_authorship(m.old_id, 'note') g ON true
  WHERE cp.manual_note IS NOT NULL AND cp.manual_note <> '';
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  RETURN v_volumes + v_notes;
END;
$function$;

COMMENT ON FUNCTION public.copy_position_gp_authorship(uuid[], uuid[]) IS
    'Переносит последнего автора количества и примечания ГП из исходных позиций в новые (origin = version_copy).';

-- ─── «Новая версия» переносит авторов ────────────────────────────────────────

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
  v_boq_authorship_copied integer := 0;
  v_gp_authorship_copied integer := 0;
  v_prev_skip_audit text;
  v_old_ids uuid[];
  v_new_ids uuid[];
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

  -- Автор количества и примечания ГП переходит из предыдущей версии.
  select array_agg(old_id order by new_id), array_agg(new_id order by new_id)
  into v_old_ids, v_new_ids
  from tmp_cp_map;
  v_gp_authorship_copied := public.copy_position_gp_authorship(
    coalesce(v_old_ids, '{}'), coalesce(v_new_ids, '{}'));

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

  -- Триггерный аудит записал бы «Системную операцию» на каждую строку копии;
  -- вместо этого copy_boq_item_authorship переносит автора из предыдущей версии.
  v_prev_skip_audit := current_setting('app.skip_boq_audit', true);
  perform set_config('app.skip_boq_audit', 'on', true);

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

  select array_agg(old_id order by new_id), array_agg(new_id order by new_id)
  into v_old_ids, v_new_ids
  from tmp_boq_map;
  v_boq_authorship_copied := public.copy_boq_item_authorship(
    coalesce(v_old_ids, '{}'), coalesce(v_new_ids, '{}'));

  perform set_config('app.skip_boq_audit', coalesce(v_prev_skip_audit, ''), true);

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
    'groupsCopied', v_groups_copied,
    'boqAuthorshipCopied', v_boq_authorship_copied,
    'gpAuthorshipCopied', v_gp_authorship_copied
  );
end;
$function$;

COMMIT;
