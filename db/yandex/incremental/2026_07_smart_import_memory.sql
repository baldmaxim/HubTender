-- Этап 2.3: Smart Import Memory — персональные профили сопоставления колонок
-- и подтверждённые номенклатурные aliases.
--
-- Инварианты:
--   * память хранит ТОЛЬКО явно подтверждённые пользователем решения;
--   * никаких financial-полей (цены/qty/totals/курсы), workbook bytes,
--     fingerprint, preview rows, AI prompt/response;
--   * scope строго персональный (user_id); shared/team — backlog;
--   * hard delete каталога НЕ блокируется: alias удаляется каскадом
--     (dangling catalog ID невозможен);
--   * миграция idempotent (повторное применение безопасно), unsafe down
--     path отсутствует намеренно.

-- ── Профили сопоставления колонок ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.boq_import_mapping_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    normalized_header_signature text NOT NULL CHECK (length(normalized_header_signature) > 0),
    mapping_schema_version integer NOT NULL,
    normalization_version integer NOT NULL,
    mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
    fixed_options jsonb NOT NULL DEFAULT '{}'::jsonb,
    sheet_name_hint text,
    header_row_hint integer,
    is_active boolean NOT NULL DEFAULT true,
    use_count integer NOT NULL DEFAULT 0,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boq_import_mapping_profiles_user_sig
    ON public.boq_import_mapping_profiles (user_id, normalized_header_signature)
    WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_boq_import_mapping_profiles_user
    ON public.boq_import_mapping_profiles (user_id, updated_at DESC);

-- ── Подтверждённые номенклатурные aliases ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nomenclature_import_aliases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    catalog_kind text NOT NULL CHECK (catalog_kind IN ('material', 'work')),
    material_name_id uuid REFERENCES public.material_names(id) ON DELETE CASCADE,
    work_name_id uuid REFERENCES public.work_names(id) ON DELETE CASCADE,
    normalized_source_text text NOT NULL CHECK (length(btrim(normalized_source_text)) > 0),
    canonical_boq_item_type text NOT NULL CHECK (length(canonical_boq_item_type) > 0),
    normalized_unit_code text,
    detail_cost_category_id uuid REFERENCES public.detail_cost_categories(id) ON DELETE CASCADE,
    normalization_version integer NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    use_count integer NOT NULL DEFAULT 0,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    -- kind ↔ FK: заполнен ровно один каталожный FK, соответствующий kind.
    CONSTRAINT nomenclature_import_aliases_kind_fk_chk CHECK (
        (catalog_kind = 'material' AND material_name_id IS NOT NULL AND work_name_id IS NULL)
        OR
        (catalog_kind = 'work' AND work_name_id IS NOT NULL AND material_name_id IS NULL)
    )
);

-- Один АКТИВНЫЙ alias-key пользователя → одна номенклатура (§3).
-- В key НЕТ цены/quantity/валюты/тендера/строки/URL/AI confidence.
CREATE UNIQUE INDEX IF NOT EXISTS uq_nomenclature_import_aliases_active_key
    ON public.nomenclature_import_aliases (
        user_id,
        catalog_kind,
        normalized_source_text,
        canonical_boq_item_type,
        COALESCE(normalized_unit_code, ''),
        COALESCE(detail_cost_category_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
    WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_nomenclature_import_aliases_user
    ON public.nomenclature_import_aliases (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_nomenclature_import_aliases_material
    ON public.nomenclature_import_aliases (material_name_id)
    WHERE material_name_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nomenclature_import_aliases_work
    ON public.nomenclature_import_aliases (work_name_id)
    WHERE work_name_id IS NOT NULL;

-- updated_at триггеры (переиспользуем общую функцию проекта).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_updated_at') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_boq_import_mapping_profiles_updated_at') THEN
            CREATE TRIGGER trg_boq_import_mapping_profiles_updated_at
                BEFORE UPDATE ON public.boq_import_mapping_profiles
                FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_nomenclature_import_aliases_updated_at') THEN
            CREATE TRIGGER trg_nomenclature_import_aliases_updated_at
                BEFORE UPDATE ON public.nomenclature_import_aliases
                FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
        END IF;
    END IF;
END $$;
