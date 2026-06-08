-- =============================================================================
-- 2026_06_timeline_canonicalize.sql — привязка хронологии к НАИМЕНОВАНИЮ тендера.
--
-- ПРОБЛЕМА (план, Задача №2): tender_groups/tender_iterations были привязаны к
-- tender_id КОНКРЕТНОЙ версии тендера. Reconcile исторически писал группы под
-- последней версией, поэтому при создании новой версии записи пользователей
-- «осиротевали» на старом tender_id, а на новой версии группы пересобирались
-- пустыми. Пример: «ЖК Cityzen» (tender_number='316') — записи Шанина/Топчий/
-- Казакова лежат на v2, а интерфейс показывал v3.
--
-- РЕШЕНИЕ: единый стабильный «якорь» на tender_number = МИНИМАЛЬНАЯ версия
-- (тай-брейк — самый ранний created_at). Фронт (useTenders.ts) уже выбирает
-- каноничную (min) версию как selectedTenderId. Эта миграция переносит все
-- существующие группы/участников/записи на каноничный tender_id, схлопывая
-- одноимённые группы с разных версий в одну.
--
-- ИДЕМПОТЕНТНОСТЬ: повторный прогон — no-op (всё уже на каноничном tender_id,
-- target_group совпадает, переносить нечего).
--
-- БЕЗОПАСНОСТЬ: проверено read-only на проде — 0 коллизий
-- (tender_id, name) / (group_id, user_id) / (group_id, user_id, iteration_number).
-- Если редкая коллизия итераций всё же возникнет, исходная группа НЕ удаляется,
-- а в лог пишется NOTICE для ручного разбора (записи не теряются).
--
-- Transaction wrapping (BEGIN/COMMIT) выполняет apply-скрипт, как и для
-- db/yandex/sql/*.sql.
-- =============================================================================

DO $$
DECLARE
    rec_num   record;
    rec_name  record;
    src       record;
    canonical_id  uuid;
    target_group  uuid;
BEGIN
    -- Каждый tender_number, у которого есть хотя бы одна timeline-группа.
    FOR rec_num IN
        SELECT DISTINCT t.tender_number
        FROM public.tender_groups tg
        JOIN public.tenders t ON t.id = tg.tender_id
        WHERE t.tender_number IS NOT NULL
    LOOP
        -- Каноничный tender_id = минимальная версия номера.
        SELECT id INTO canonical_id
        FROM public.tenders
        WHERE tender_number = rec_num.tender_number
        ORDER BY version ASC NULLS LAST, created_at ASC
        LIMIT 1;

        IF canonical_id IS NULL THEN
            CONTINUE;
        END IF;

        -- Каждое уникальное имя группы среди всех версий номера.
        FOR rec_name IN
            SELECT DISTINCT tg.name
            FROM public.tender_groups tg
            JOIN public.tenders t ON t.id = tg.tender_id
            WHERE t.tender_number = rec_num.tender_number
        LOOP
            -- Целевая группа: уже существующая на каноничной версии…
            SELECT tg.id INTO target_group
            FROM public.tender_groups tg
            WHERE tg.tender_id = canonical_id AND tg.name = rec_name.name
            LIMIT 1;

            -- …иначе — «продвигаем» к каноничному tender_id группу того же имени
            -- с наибольшим числом записей (тай-брейк — самая ранняя created_at).
            IF target_group IS NULL THEN
                SELECT tg.id INTO target_group
                FROM public.tender_groups tg
                JOIN public.tenders t ON t.id = tg.tender_id
                WHERE t.tender_number = rec_num.tender_number AND tg.name = rec_name.name
                ORDER BY (SELECT count(*) FROM public.tender_iterations i WHERE i.group_id = tg.id) DESC,
                         tg.created_at ASC
                LIMIT 1;

                UPDATE public.tender_groups
                   SET tender_id = canonical_id, updated_at = NOW()
                 WHERE id = target_group;
            END IF;

            -- Все прочие одноимённые группы номера схлопываем в target_group.
            FOR src IN
                SELECT tg.id
                FROM public.tender_groups tg
                JOIN public.tenders t ON t.id = tg.tender_id
                WHERE t.tender_number = rec_num.tender_number
                  AND tg.name = rec_name.name
                  AND tg.id <> target_group
            LOOP
                -- Участники: переносим, дубликаты по user_id отбрасываем.
                UPDATE public.tender_group_members m
                   SET group_id = target_group
                 WHERE m.group_id = src.id
                   AND NOT EXISTS (
                       SELECT 1 FROM public.tender_group_members d
                       WHERE d.group_id = target_group AND d.user_id = m.user_id
                   );
                DELETE FROM public.tender_group_members WHERE group_id = src.id;

                -- Записи: переносим, пропуская коллизии (group_id,user_id,iter_number).
                UPDATE public.tender_iterations i
                   SET group_id = target_group
                 WHERE i.group_id = src.id
                   AND NOT EXISTS (
                       SELECT 1 FROM public.tender_iterations d
                       WHERE d.group_id = target_group
                         AND d.user_id = i.user_id
                         AND d.iteration_number = i.iteration_number
                   );

                -- Удаляем исходную группу только если в ней не осталось записей.
                IF EXISTS (SELECT 1 FROM public.tender_iterations WHERE group_id = src.id) THEN
                    RAISE NOTICE 'group % (name=%, number=%) keeps colliding iterations — left intact for manual review',
                        src.id, rec_name.name, rec_num.tender_number;
                ELSE
                    DELETE FROM public.tender_groups WHERE id = src.id;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
END $$;
