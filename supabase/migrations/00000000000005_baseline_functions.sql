-- Baseline migration 5/10: functions with search_path fixes.
-- Target: pre-prod project ocauafggjrqvopxjihas (TenderHUB_SU10 Prod).
-- Source: snapshot of wkywhjljrhewfpedbjzx (live prod) as of 2026-04-20.
-- All SECURITY DEFINER functions get SET search_path = public, pg_temp.
-- 17 identical update_*_updated_at triggers replaced by single handle_updated_at().

CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_subcontract_growth_exclusion(p_tender_id uuid, p_detail_cost_category_id uuid, p_exclusion_type text DEFAULT 'works'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
   SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- Проверяем валидность типа
  IF p_exclusion_type NOT IN ('works', 'materials') THEN
    RAISE EXCEPTION 'Invalid exclusion_type: must be ''works'' or ''materials''';
  END IF;

  -- Вставляем запись (или возвращаем существующую)
  INSERT INTO public.subcontract_growth_exclusions (
    tender_id,
    detail_cost_category_id,
    exclusion_type
  )
  VALUES (
    p_tender_id,
    p_detail_cost_category_id,
    p_exclusion_type
  )
  ON CONFLICT (tender_id, detail_cost_category_id, exclusion_type)
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_archive_tender_registry()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  status_name TEXT;
BEGIN
  -- Получить название нового статуса
  SELECT name INTO status_name
  FROM tender_statuses
  WHERE id = NEW.status_id;

  -- Если статус "Проиграли" или "Выиграли" - архивировать
  IF status_name IN ('Проиграли', 'Выиграли') THEN
    NEW.is_archived = TRUE;
  -- Если статус "В работе" или "Ожидаем тендерный пакет" - разархивировать
  ELSIF status_name IN ('В работе', 'Ожидаем тендерный пакет') THEN
    NEW.is_archived = FALSE;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_create_tender_registry()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  default_status_id UUID;
  next_sort_order INTEGER;
BEGIN
  -- Получить ID статуса "В работе" (или первый доступный статус)
  SELECT id INTO default_status_id
  FROM tender_statuses
  WHERE name = 'В работе'
  LIMIT 1;

  -- Если статус не найден, использовать первый доступный
  IF default_status_id IS NULL THEN
    SELECT id INTO default_status_id
    FROM tender_statuses
    LIMIT 1;
  END IF;

  -- Получить следующий sort_order
  SELECT COALESCE(MAX(sort_order), 0) + 1 INTO next_sort_order
  FROM tender_registry;

  -- Создать запись в tender_registry
  INSERT INTO tender_registry (
    title,
    client_name,
    tender_number,
    area,
    construction_scope_id,
    status_id,
    created_by,
    is_archived,
    sort_order
  )
  VALUES (
    NEW.title,                    -- Наименование
    NEW.client_name,              -- Заказчик
    NEW.tender_number,            -- Номер тендера
    NEW.area_sp,                  -- Площадь по СП
    (SELECT id FROM construction_scopes WHERE name::text = NEW.construction_scope::text LIMIT 1), -- Объем строительства
    default_status_id,            -- Статус по умолчанию
    NEW.created_by,               -- Кто создал
    FALSE,                        -- Не архивный
    next_sort_order               -- Порядок сортировки
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_import_client_position_boq(p_user_id uuid, p_tender_id uuid, p_file_name text, p_items jsonb DEFAULT '[]'::jsonb, p_position_updates jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_import_session_id uuid;
  v_affected_position_ids uuid[] := '{}'::uuid[];
  v_inserted_count integer := 0;
  v_updated_positions_count integer := 0;
  v_current_position_id uuid;
  v_current_max_sort integer := -1;
  v_position_item_index integer := 0;
  v_work_ref_map jsonb := '{}'::jsonb;
  v_item jsonb;
  v_pos_update jsonb;
  v_inserted_id uuid;
  v_parent_work_id uuid;
  v_row_index integer;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT position_id), '{}'::uuid[])
  INTO v_affected_position_ids
  FROM (
    SELECT NULLIF(item->>'client_position_id', '')::uuid AS position_id
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) item
    UNION
    SELECT NULLIF(item->>'position_id', '')::uuid AS position_id
    FROM jsonb_array_elements(COALESCE(p_position_updates, '[]'::jsonb)) item
  ) affected
  WHERE position_id IS NOT NULL;

  IF p_user_id IS NOT NULL THEN
    INSERT INTO public.import_sessions (
      user_id,
      tender_id,
      file_name,
      positions_snapshot
    )
    VALUES (
      p_user_id,
      p_tender_id,
      p_file_name,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', cp.id,
              'manual_volume', cp.manual_volume,
              'manual_note', cp.manual_note
            )
          )
          FROM public.client_positions cp
          WHERE cp.id = ANY(v_affected_position_ids)
        ),
        '[]'::jsonb
      )
    )
    RETURNING id INTO v_import_session_id;
  END IF;

  FOR v_item IN
    SELECT ordered.item
    FROM (
      SELECT item, ordinality
      FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) WITH ORDINALITY AS t(item, ordinality)
    ) AS ordered
    ORDER BY
      ordered.item->>'client_position_id',
      ordered.ordinality
  LOOP
    v_row_index := NULLIF(v_item->>'row_index', '')::integer;

    IF NULLIF(v_item->>'client_position_id', '') IS NULL THEN
      RAISE EXCEPTION 'Bulk BOQ import: missing client_position_id for row %', COALESCE(v_row_index::text, '?');
    END IF;

    IF v_current_position_id IS DISTINCT FROM NULLIF(v_item->>'client_position_id', '')::uuid THEN
      v_current_position_id := NULLIF(v_item->>'client_position_id', '')::uuid;
      v_position_item_index := 0;

      SELECT COALESCE(MAX(sort_number), -1)
      INTO v_current_max_sort
      FROM public.boq_items
      WHERE client_position_id = v_current_position_id;
    END IF;

    v_position_item_index := v_position_item_index + 1;

    IF NULLIF(v_item->>'parent_work_temp_id', '') IS NOT NULL THEN
      v_parent_work_id := NULLIF(v_work_ref_map ->> (v_item->>'parent_work_temp_id'), '')::uuid;

      IF v_parent_work_id IS NULL THEN
        RAISE EXCEPTION
          'Bulk BOQ import: parent work not resolved for row %, temp ref %',
          COALESCE(v_row_index::text, '?'),
          v_item->>'parent_work_temp_id';
      END IF;
    ELSE
      v_parent_work_id := NULL;
    END IF;

    INSERT INTO public.boq_items (
      tender_id,
      client_position_id,
      sort_number,
      boq_item_type,
      work_name_id,
      material_name_id,
      parent_work_item_id,
      unit_code,
      quantity,
      base_quantity,
      conversion_coefficient,
      consumption_coefficient,
      unit_rate,
      currency_type,
      total_amount,
      delivery_price_type,
      delivery_amount,
      quote_link,
      detail_cost_category_id,
      material_type,
      description,
      import_session_id
    )
    VALUES (
      p_tender_id,
      v_current_position_id,
      v_current_max_sort + v_position_item_index,
      (v_item->>'boq_item_type')::public.boq_item_type,
      NULLIF(v_item->>'work_name_id', '')::uuid,
      NULLIF(v_item->>'material_name_id', '')::uuid,
      v_parent_work_id,
      v_item->>'unit_code',
      NULLIF(v_item->>'quantity', '')::numeric,
      NULLIF(v_item->>'base_quantity', '')::numeric,
      NULLIF(v_item->>'conversion_coefficient', '')::numeric,
      NULLIF(v_item->>'consumption_coefficient', '')::numeric,
      NULLIF(v_item->>'unit_rate', '')::numeric,
      COALESCE(NULLIF(v_item->>'currency_type', '')::public.currency_type, 'RUB'::public.currency_type),
      COALESCE(NULLIF(v_item->>'total_amount', '')::numeric, 0),
      NULLIF(v_item->>'delivery_price_type', '')::public.delivery_price_type,
      NULLIF(v_item->>'delivery_amount', '')::numeric,
      NULLIF(v_item->>'quote_link', ''),
      NULLIF(v_item->>'detail_cost_category_id', '')::uuid,
      NULLIF(v_item->>'material_type', '')::public.material_type,
      NULLIF(v_item->>'description', ''),
      v_import_session_id
    )
    RETURNING id INTO v_inserted_id;

    v_inserted_count := v_inserted_count + 1;

    IF NULLIF(v_item->>'temp_id', '') IS NOT NULL THEN
      v_work_ref_map := jsonb_set(
        v_work_ref_map,
        ARRAY[v_item->>'temp_id'],
        to_jsonb(v_inserted_id::text),
        true
      );
    END IF;
  END LOOP;

  FOR v_pos_update IN
    SELECT item
    FROM jsonb_array_elements(COALESCE(p_position_updates, '[]'::jsonb)) item
  LOOP
    UPDATE public.client_positions
    SET
      manual_volume = CASE
        WHEN v_pos_update ? 'manual_volume' THEN NULLIF(v_pos_update->>'manual_volume', '')::numeric
        ELSE manual_volume
      END,
      manual_note = CASE
        WHEN v_pos_update ? 'manual_note' THEN NULLIF(v_pos_update->>'manual_note', '')
        ELSE manual_note
      END
    WHERE id = NULLIF(v_pos_update->>'position_id', '')::uuid;

    IF FOUND THEN
      v_updated_positions_count := v_updated_positions_count + 1;
    END IF;
  END LOOP;

  IF v_import_session_id IS NOT NULL THEN
    UPDATE public.import_sessions
    SET items_count = v_inserted_count
    WHERE id = v_import_session_id;
  END IF;

  RETURN jsonb_build_object(
    'import_session_id', v_import_session_id,
    'inserted_items_count', v_inserted_count,
    'updated_positions_count', v_updated_positions_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_update_boq_items_commercial_costs(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  v_tender_id uuid;
BEGIN
  UPDATE boq_items bi
  SET
    commercial_markup              = (r.value->>'commercial_markup')::numeric,
    total_commercial_material_cost = (r.value->>'total_commercial_material_cost')::numeric,
    total_commercial_work_cost     = (r.value->>'total_commercial_work_cost')::numeric,
    updated_at                     = now()
  FROM jsonb_array_elements(p_rows) AS r(value)
  WHERE bi.id = (r.value->>'id')::uuid;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Пересчитываем grand total один раз для каждого затронутого тендера
  FOR v_tender_id IN
    SELECT DISTINCT bi.tender_id
    FROM boq_items bi
    JOIN jsonb_array_elements(p_rows) AS r(value) ON bi.id = (r.value->>'id')::uuid
  LOOP
    PERFORM public.recalculate_tender_grand_total(v_tender_id);
  END LOOP;

  RETURN v_count;
END;
$function$;

-- Fixed: old prod referenced stale `role` column; updated to role_code with English codes.
CREATE OR REPLACE FUNCTION public.check_user_page_access(user_id uuid, page_url text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
   SET search_path = public, pg_temp
AS $function$
  DECLARE
    user_record RECORD;
    allowed_page TEXT;
    pattern TEXT;
  BEGIN
    SELECT role_code, access_status, allowed_pages
    INTO user_record
    FROM public.users
    WHERE id = user_id;

    IF NOT FOUND OR user_record.access_status != 'approved' THEN
      RETURN FALSE;
    END IF;

    IF user_record.role_code IN ('administrator', 'director', 'developer', 'general_director') THEN
      RETURN TRUE;
    END IF;

    IF jsonb_array_length(user_record.allowed_pages) = 0 THEN
      RETURN TRUE;
    END IF;

    FOR allowed_page IN
      SELECT jsonb_array_elements_text(user_record.allowed_pages)
    LOOP
      pattern := '^' || regexp_replace(allowed_page, ':[^/]+', '[^/]+', 'g') ||      
  '$';

      IF page_url ~ pattern THEN
        RETURN TRUE;
      END IF;
    END LOOP;

    RETURN FALSE;
  END;
  $function$;

CREATE OR REPLACE FUNCTION public.clear_audit_user()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
   SET search_path = public, pg_temp
AS $function$
    BEGIN
      -- Очистить значение на уровне сессии
      PERFORM set_config('app.current_user_id', '', true);
    END;
    $function$;

-- Fixed: old prod referenced stale `role` column (renamed to `role_code`).
-- Return type changed from user_role_type enum to text to match role_code column.
CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role_code FROM public.users WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.current_user_status()
 RETURNS access_status_type
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT access_status FROM public.users WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.delete_boq_item_with_audit(p_user_id uuid, p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
   SET search_path = public, pg_temp
AS $function$
DECLARE
  v_old_item record;
BEGIN
  SELECT * INTO v_old_item FROM public.boq_items WHERE id = p_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOQ item not found: %', p_item_id;
  END IF;

  DELETE FROM public.boq_items WHERE id = p_item_id;

  RETURN to_jsonb(v_old_item);
END;
$function$;

CREATE OR REPLACE FUNCTION public.execute_version_transfer(p_source_tender_id uuid, p_new_positions jsonb, p_matches jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
declare
  v_source_tender public.tenders%rowtype;
  v_new_tender public.tenders%rowtype;
  v_new_version integer;
  v_positions_inserted integer := 0;
  v_manual_transferred integer := 0;
  v_boq_items_copied integer := 0;
  v_parent_links_restored integer := 0;
  v_cost_volumes_copied integer := 0;
  v_insurance_rows_copied integer := 0;
  v_additional_works_copied integer := 0;
  v_additional_works_skipped integer := 0;
  v_rows_affected integer := 0;
  v_target_parent_id uuid;
  v_target_parent_position_number numeric(10,2);
  v_new_additional_position_id uuid;
  v_new_additional_position_number numeric(10,2);
  v_old_parent record;
  v_additional_work record;
begin
  if p_new_positions is null or jsonb_typeof(p_new_positions) <> 'array' or jsonb_array_length(p_new_positions) = 0 then
    raise exception 'new_positions must be a non-empty json array';
  end if;

  select *
  into v_source_tender
  from public.tenders
  where id = p_source_tender_id;

  if not found then
    raise exception 'Source tender % not found', p_source_tender_id;
  end if;

  v_new_version := coalesce(v_source_tender.version, 0) + 1;

  if exists (
    select 1
    from public.tenders
    where tender_number = v_source_tender.tender_number
      and version = v_new_version
  ) then
    raise exception 'Tender % version % already exists', v_source_tender.tender_number, v_new_version;
  end if;

  create temporary table tmp_new_positions (
    row_index integer not null,
    item_no text,
    hierarchy_level integer not null,
    work_name text not null,
    unit_code text,
    volume numeric(18,6),
    client_note text
  ) on commit drop;

  insert into tmp_new_positions (
    row_index,
    item_no,
    hierarchy_level,
    work_name,
    unit_code,
    volume,
    client_note
  )
  select
    row_index,
    nullif(item_no, ''),
    coalesce(hierarchy_level, 0),
    work_name,
    nullif(unit_code, ''),
    volume,
    nullif(client_note, '')
  from jsonb_to_recordset(p_new_positions) as rows(
    row_index integer,
    item_no text,
    hierarchy_level integer,
    work_name text,
    unit_code text,
    volume numeric(18,6),
    client_note text
  );

  insert into public.tenders (
    title,
    description,
    client_name,
    tender_number,
    submission_deadline,
    version,
    area_client,
    area_sp,
    usd_rate,
    eur_rate,
    cny_rate,
    upload_folder,
    bsm_link,
    tz_link,
    qa_form_link,
    markup_tactic_id,
    apply_subcontract_works_growth,
    apply_subcontract_materials_growth,
    housing_class,
    construction_scope,
    project_folder_link,
    is_archived,
    volume_title
  )
  values (
    v_source_tender.title,
    v_source_tender.description,
    v_source_tender.client_name,
    v_source_tender.tender_number,
    v_source_tender.submission_deadline,
    v_new_version,
    v_source_tender.area_client,
    v_source_tender.area_sp,
    v_source_tender.usd_rate,
    v_source_tender.eur_rate,
    v_source_tender.cny_rate,
    v_source_tender.upload_folder,
    v_source_tender.bsm_link,
    v_source_tender.tz_link,
    v_source_tender.qa_form_link,
    v_source_tender.markup_tactic_id,
    v_source_tender.apply_subcontract_works_growth,
    v_source_tender.apply_subcontract_materials_growth,
    v_source_tender.housing_class,
    v_source_tender.construction_scope,
    v_source_tender.project_folder_link,
    v_source_tender.is_archived,
    v_source_tender.volume_title
  )
  returning * into v_new_tender;

  insert into public.client_positions (
    tender_id,
    position_number,
    item_no,
    work_name,
    unit_code,
    volume,
    client_note,
    hierarchy_level,
    is_additional,
    parent_position_id,
    manual_volume,
    manual_note
  )
  select
    v_new_tender.id,
    src.row_index + 1,
    src.item_no,
    src.work_name,
    units.code,
    src.volume,
    src.client_note,
    src.hierarchy_level,
    false,
    null,
    null,
    null
  from tmp_new_positions src
  left join public.units units on units.code = src.unit_code
  order by src.row_index;

  get diagnostics v_positions_inserted = row_count;

  create temporary table tmp_new_position_map on commit drop as
  select
    cp.id as new_position_id,
    (cp.position_number::integer - 1) as new_row_index
  from public.client_positions cp
  where cp.tender_id = v_new_tender.id
    and cp.is_additional = false;

  create temporary table tmp_matches on commit drop as
  select
    old_position_id,
    new_row_index
  from jsonb_to_recordset(coalesce(p_matches, '[]'::jsonb)) as rows(
    old_position_id uuid,
    new_row_index integer
  );

  create temporary table tmp_old_to_new_position_map on commit drop as
  select
    matches.old_position_id,
    new_map.new_position_id
  from tmp_matches matches
  join tmp_new_position_map new_map on new_map.new_row_index = matches.new_row_index;

  update public.client_positions new_cp
  set
    manual_volume = old_cp.manual_volume,
    manual_note = old_cp.manual_note
  from tmp_matches matches
  join tmp_new_position_map new_map on new_map.new_row_index = matches.new_row_index
  join public.client_positions old_cp on old_cp.id = matches.old_position_id
  where new_cp.id = new_map.new_position_id;

  get diagnostics v_manual_transferred = row_count;

  create temporary table tmp_boq_source on commit drop as
  select
    old_boq.id as old_item_id,
    new_map.new_position_id,
    old_boq.sort_number,
    old_boq.boq_item_type,
    old_boq.material_type,
    old_boq.material_name_id,
    old_boq.work_name_id,
    old_boq.unit_code,
    old_boq.quantity,
    old_boq.base_quantity,
    old_boq.consumption_coefficient,
    old_boq.conversion_coefficient,
    old_boq.delivery_price_type,
    old_boq.delivery_amount,
    old_boq.currency_type,
    old_boq.total_amount,
    old_boq.detail_cost_category_id,
    old_boq.quote_link,
    old_boq.commercial_markup,
    old_boq.total_commercial_material_cost,
    old_boq.total_commercial_work_cost,
    old_boq.description,
    old_boq.unit_rate,
    old_boq.parent_work_item_id,
    row_number() over (
      partition by matches.old_position_id
      order by old_boq.sort_number, old_boq.id
    ) as source_seq
  from tmp_matches matches
  join tmp_new_position_map new_map on new_map.new_row_index = matches.new_row_index
  join public.boq_items old_boq on old_boq.client_position_id = matches.old_position_id;

  insert into public.boq_items (
    tender_id,
    client_position_id,
    sort_number,
    boq_item_type,
    material_type,
    material_name_id,
    work_name_id,
    unit_code,
    quantity,
    base_quantity,
    consumption_coefficient,
    conversion_coefficient,
    delivery_price_type,
    delivery_amount,
    currency_type,
    total_amount,
    detail_cost_category_id,
    quote_link,
    commercial_markup,
    total_commercial_material_cost,
    total_commercial_work_cost,
    parent_work_item_id,
    description,
    unit_rate
  )
  select
    v_new_tender.id,
    src.new_position_id,
    src.sort_number,
    src.boq_item_type,
    src.material_type,
    src.material_name_id,
    src.work_name_id,
    src.unit_code,
    src.quantity,
    src.base_quantity,
    src.consumption_coefficient,
    src.conversion_coefficient,
    src.delivery_price_type,
    src.delivery_amount,
    src.currency_type,
    src.total_amount,
    src.detail_cost_category_id,
    src.quote_link,
    src.commercial_markup,
    src.total_commercial_material_cost,
    src.total_commercial_work_cost,
    null,
    src.description,
    src.unit_rate
  from tmp_boq_source src
  order by src.new_position_id, src.source_seq;

  get diagnostics v_boq_items_copied = row_count;

  create temporary table tmp_boq_item_map on commit drop as
  select
    src.old_item_id,
    new_items.id as new_item_id
  from tmp_boq_source src
  join (
    select
      id,
      client_position_id,
      row_number() over (
        partition by client_position_id
        order by sort_number, id
      ) as target_seq
    from public.boq_items
    where tender_id = v_new_tender.id
  ) new_items
    on new_items.client_position_id = src.new_position_id
   and new_items.target_seq = src.source_seq;

  update public.boq_items target_boq
  set parent_work_item_id = parent_map.new_item_id
  from tmp_boq_source src
  join tmp_boq_item_map child_map on child_map.old_item_id = src.old_item_id
  join tmp_boq_item_map parent_map on parent_map.old_item_id = src.parent_work_item_id
  where target_boq.id = child_map.new_item_id
    and src.parent_work_item_id is not null;

  get diagnostics v_parent_links_restored = row_count;

  create temporary table tmp_additional_boq_source (
    old_item_id uuid,
    new_position_id uuid,
    sort_number integer,
    boq_item_type public.boq_item_type,
    material_type public.material_type,
    material_name_id uuid,
    work_name_id uuid,
    unit_code text,
    quantity numeric(18,6),
    base_quantity numeric(18,6),
    consumption_coefficient numeric(10,4),
    conversion_coefficient numeric(10,4),
    delivery_price_type public.delivery_price_type,
    delivery_amount numeric(15,5),
    currency_type public.currency_type,
    total_amount numeric(18,2),
    detail_cost_category_id uuid,
    quote_link text,
    commercial_markup numeric(10,4),
    total_commercial_material_cost numeric(18,6),
    total_commercial_work_cost numeric(18,6),
    description text,
    unit_rate numeric(18,2),
    parent_work_item_id uuid,
    source_seq integer
  ) on commit drop;

  create temporary table tmp_additional_boq_item_map (
    old_item_id uuid,
    new_item_id uuid
  ) on commit drop;

  for v_additional_work in
    select *
    from public.client_positions
    where tender_id = p_source_tender_id
      and is_additional = true
    order by position_number, id
  loop
    if v_additional_work.parent_position_id is null then
      v_additional_works_skipped := v_additional_works_skipped + 1;
      continue;
    end if;

    v_target_parent_id := null;

    select new_position_id
    into v_target_parent_id
    from tmp_old_to_new_position_map
    where old_position_id = v_additional_work.parent_position_id;

    if v_target_parent_id is null then
      select *
      into v_old_parent
      from public.client_positions
      where id = v_additional_work.parent_position_id;

      if found and v_old_parent.item_no is not null then
        select id
        into v_target_parent_id
        from public.client_positions
        where tender_id = v_new_tender.id
          and is_additional = false
          and item_no = v_old_parent.item_no
          and position_number < v_old_parent.position_number
        order by position_number desc, id desc
        limit 1;

        if v_target_parent_id is null then
          select id
          into v_target_parent_id
          from public.client_positions
          where tender_id = v_new_tender.id
            and is_additional = false
            and item_no = v_old_parent.item_no
            and position_number > v_old_parent.position_number
          order by position_number asc, id asc
          limit 1;
        end if;
      end if;
    end if;

    if v_target_parent_id is null then
      v_additional_works_skipped := v_additional_works_skipped + 1;
      continue;
    end if;

    select position_number
    into v_target_parent_position_number
    from public.client_positions
    where id = v_target_parent_id;

    select coalesce(max(position_number), v_target_parent_position_number) + 0.1
    into v_new_additional_position_number
    from public.client_positions
    where parent_position_id = v_target_parent_id
      and is_additional = true;

    insert into public.client_positions (
      tender_id,
      position_number,
      item_no,
      work_name,
      unit_code,
      volume,
      client_note,
      hierarchy_level,
      is_additional,
      parent_position_id,
      manual_volume,
      manual_note
    )
    values (
      v_new_tender.id,
      v_new_additional_position_number,
      null,
      v_additional_work.work_name,
      v_additional_work.unit_code,
      v_additional_work.volume,
      v_additional_work.client_note,
      coalesce(v_additional_work.hierarchy_level, 0),
      true,
      v_target_parent_id,
      v_additional_work.manual_volume,
      v_additional_work.manual_note
    )
    returning id into v_new_additional_position_id;

    v_additional_works_copied := v_additional_works_copied + 1;

    truncate table tmp_additional_boq_source;
    truncate table tmp_additional_boq_item_map;

    insert into tmp_additional_boq_source (
      old_item_id,
      new_position_id,
      sort_number,
      boq_item_type,
      material_type,
      material_name_id,
      work_name_id,
      unit_code,
      quantity,
      base_quantity,
      consumption_coefficient,
      conversion_coefficient,
      delivery_price_type,
      delivery_amount,
      currency_type,
      total_amount,
      detail_cost_category_id,
      quote_link,
      commercial_markup,
      total_commercial_material_cost,
      total_commercial_work_cost,
      description,
      unit_rate,
      parent_work_item_id,
      source_seq
    )
    select
      old_boq.id,
      v_new_additional_position_id,
      old_boq.sort_number,
      old_boq.boq_item_type,
      old_boq.material_type,
      old_boq.material_name_id,
      old_boq.work_name_id,
      old_boq.unit_code,
      old_boq.quantity,
      old_boq.base_quantity,
      old_boq.consumption_coefficient,
      old_boq.conversion_coefficient,
      old_boq.delivery_price_type,
      old_boq.delivery_amount,
      old_boq.currency_type,
      old_boq.total_amount,
      old_boq.detail_cost_category_id,
      old_boq.quote_link,
      old_boq.commercial_markup,
      old_boq.total_commercial_material_cost,
      old_boq.total_commercial_work_cost,
      old_boq.description,
      old_boq.unit_rate,
      old_boq.parent_work_item_id,
      row_number() over (order by old_boq.sort_number, old_boq.id)
    from public.boq_items old_boq
    where old_boq.client_position_id = v_additional_work.id;

    insert into public.boq_items (
      tender_id,
      client_position_id,
      sort_number,
      boq_item_type,
      material_type,
      material_name_id,
      work_name_id,
      unit_code,
      quantity,
      base_quantity,
      consumption_coefficient,
      conversion_coefficient,
      delivery_price_type,
      delivery_amount,
      currency_type,
      total_amount,
      detail_cost_category_id,
      quote_link,
      commercial_markup,
      total_commercial_material_cost,
      total_commercial_work_cost,
      parent_work_item_id,
      description,
      unit_rate
    )
    select
      v_new_tender.id,
      src.new_position_id,
      src.sort_number,
      src.boq_item_type,
      src.material_type,
      src.material_name_id,
      src.work_name_id,
      src.unit_code,
      src.quantity,
      src.base_quantity,
      src.consumption_coefficient,
      src.conversion_coefficient,
      src.delivery_price_type,
      src.delivery_amount,
      src.currency_type,
      src.total_amount,
      src.detail_cost_category_id,
      src.quote_link,
      src.commercial_markup,
      src.total_commercial_material_cost,
      src.total_commercial_work_cost,
      null,
      src.description,
      src.unit_rate
    from tmp_additional_boq_source src
    order by src.source_seq;

    get diagnostics v_rows_affected = row_count;
    v_boq_items_copied := v_boq_items_copied + v_rows_affected;

    insert into tmp_additional_boq_item_map (old_item_id, new_item_id)
    select
      src.old_item_id,
      new_items.id
    from tmp_additional_boq_source src
    join (
      select
        id,
        row_number() over (order by sort_number, id) as target_seq
      from public.boq_items
      where client_position_id = v_new_additional_position_id
    ) new_items on new_items.target_seq = src.source_seq;

    update public.boq_items target_boq
    set parent_work_item_id = parent_map.new_item_id
    from tmp_additional_boq_source src
    join tmp_additional_boq_item_map child_map on child_map.old_item_id = src.old_item_id
    join tmp_additional_boq_item_map parent_map on parent_map.old_item_id = src.parent_work_item_id
    where target_boq.id = child_map.new_item_id
      and src.parent_work_item_id is not null;

    get diagnostics v_rows_affected = row_count;
    v_parent_links_restored := v_parent_links_restored + v_rows_affected;

    update public.client_positions
    set
      total_material = coalesce((
        select sum(case
          when boq_item_type in ('мат', 'суб-мат', 'мат-комп.') then coalesce(total_amount, 0)
          else 0
        end)
        from public.boq_items
        where client_position_id = v_new_additional_position_id
      ), 0),
      total_works = coalesce((
        select sum(case
          when boq_item_type in ('раб', 'суб-раб', 'раб-комп.') then coalesce(total_amount, 0)
          else 0
        end)
        from public.boq_items
        where client_position_id = v_new_additional_position_id
      ), 0)
    where id = v_new_additional_position_id;
  end loop;

  update public.client_positions target_cp
  set
    total_material = totals.total_material,
    total_works = totals.total_works
  from (
    select
      client_position_id,
      coalesce(sum(case
        when boq_item_type in ('мат', 'суб-мат', 'мат-комп.') then coalesce(total_amount, 0)
        else 0
      end), 0) as total_material,
      coalesce(sum(case
        when boq_item_type in ('раб', 'суб-раб', 'раб-комп.') then coalesce(total_amount, 0)
        else 0
      end), 0) as total_works
    from public.boq_items
    where tender_id = v_new_tender.id
    group by client_position_id
  ) totals
  where target_cp.id = totals.client_position_id;

  insert into public.construction_cost_volumes (
    tender_id,
    detail_cost_category_id,
    volume,
    group_key
  )
  select
    v_new_tender.id,
    detail_cost_category_id,
    volume,
    group_key
  from public.construction_cost_volumes
  where tender_id = p_source_tender_id;

  get diagnostics v_cost_volumes_copied = row_count;

  insert into public.tender_insurance (
    tender_id,
    judicial_pct,
    total_pct,
    apt_price_m2,
    apt_area,
    parking_price_m2,
    parking_area,
    storage_price_m2,
    storage_area
  )
  select
    v_new_tender.id,
    judicial_pct,
    total_pct,
    apt_price_m2,
    apt_area,
    parking_price_m2,
    parking_area,
    storage_price_m2,
    storage_area
  from public.tender_insurance
  where tender_id = p_source_tender_id
  on conflict (tender_id) do update
  set
    judicial_pct = excluded.judicial_pct,
    total_pct = excluded.total_pct,
    apt_price_m2 = excluded.apt_price_m2,
    apt_area = excluded.apt_area,
    parking_price_m2 = excluded.parking_price_m2,
    parking_area = excluded.parking_area,
    storage_price_m2 = excluded.storage_price_m2,
    storage_area = excluded.storage_area;

  get diagnostics v_insurance_rows_copied = row_count;

  return jsonb_build_object(
    'tenderId', v_new_tender.id,
    'version', v_new_version,
    'positionsInserted', v_positions_inserted,
    'manualTransferred', v_manual_transferred,
    'boqItemsCopied', v_boq_items_copied,
    'parentLinksRestored', v_parent_links_restored,
    'costVolumesCopied', v_cost_volumes_copied,
    'insuranceRowsCopied', v_insurance_rows_copied,
    'additionalWorksCopied', v_additional_works_copied,
    'additionalWorksSkipped', v_additional_works_skipped
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_positions_with_costs(p_tender_id uuid)
 RETURNS TABLE(id uuid, tender_id uuid, position_number numeric, unit_code text, volume numeric, client_note text, item_no text, work_name text, manual_volume numeric, manual_note text, hierarchy_level integer, is_additional boolean, parent_position_id uuid, total_material numeric, total_works numeric, material_cost_per_unit numeric, work_cost_per_unit numeric, total_commercial_material numeric, total_commercial_work numeric, total_commercial_material_per_unit numeric, total_commercial_work_per_unit numeric, created_at timestamp with time zone, updated_at timestamp with time zone, base_total numeric, commercial_total numeric, material_cost_total numeric, work_cost_total numeric, markup_percentage numeric, items_count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    cp.id,
    cp.tender_id,
    cp.position_number,
    cp.unit_code,
    cp.volume,
    cp.client_note,
    cp.item_no,
    cp.work_name,
    cp.manual_volume,
    cp.manual_note,
    cp.hierarchy_level,
    cp.is_additional,
    cp.parent_position_id,
    cp.total_material,
    cp.total_works,
    cp.material_cost_per_unit,
    cp.work_cost_per_unit,
    cp.total_commercial_material,
    cp.total_commercial_work,
    cp.total_commercial_material_per_unit,
    cp.total_commercial_work_per_unit,
    cp.created_at,
    cp.updated_at,
    COALESCE(SUM(b.total_amount), 0) AS base_total,
    COALESCE(SUM(COALESCE(b.total_commercial_material_cost, 0) + COALESCE(b.total_commercial_work_cost, 0)), 0) AS commercial_total,
    COALESCE(SUM(b.total_commercial_material_cost), 0) AS material_cost_total,
    COALESCE(SUM(b.total_commercial_work_cost), 0) AS work_cost_total,
    CASE
      WHEN COALESCE(SUM(b.total_amount), 0) > 0
        THEN COALESCE(SUM(COALESCE(b.total_commercial_material_cost, 0) + COALESCE(b.total_commercial_work_cost, 0)), 0) / SUM(b.total_amount)
      ELSE 1
    END AS markup_percentage,
    COUNT(b.id) AS items_count
  FROM public.client_positions cp
  LEFT JOIN public.boq_items b
    ON b.client_position_id = cp.id
   AND b.tender_id = p_tender_id
  WHERE cp.tender_id = p_tender_id
  GROUP BY
    cp.id,
    cp.tender_id,
    cp.position_number,
    cp.unit_code,
    cp.volume,
    cp.client_note,
    cp.item_no,
    cp.work_name,
    cp.manual_volume,
    cp.manual_note,
    cp.hierarchy_level,
    cp.is_additional,
    cp.parent_position_id,
    cp.total_material,
    cp.total_works,
    cp.material_cost_per_unit,
    cp.work_cost_per_unit,
    cp.total_commercial_material,
    cp.total_commercial_work,
    cp.total_commercial_material_per_unit,
    cp.total_commercial_work_per_unit,
    cp.created_at,
    cp.updated_at
  ORDER BY cp.position_number, cp.id;
$function$;

CREATE OR REPLACE FUNCTION public.get_subcontract_growth_exclusions(p_tender_id uuid)
 RETURNS TABLE(detail_cost_category_id uuid, exclusion_type text)
 LANGUAGE plpgsql
 SECURITY DEFINER
   SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    e.detail_cost_category_id,
    e.exclusion_type
  FROM public.subcontract_growth_exclusions e
  WHERE e.tender_id = p_tender_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.insert_boq_item_with_audit(p_user_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
   SET search_path = public, pg_temp
AS $function$
DECLARE
  v_new_item record;
BEGIN
  INSERT INTO public.boq_items (
    tender_id,
    client_position_id,
    sort_number,
    boq_item_type,
    work_name_id,
    material_name_id,
    parent_work_item_id,
    unit_code,
    quantity,
    conversion_coefficient,
    consumption_coefficient,
    unit_rate,
    currency_type,
    total_amount,
    delivery_price_type,
    delivery_amount,
    quote_link,
    detail_cost_category_id,
    material_type
  ) SELECT
    (p_data->>'tender_id')::uuid,
    (p_data->>'client_position_id')::uuid,
    COALESCE((p_data->>'sort_number')::integer, 0),
    (p_data->>'boq_item_type')::boq_item_type,
    (p_data->>'work_name_id')::uuid,
    (p_data->>'material_name_id')::uuid,
    (p_data->>'parent_work_item_id')::uuid,
    p_data->>'unit_code',
    COALESCE((p_data->>'quantity')::numeric, 1),
    (p_data->>'conversion_coefficient')::numeric,
    (p_data->>'consumption_coefficient')::numeric,
    COALESCE((p_data->>'unit_rate')::numeric, 0),
    COALESCE((p_data->>'currency_type')::currency_type, 'RUB'::currency_type),
    COALESCE((p_data->>'total_amount')::numeric, 0),
    (p_data->>'delivery_price_type')::delivery_price_type,
    (p_data->>'delivery_amount')::numeric,
    p_data->>'quote_link',
    (p_data->>'detail_cost_category_id')::uuid,
    (p_data->>'material_type')::material_type
  RETURNING * INTO v_new_item;

  RETURN to_jsonb(v_new_item);
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_tender_timeline_privileged()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role_code in (
        'administrator',
        'developer',
        'director',
        'senior_group',
        'veduschiy_inzhener'
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.log_boq_items_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
   SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid;
  v_changed_fields text[];
  v_key text;
  v_old_val jsonb;
  v_new_val jsonb;
BEGIN
  -- Resolve user_id directly from JWT via auth.uid()
  BEGIN
    v_user_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  -- For UPDATE: compute list of changed fields
  IF TG_OP = 'UPDATE' THEN
    v_changed_fields := ARRAY[]::text[];

    FOR v_key IN SELECT jsonb_object_keys(to_jsonb(NEW.*)) LOOP
      v_old_val := to_jsonb(OLD.*) -> v_key;
      v_new_val := to_jsonb(NEW.*) -> v_key;

      IF v_key NOT IN ('updated_at', 'created_at')
         AND (v_old_val IS DISTINCT FROM v_new_val) THEN
        v_changed_fields := array_append(v_changed_fields, v_key);
      END IF;
    END LOOP;

    -- No real changes — skip audit entry
    IF array_length(v_changed_fields, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.boq_items_audit (
    boq_item_id,
    operation_type,
    changed_by,
    old_data,
    new_data,
    changed_fields
  ) VALUES (
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    v_user_id,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD.*) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW.*) ELSE NULL END,
    v_changed_fields
  );

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_tender_grand_total(p_tender_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
   SET search_path = public, pg_temp
AS $function$
DECLARE
  v_boq_total   NUMERIC;
  v_insurance   NUMERIC;
  v_grand_total NUMERIC;
BEGIN
  -- Сумма коммерческих затрат по всем BOQ-позициям тендера
  SELECT COALESCE(SUM(total_commercial_material_cost + total_commercial_work_cost), 0)
  INTO v_boq_total
  FROM public.boq_items
  WHERE tender_id = p_tender_id;

  -- Сумма страхования от судимостей (если есть запись)
  SELECT COALESCE(
    (apt_price_m2 * apt_area + parking_price_m2 * parking_area + storage_price_m2 * storage_area)
    * (judicial_pct / 100.0)
    * (total_pct / 100.0),
    0
  )
  INTO v_insurance
  FROM public.tender_insurance
  WHERE tender_id = p_tender_id
  LIMIT 1;

  v_grand_total := v_boq_total + COALESCE(v_insurance, 0);

  UPDATE public.tenders
  SET cached_grand_total = ROUND(v_grand_total, 2)
  WHERE id = p_tender_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_user(p_user_id uuid, p_full_name text, p_email text, p_role_code text, p_allowed_pages jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE
    v_is_first_user BOOLEAN;
    v_access_status access_status_type;
  BEGIN
    -- Проверка первого пользователя
    SELECT NOT EXISTS (SELECT 1 FROM public.users LIMIT 1) INTO v_is_first_user;

    -- Первый admin/director/developer → auto-approved
    IF v_is_first_user AND p_role_code IN ('administrator', 'director', 'developer') THEN
      v_access_status := 'approved';

      INSERT INTO public.users (
        id, full_name, email, role_code, access_status, allowed_pages,
        approved_by, approved_at
      ) VALUES (
        p_user_id, p_full_name, p_email, p_role_code, v_access_status, p_allowed_pages,
        p_user_id, NOW()
      );
    ELSE
      -- Остальные → pending (ждут одобрения)
      v_access_status := 'pending';

      INSERT INTO public.users (
        id, full_name, email, role_code, access_status, allowed_pages
      ) VALUES (
        p_user_id, p_full_name, p_email, p_role_code, v_access_status, p_allowed_pages
      );
    END IF;
  END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_subcontract_growth_exclusion(p_tender_id uuid, p_detail_cost_category_id uuid, p_exclusion_type text DEFAULT 'works'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
   SET search_path = public, pg_temp
AS $function$
DECLARE
  v_deleted boolean;
BEGIN
  DELETE FROM public.subcontract_growth_exclusions
  WHERE tender_id = p_tender_id
    AND detail_cost_category_id = p_detail_cost_category_id
    AND exclusion_type = p_exclusion_type;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.respond_tender_iteration(p_iteration_id uuid, p_manager_comment text, p_approval_status text)
 RETURNS tender_iterations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_iteration public.tender_iterations;
begin
  if not public.is_tender_timeline_privileged() then
    raise exception 'insufficient_privilege';
  end if;

  if p_approval_status not in ('pending', 'approved', 'rejected') then
    raise exception 'invalid approval_status';
  end if;

  update public.tender_iterations
  set manager_id = auth.uid(),
      manager_comment = p_manager_comment,
      manager_responded_at = now(),
      approval_status = p_approval_status
  where id = p_iteration_id
  returning * into v_iteration;

  if v_iteration.id is null then
    raise exception 'iteration not found';
  end if;

  return v_iteration;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_audit_user(user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
   SET search_path = public, pg_temp
AS $function$
    BEGIN
      -- Используем is_local = true для установки на уровне сессии
      PERFORM set_config('app.current_user_id', user_id::text, true);
    END;
    $function$;

CREATE OR REPLACE FUNCTION public.set_tender_group_quality(p_group_id uuid, p_quality_level smallint, p_quality_comment text DEFAULT NULL::text)
 RETURNS tender_groups
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_group public.tender_groups;
begin
  if not exists (
    select 1
    from public.users u
    where u.id = auth.uid()
  ) then
    raise exception 'insufficient_privilege';
  end if;

  if p_quality_level is not null and (p_quality_level < 1 or p_quality_level > 10) then
    raise exception 'invalid_quality_level';
  end if;

  update public.tender_groups
  set quality_level = p_quality_level,
      quality_comment = nullif(trim(coalesce(p_quality_comment, '')), ''),
      quality_updated_by = auth.uid(),
      quality_updated_at = now()
  where id = p_group_id
  returning * into v_group;

  if v_group.id is null then
    raise exception 'group not found';
  end if;

  return v_group;
end;
$function$;

CREATE OR REPLACE FUNCTION public.toggle_subcontract_growth_exclusion(p_tender_id uuid, p_detail_cost_category_id uuid, p_exclusion_type text DEFAULT 'works'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
   SET search_path = public, pg_temp
AS $function$
DECLARE
  v_exists boolean;
BEGIN
  -- Проверяем существование
  SELECT EXISTS (
    SELECT 1
    FROM public.subcontract_growth_exclusions
    WHERE tender_id = p_tender_id
      AND detail_cost_category_id = p_detail_cost_category_id
      AND exclusion_type = p_exclusion_type
  ) INTO v_exists;

  IF v_exists THEN
    -- Удаляем если существует
    PERFORM remove_subcontract_growth_exclusion(p_tender_id, p_detail_cost_category_id, p_exclusion_type);
    RETURN false;
  ELSE
    -- Добавляем если не существует
    PERFORM add_subcontract_growth_exclusion(p_tender_id, p_detail_cost_category_id, p_exclusion_type);
    RETURN true;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_boq_items_update_grand_total()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_tender_grand_total(OLD.tender_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalculate_tender_grand_total(NEW.tender_id);

  -- Если tender_id сменился при UPDATE — пересчитываем и старый тендер
  IF TG_OP = 'UPDATE' AND OLD.tender_id IS DISTINCT FROM NEW.tender_id THEN
    PERFORM public.recalculate_tender_grand_total(OLD.tender_id);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_insurance_update_grand_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
   SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_tender_grand_total(OLD.tender_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalculate_tender_grand_total(NEW.tender_id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_markup_pct_update_grand_total()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_tender_grand_total(OLD.tender_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalculate_tender_grand_total(NEW.tender_id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_subcontract_excl_update_grand_total()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_tender_grand_total(OLD.tender_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalculate_tender_grand_total(NEW.tender_id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_boq_item_with_audit(p_user_id uuid, p_item_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
   SET search_path = public, pg_temp
AS $function$
DECLARE
  v_new_item record;
BEGIN
  UPDATE public.boq_items
  SET
    boq_item_type = COALESCE((p_data->>'boq_item_type')::boq_item_type, boq_item_type),
    quantity = COALESCE((p_data->>'quantity')::numeric, quantity),
    unit_rate = COALESCE((p_data->>'unit_rate')::numeric, unit_rate),
    total_amount = COALESCE((p_data->>'total_amount')::numeric, total_amount),
    conversion_coefficient = COALESCE((p_data->>'conversion_coefficient')::numeric, conversion_coefficient),
    consumption_coefficient = COALESCE((p_data->>'consumption_coefficient')::numeric, consumption_coefficient),
    delivery_price_type = COALESCE((p_data->>'delivery_price_type')::delivery_price_type, delivery_price_type),
    delivery_amount = COALESCE((p_data->>'delivery_amount')::numeric, delivery_amount),
    currency_type = COALESCE((p_data->>'currency_type')::currency_type, currency_type),
    quote_link = COALESCE(p_data->>'quote_link', quote_link),
    description = COALESCE(p_data->>'description', description),
    detail_cost_category_id = COALESCE((p_data->>'detail_cost_category_id')::uuid, detail_cost_category_id),
    material_type = COALESCE((p_data->>'material_type')::material_type, material_type),
    work_name_id = COALESCE((p_data->>'work_name_id')::uuid, work_name_id),
    material_name_id = COALESCE((p_data->>'material_name_id')::uuid, material_name_id),
    unit_code = COALESCE(p_data->>'unit_code', unit_code),
    parent_work_item_id = COALESCE((p_data->>'parent_work_item_id')::uuid, parent_work_item_id),
    sort_number = COALESCE((p_data->>'sort_number')::integer, sort_number)
  WHERE id = p_item_id
  RETURNING * INTO v_new_item;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOQ item not found: %', p_item_id;
  END IF;

  RETURN to_jsonb(v_new_item);
END;
$function$;

