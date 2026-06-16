-- =============================================================================
-- 2026_06_tender_registry_dedupe.sql — одна запись tender_registry на tender_number.
--
-- ПРОБЛЕМА: триггер trigger_auto_create_tender_registry (AFTER INSERT ON tenders,
-- FOR EACH ROW) срабатывает на КАЖДЫЙ insert в tenders. Создание новой ВЕРСИИ
-- тендера (clone/transfer делают INSERT INTO tenders) плодило второй, ПУСТОЙ
-- tender_registry с тем же tender_number (статус по умолчанию «В работе», поля
-- NULL). На «Перечне тендеров» дедуп выбирал свежую (пустую) строку → данные
-- тендера «слетали»/«перекрывались пустой версией».
--
-- РЕШЕНИЕ:
--   1) Guard в auto_create_tender_registry(): не создавать дубль, если запись для
--      tender_number уже есть (поведение для первой версии и тендеров без номера
--      не меняется).
--   2) Дедуп существующих строк: на каждый tender_number оставить самую
--      заполненную строку (тай-брейк — самая ранняя created_at), предварительно
--      слив непустые пользовательские поля из дублей, остальные удалить.
--
-- БЕЗОПАСНОСТЬ: входящих FK на public.tender_registry нет — удаление дублей не
-- сиротит другие таблицы.
--
-- ИДЕМПОТЕНТНОСТЬ: повторный прогон — no-op (дублей по tender_number больше нет).
--
-- Transaction wrapping (BEGIN/COMMIT) выполняет apply-скрипт, как и для
-- db/yandex/sql/*.sql.
-- =============================================================================

-- ----- 1. Триггерная функция с guard -----------------------------------------
CREATE OR REPLACE FUNCTION public.auto_create_tender_registry()
 RETURNS trigger
 LANGUAGE plpgsql
   SET search_path = public, pg_temp
AS $function$
DECLARE
  default_status_id UUID;
  next_sort_order INTEGER;
BEGIN
  -- Одна запись реестра на tender_number: при создании НОВОЙ ВЕРСИИ тендера
  -- не плодим пустой дубль, иначе он «перекрывает» данные исходной строки.
  IF NEW.tender_number IS NOT NULL
     AND EXISTS (SELECT 1 FROM tender_registry WHERE tender_number = NEW.tender_number) THEN
    RETURN NEW;
  END IF;

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

-- ----- 2. Дедуп существующих строк -------------------------------------------
DO $$
DECLARE
  rec_num     record;
  keep_id     uuid;   -- каноничная (самая заполненная) строка — её оставляем
  status_src  uuid;   -- откуда брать актуальный статус (может отличаться от keep)
BEGIN
  -- Каждый tender_number, у которого больше одной строки реестра.
  FOR rec_num IN
    SELECT tender_number
    FROM public.tender_registry
    WHERE tender_number IS NOT NULL
    GROUP BY tender_number
    HAVING count(*) > 1
  LOOP
    -- Каноничная строка: самая заполненная (richness), тай-брейк — ранняя created_at.
    -- Здесь живут даты/хронология/пакет/ручная сумма — основная работа пользователя.
    SELECT id INTO keep_id
    FROM public.tender_registry r
    WHERE r.tender_number = rec_num.tender_number
    ORDER BY (
        (r.submission_date         IS NOT NULL)::int
      + (r.construction_start_date IS NOT NULL)::int
      + (r.site_visit_date         IS NOT NULL)::int
      + (r.invitation_date         IS NOT NULL)::int
      + (r.commission_date         IS NOT NULL)::int
      + (NULLIF(r.object_address, '')     IS NOT NULL)::int
      + (NULLIF(r.object_coordinates, '') IS NOT NULL)::int
      + (NULLIF(r.chronology, '')         IS NOT NULL)::int
      + (NULLIF(r.has_tender_package, '') IS NOT NULL)::int
      + (r.manual_total_cost     IS NOT NULL)::int
      + (jsonb_array_length(COALESCE(r.chronology_items, '[]'::jsonb))     > 0)::int
      + (jsonb_array_length(COALESCE(r.tender_package_items, '[]'::jsonb)) > 0)::int
      + (r.is_archived)::int
    ) DESC, r.created_at ASC, r.id ASC
    LIMIT 1;

    -- Источник АКТУАЛЬНОГО статуса: строка с осмысленным статусом и самым свежим
    -- updated_at. Осмысленный = не дефолтная пустышка (dashboard_status <> 'calc'
    -- ИЛИ статус не «В работе»). Нужно потому, что финальный статус (напр.
    -- «Проиграли»/«Ожидаем тендерный пакет») мог быть проставлен на ДРУГОЙ версии,
    -- а не на самой заполненной строке. NULL → осмысленного статуса нет, оставляем
    -- статус каноничной строки.
    SELECT r.id INTO status_src
    FROM public.tender_registry r
    LEFT JOIN public.tender_statuses st ON st.id = r.status_id
    WHERE r.tender_number = rec_num.tender_number
      AND ( r.dashboard_status IS DISTINCT FROM 'calc'
            OR (r.status_id IS NOT NULL AND st.name <> 'В работе') )
    ORDER BY r.updated_at DESC NULLS LAST, r.created_at DESC, r.id DESC
    LIMIT 1;

    -- Слить непустые пользовательские поля из дублей в каноничную строку + перенести
    -- актуальный статус. Триггер trigger_auto_archive_tender_registry пересчитает
    -- is_archived по новому status_id (для «Выиграли»/«Проиграли»/«В работе»/«Ожидаем»).
    UPDATE public.tender_registry k
    SET
      submission_date         = COALESCE(k.submission_date,         s.submission_date),
      construction_start_date = COALESCE(k.construction_start_date, s.construction_start_date),
      commission_date         = COALESCE(k.commission_date,         s.commission_date),
      site_visit_date         = COALESCE(k.site_visit_date,         s.site_visit_date),
      site_visit_photo_url    = COALESCE(NULLIF(k.site_visit_photo_url, ''), s.site_visit_photo_url),
      invitation_date         = COALESCE(k.invitation_date,         s.invitation_date),
      object_address          = COALESCE(NULLIF(k.object_address, ''),      s.object_address),
      object_coordinates      = COALESCE(NULLIF(k.object_coordinates, ''),  s.object_coordinates),
      chronology              = COALESCE(NULLIF(k.chronology, ''),          s.chronology),
      has_tender_package      = COALESCE(NULLIF(k.has_tender_package, ''),  s.has_tender_package),
      manual_total_cost       = COALESCE(k.manual_total_cost,       s.manual_total_cost),
      chronology_items        = CASE
                                  WHEN jsonb_array_length(COALESCE(k.chronology_items, '[]'::jsonb)) > 0
                                    THEN k.chronology_items ELSE s.chronology_items END,
      tender_package_items    = CASE
                                  WHEN jsonb_array_length(COALESCE(k.tender_package_items, '[]'::jsonb)) > 0
                                    THEN k.tender_package_items ELSE s.tender_package_items END,
      status_id               = COALESCE(src.status_id, k.status_id),
      dashboard_status        = COALESCE(src.dashboard_status, k.dashboard_status),
      is_archived             = COALESCE(src.is_archived, k.is_archived),
      updated_at              = NOW()
    FROM (
      SELECT
        (array_agg(submission_date         ORDER BY created_at) FILTER (WHERE submission_date IS NOT NULL))[1]         AS submission_date,
        (array_agg(construction_start_date ORDER BY created_at) FILTER (WHERE construction_start_date IS NOT NULL))[1] AS construction_start_date,
        (array_agg(commission_date         ORDER BY created_at) FILTER (WHERE commission_date IS NOT NULL))[1]         AS commission_date,
        (array_agg(site_visit_date         ORDER BY created_at) FILTER (WHERE site_visit_date IS NOT NULL))[1]         AS site_visit_date,
        (array_agg(site_visit_photo_url    ORDER BY created_at) FILTER (WHERE NULLIF(site_visit_photo_url, '') IS NOT NULL))[1] AS site_visit_photo_url,
        (array_agg(invitation_date         ORDER BY created_at) FILTER (WHERE invitation_date IS NOT NULL))[1]         AS invitation_date,
        (array_agg(object_address          ORDER BY created_at) FILTER (WHERE NULLIF(object_address, '') IS NOT NULL))[1]      AS object_address,
        (array_agg(object_coordinates      ORDER BY created_at) FILTER (WHERE NULLIF(object_coordinates, '') IS NOT NULL))[1]  AS object_coordinates,
        (array_agg(chronology              ORDER BY created_at) FILTER (WHERE NULLIF(chronology, '') IS NOT NULL))[1]          AS chronology,
        (array_agg(has_tender_package      ORDER BY created_at) FILTER (WHERE NULLIF(has_tender_package, '') IS NOT NULL))[1]  AS has_tender_package,
        (array_agg(manual_total_cost       ORDER BY created_at) FILTER (WHERE manual_total_cost IS NOT NULL))[1]       AS manual_total_cost,
        (array_agg(chronology_items        ORDER BY created_at) FILTER (WHERE jsonb_array_length(COALESCE(chronology_items, '[]'::jsonb)) > 0))[1]     AS chronology_items,
        (array_agg(tender_package_items    ORDER BY created_at) FILTER (WHERE jsonb_array_length(COALESCE(tender_package_items, '[]'::jsonb)) > 0))[1] AS tender_package_items
      FROM public.tender_registry
      WHERE tender_number = rec_num.tender_number
        AND id <> keep_id
    ) s
    LEFT JOIN LATERAL (
      SELECT status_id, dashboard_status, is_archived
      FROM public.tender_registry
      WHERE id = status_src
    ) src ON TRUE
    WHERE k.id = keep_id;

    -- Удалить дубли (FK на tender_registry нет — безопасно).
    DELETE FROM public.tender_registry
    WHERE tender_number = rec_num.tender_number
      AND id <> keep_id;
  END LOOP;
END $$;
