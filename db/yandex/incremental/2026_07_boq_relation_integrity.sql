-- Этап 2.4 (§8): структурная целостность BOQ-связей.
--
-- Закрывает на уровне БД (аудит §7 подтвердил отсутствие ограничений):
--   1) BOQ item с tender A и позицией tender B;
--   2) parent из другого тендера;
--   3) parent из другой позиции.
-- Self-parent и «parent должен быть работой» остаются application/domain
-- валидацией (§8) — их количество показывает preflight и readiness-audit.
--
-- Свойства:
--   * preflight: read-only проверка ДО DDL; повреждённые данные → понятная
--     ошибка, НИКАКОГО автоматического исправления production rows;
--   * ON DELETE semantics сохранены (CASCADE, как у существующих FK);
--   * ADD CONSTRAINT ... NOT VALID → VALIDATE CONSTRAINT;
--   * idempotent: повторное применение безопасно;
--   * финансовые данные не изменяются; per-row financial triggers не создаются.

-- ── Preflight (read-only) ────────────────────────────────────────────────────
DO $$
DECLARE
    cross_pos     integer;
    cross_parent  integer;
    self_parent   integer;
    parent_nonwork integer;
BEGIN
    SELECT count(*) INTO cross_pos
    FROM public.boq_items b
    JOIN public.client_positions cp ON cp.id = b.client_position_id
    WHERE cp.tender_id <> b.tender_id;

    SELECT count(*) INTO cross_parent
    FROM public.boq_items b
    JOIN public.boq_items p ON p.id = b.parent_work_item_id
    WHERE b.parent_work_item_id IS NOT NULL
      AND (p.tender_id <> b.tender_id OR p.client_position_id <> b.client_position_id);

    -- Информационно (application-валидация, не блокирует DDL):
    SELECT count(*) INTO self_parent
    FROM public.boq_items WHERE parent_work_item_id = id;
    SELECT count(*) INTO parent_nonwork
    FROM public.boq_items b
    JOIN public.boq_items p ON p.id = b.parent_work_item_id
    WHERE p.boq_item_type::text NOT IN ('раб', 'суб-раб');

    RAISE NOTICE 'boq relation preflight: cross_position=%, cross_parent=%, self_parent=%, parent_nonwork=%',
        cross_pos, cross_parent, self_parent, parent_nonwork;

    IF cross_pos > 0 OR cross_parent > 0 THEN
        RAISE EXCEPTION USING
            MESSAGE = format(
                'BOQ relation integrity preflight failed: cross-tender position rows=%s, cross-scope parent rows=%s. '
                'Данные повреждены — исправьте их вручную (см. cmd/production-readiness-audit) и повторите миграцию. '
                'Автоматическое исправление намеренно не выполняется.',
                cross_pos, cross_parent),
            ERRCODE = 'check_violation';
    END IF;
END $$;

-- ── UNIQUE-цели для составных FK (idempotent) ────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'client_positions_id_tender_uniq'
          AND conrelid = 'public.client_positions'::regclass) THEN
        ALTER TABLE public.client_positions
            ADD CONSTRAINT client_positions_id_tender_uniq UNIQUE (id, tender_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'boq_items_id_scope_uniq'
          AND conrelid = 'public.boq_items'::regclass) THEN
        ALTER TABLE public.boq_items
            ADD CONSTRAINT boq_items_id_scope_uniq UNIQUE (id, tender_id, client_position_id);
    END IF;
END $$;

-- ── Составные FK: NOT VALID → VALIDATE (idempotent) ──────────────────────────
DO $$
BEGIN
    -- (client_position_id, tender_id) → client_positions(id, tender_id):
    -- позиция обязана принадлежать ТОМУ ЖЕ тендеру. ON DELETE CASCADE — как у
    -- существующего boq_items_client_position_id_fkey.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'boq_items_position_scope_fkey'
          AND conrelid = 'public.boq_items'::regclass) THEN
        ALTER TABLE public.boq_items
            ADD CONSTRAINT boq_items_position_scope_fkey
            FOREIGN KEY (client_position_id, tender_id)
            REFERENCES public.client_positions (id, tender_id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;

    -- (parent_work_item_id, tender_id, client_position_id) →
    -- boq_items(id, tender_id, client_position_id): parent обязан быть строкой
    -- ТОГО ЖЕ тендера И ТОЙ ЖЕ позиции (MATCH SIMPLE: parent NULL → пропуск).
    -- ON DELETE CASCADE — как у boq_items_parent_work_item_id_fkey.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'boq_items_parent_scope_fkey'
          AND conrelid = 'public.boq_items'::regclass) THEN
        ALTER TABLE public.boq_items
            ADD CONSTRAINT boq_items_parent_scope_fkey
            FOREIGN KEY (parent_work_item_id, tender_id, client_position_id)
            REFERENCES public.boq_items (id, tender_id, client_position_id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;
END $$;

-- VALIDATE: безопасно повторять; NOT VALID-констрейнты валидируются один раз.
DO $$
DECLARE
    c record;
BEGIN
    FOR c IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.boq_items'::regclass
          AND conname IN ('boq_items_position_scope_fkey', 'boq_items_parent_scope_fkey')
          AND NOT convalidated
    LOOP
        EXECUTE format('ALTER TABLE public.boq_items VALIDATE CONSTRAINT %I', c.conname);
    END LOOP;
END $$;
