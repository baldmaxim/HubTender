-- =============================================================================
-- 2026_07_client_positions_rich_runs.sql — зачёркивание (strikethrough) из Excel.
--
-- SCOPE: добавляет nullable-колонку public.client_positions.rich_runs (jsonb) для
-- хранения информации о зачёркнутом тексте, извлечённой при импорте BOQ из Excel.
-- Колонка — только для отображения на странице позиции заказчика; каноничные
-- плоские поля (work_name/item_no/client_note/volume) остаются нетронутыми.
--
-- Формат значения:
--   {
--     "work_name":   [{"t":"обычный ","s":false},{"t":"зачёркнутый","s":true}],
--     "item_no":     [{"t":"...","s":true}],
--     "client_note": [...],
--     "volume_struck": true
--   }
-- Текстовые поля — массив ранов (частичное зачёркивание), volume_struck — булев
-- флаг (число зачёркнуто целиком либо нет). Заполняется только при наличии
-- зачёркивания, иначе NULL.
--
-- Каноничный аналог — колонка rich_runs в db/yandex/sql/03_tables.sql.
-- Идемпотентно: ADD COLUMN IF NOT EXISTS.
-- Транзакция (BEGIN/COMMIT) — на стороне apply-скрипта.
-- =============================================================================

ALTER TABLE public.client_positions
    ADD COLUMN IF NOT EXISTS rich_runs jsonb;

COMMENT ON COLUMN public.client_positions.rich_runs IS
    'Зачёркивание из Excel для отображения: {work_name|item_no|client_note: StrikeRun[], volume_struck: bool}. NULL если нет зачёркивания.';
