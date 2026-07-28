-- Этап 3.1 (RC1, schema-equivalence gate): client_positions.section_number /
-- position_name.
--
-- Контекст: production УЖЕ содержит обе колонки (исторически, до cutover);
-- baseline получил их только в 19c40f5 («0-F2 baseline gap»), но инкрементальной
-- миграции не существовало. Из-за этого любой путь «schema из git + migration
-- chain» (upgrade rehearsal, схема с нуля от main) собирал БД БЕЗ колонок,
-- которые читает prepared-redistribution pipeline
-- (backend/internal/repository/redistribution_prepared.go: SELECT ...,
-- section_number, COALESCE(position_name, '')).
--
-- На production миграция — no-op (IF NOT EXISTS). Колонки nullable, additive,
-- без default-rewrite: короткий lock, безопасно в любой момент.

ALTER TABLE public.client_positions
    ADD COLUMN IF NOT EXISTS section_number text,
    ADD COLUMN IF NOT EXISTS position_name text;
