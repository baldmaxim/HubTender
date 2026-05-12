# 04. Risks: OLD Supabase → PROD Supabase migration

> Risk register. Каждый риск: вероятность × impact, как обнаружить, как смитигировать. Обновляется после первого прогона `npm run old-to-prod:compare`.

## Легенда

- **Probability:** low / medium / high
- **Impact:** low / medium / high / catastrophic
- **Detection:** где увидим, что риск сработал
- **Mitigation:** что делаем до import-а
- **Owner:** кто решает

---

## R-01. User ID collisions

| | |
|---|---|
| **Probability** | low — UUID-коллизия для случайно сгенерированных uuid_generate_v4() value ≈ 2⁻¹²² |
| **Impact** | catastrophic — если коллизия случилась, два разных физических юзера склеятся в одного |
| **Detection** | `npm run old-to-prod:introspect-old` → `old_auth_stats.json`. Сравнить `auth.users.id` OLD vs `auth.users.id` PROD до импорта: `SELECT id FROM auth.users INTERSECT SELECT id FROM ...` (через staging). |
| **Mitigation** | До импорта проверить пересечение. Если 0 строк — risk закрыт. Если есть — каждый случай разбирается руками: либо это «уже импортированный» юзер (тот же email/имя/пароль) → DO NOTHING, либо реальная коллизия → новый UUID для одного из. |
| **Owner** | tech lead |

## R-02. Email collisions (разные id, одинаковый email)

| | |
|---|---|
| **Probability** | low-medium — могло возникнуть, если в OLD юзер регистрировался дважды (старый аккаунт + новый с тем же email) |
| **Impact** | high — UNIQUE constraint `auth.users_email_key` упадёт на INSERT |
| **Detection** | `old_auth_stats.json` → `duplicate_emails_in_auth[]`. Email-ы там замаскированы (`j***@example.com`). Для разрешения смотреть исходную БД OLD под service_role. |
| **Mitigation** | До импорта руками решить, какой из аккаунтов остаётся: оставляем более новый (`MAX(created_at)`), у остальных меняем email на `<id>+legacy@old.local`. Импортируем после правки. |
| **Owner** | product / customer success — нужно решить, чьи данные «победят» |

## R-03. Enum drift (значения в OLD, которых нет в PROD)

| | |
|---|---|
| **Probability** | medium — за полгода в OLD могли добавить значения вне миграций |
| **Impact** | high — `INSERT ... ENUM` упадёт с `invalid input value for enum public.<type>: "<value>"` |
| **Detection** | `schema_diff.md` → секция «🚨 Blockers» → «Enum values present in OLD but missing in PROD». |
| **Mitigation** | До импорта в PROD выполнить `ALTER TYPE public.<type> ADD VALUE 'X'` для каждого. **`ALTER TYPE` нельзя в транзакции** — выполнять отдельным statement через service_role. |
| **Owner** | tech lead |

## R-04. Missing FK targets (orphan rows)

| | |
|---|---|
| **Probability** | low — обычно FK в OLD блокируют orphan'ов |
| **Impact** | high — INSERT child-таблицы упадёт |
| **Detection** | `npm run old-to-prod:introspect-old` → `old_auth_stats.json.orphan_public_users` (юзер в public.users, нет в auth.users). Аналогично для `tenders.created_by`, `markup_tactics.user_id` и других FK на auth.users. |
| **Mitigation** | Топологическая сортировка import-а (см. [02_DATA_MAPPING.md § 3](02_DATA_MAPPING.md#3-порядок-импорта-топологический)) гарантирует, что parent-таблица импортируется первой. Перед import-ом запустить query на orphan-проверку и зафиксировать счётчики в audit-логе. Если есть orphan-rows в OLD (их FK не сработал) — либо чинить OLD до экспорта, либо фильтровать на импорт. |
| **Owner** | tech lead |

## R-05. Stale RLS policies на PROD

| | |
|---|---|
| **Probability** | high — PROD-baseline миграция 8 включает RLS на 15+ таблиц |
| **Impact** | medium — если import делать НЕ под service_role, INSERT молча отфильтруется (RLS не позволяет вставить) |
| **Detection** | `prod_schema.json.tables[].rls_enabled` = true для RLS-таблиц, при этом import-скрипт использует anon-key или авторизованного юзера. После импорта row counts в PROD = 0 для этих таблиц. |
| **Mitigation** | Любой import обязательно через **service_role**-connection string. В коде import-скрипта при запуске проверять `current_user = 'postgres'` или `current_setting('role') = 'service_role'` — если нет, abort. Альтернатива — `SET LOCAL row_security = off` на импорт-транзакцию (работает только под service_role). |
| **Owner** | tech lead |

## R-06. Trigger side effects во время импорта

| | |
|---|---|
| **Probability** | high — на PROD ~31 trigger + 6 pg_notify + audit + auto_create_tender_registry |
| **Impact** | medium-high — могут возникнуть лишние строки (auto_create_tender_registry дублирует записи), лишние audit-строки (log_boq_items_changes), всплеск нагрузки на pg_notify |
| **Detection** | После dry-run импорта сравнить row counts ожидаемые vs фактические (`*_rowcounts.json` baseline + после импорта). Дельта в `tender_registry`, `boq_items_audit` укажет на лишние срабатывания. |
| **Mitigation** | На время импорта выключать **конкретные** триггеры через `ALTER TABLE ... DISABLE TRIGGER <name>` (работает под service_role): |
| | • `trigger_auto_create_tender_registry` — выключить ДО import-а `tenders`, включить ОБРАТНО ПОСЛЕ; |
| | • `trg_boq_items_audit` — выключить ДО `boq_items`, включить ПОСЛЕ; |
| | • `trg_boq_items_grand_total` и другие `*_update_grand_total` — оставить, либо тоже выключить и потом единоразово вызвать `recalculate_tender_grand_total()`; |
| | • `trg_notify_row_change_*` — **оставить**, подписчиков на time of cutover нет. |
| **Owner** | tech lead |

## R-07. `auth.users` ↔ `auth.identities` mismatch

| | |
|---|---|
| **Probability** | medium — особенно для OAuth-юзеров |
| **Impact** | high — OAuth-юзер не сможет залогиниться через провайдер; email-юзер залогинится, но GoTrue лениво создаст identity |
| **Detection** | Сверить counts: `prod_auth_stats.auth_users_count` vs `auth_identities_count` после импорта. Для OAuth — `auth_identities_by_provider` сравнить с OLD. |
| **Mitigation** | Импортировать `auth.users` и `auth.identities` **в одной транзакции** (или последовательно с проверкой counts после каждого шага). Для email-only юзеров без identity — выполнить INSERT-восстановление (см. [03_AUTH_MAPPING.md § 2](03_AUTH_MAPPING.md#2-auth-identities)). На PROD убедиться, что все OAuth-провайдеры из OLD `auth.identities.provider` настроены в Dashboard. |
| **Owner** | tech lead + ops (Supabase Dashboard) |

## R-08. Loss of sessions

| | |
|---|---|
| **Probability** | certainty — sessions не переносятся |
| **Impact** | low — UX-побочка |
| **Detection** | юзеры получат 401 при первом запросе после cutover |
| **Mitigation** | Заранее предупредить пользователей (баннер «обновление сервиса, потребуется перезайти»). На фронте обернуть 401 в `/login`-redirect (уже есть в [src/lib/api/client.ts](../../src/lib/api/client.ts)). |
| **Owner** | product |

## R-09. Write window during cutover

| | |
|---|---|
| **Probability** | high — пока копируем данные, активные юзеры могут писать в OLD |
| **Impact** | medium-high — новые строки появятся в OLD после snapshot и не попадут в PROD → потеря данных |
| **Detection** | Сравнить `old_rowcounts.json` до и после import-окна для нескольких таблиц-«канареек» (`boq_items`, `client_positions`, `notifications`). |
| **Mitigation** | На cutover-окно переводим OLD в read-only: |
| | ```sql |
| | ALTER DATABASE postgres SET default_transaction_read_only = on; |
| | -- даёт ошибку на любые DML; SELECT и DDL остаются |
| | ``` |
| | После cutover откатывать **не нужно** — OLD-проект архивируется в любом случае. Если нужно вернуться — `SET default_transaction_read_only = off`. |
| **Owner** | ops |

## R-10. Несовместимость schema (column missing/extra)

| | |
|---|---|
| **Probability** | medium — drift на OLD за полгода |
| **Impact** | high — INSERT упадёт на missing column в PROD |
| **Detection** | `schema_diff.md` → секции «Columns present in OLD but missing in PROD» и «Columns added in PROD». |
| **Mitigation** | Для OLD-only колонок — два варианта: либо данные не нужны (просто не SELECT их при импорте), либо нужны → добавить колонку в PROD через миграцию `ALTER TABLE ADD COLUMN`. Для PROD-only NOT NULL колонок без default — задать значение при INSERT (см. [02_DATA_MAPPING.md § 2](02_DATA_MAPPING.md#2-спец-случаи)). |
| **Owner** | tech lead |

## R-11. Type drift (text → varchar(N), int → bigint)

| | |
|---|---|
| **Probability** | low |
| **Impact** | high — INSERT упадёт `value too long` или `numeric out of range` |
| **Detection** | `schema_diff.md` → «Column type drift». |
| **Mitigation** | Transformation в импорт-скрипте: при наличии типа OLD `text` → PROD `varchar(255)` — `SUBSTRING(... FROM 1 FOR 255)` с логом обрезанных. На сегодня в baseline таких расхождений не должно быть, но drift возможен. |
| **Owner** | tech lead |

## R-12. RLS на cost_redistribution_results

| | |
|---|---|
| **Probability** | high — на PROD миграция 13 включает RLS, в OLD её нет |
| **Impact** | medium — обычные пользователи (anon, authenticated) после импорта получат другие правила доступа, но business logic вызывает функцию `save_redistribution_results` под service-context — должно работать |
| **Detection** | После импорта проверить: с обычным auth-токеном SELECT/INSERT/UPDATE/DELETE на cost_redistribution_results возвращает 200 для своих строк |
| **Mitigation** | Импорт под service_role bypass'нет RLS. После импорта тестовый login + проверка API call. |
| **Owner** | tech lead |

## R-13. JWT secret mismatch (OLD vs PROD)

| | |
|---|---|
| **Probability** | certainty — секреты разные у разных проектов |
| **Impact** | low — все живые токены инвалидируются на cutover |
| **Detection** | сразу после переключения SUPABASE_URL/JWT_SECRET в .env Go BFF — все запросы с старыми токенами получают 401 |
| **Mitigation** | Принимаем как фичу cutover-а. Фронт умеет это (см. [03_AUTH_MAPPING.md § 9](03_AUTH_MAPPING.md#9-что-произойдёт-если-jwt-secret-разный-детальная-картинка)). |
| **Owner** | принят |

## R-14. OAuth provider не настроен на PROD

| | |
|---|---|
| **Probability** | medium |
| **Impact** | high — OAuth-only юзеры (без пароля) не смогут залогиниться |
| **Detection** | `old_auth_stats.json.auth_identities_by_provider` показывает список провайдеров OLD. Каждый должен быть включён в PROD Supabase Dashboard → Auth → Providers, с теми же `client_id` / `client_secret` / `redirect_url`. |
| **Mitigation** | До cutover-окна — настроить каждый провайдер в PROD Dashboard. Самый частый риск: callback URL должен быть PROD-callback, а не OLD-callback (иначе OAuth-redirect не выйдет). |
| **Owner** | ops |

## R-15. Email confirmation policy

| | |
|---|---|
| **Probability** | medium |
| **Impact** | medium — если на PROD `Confirm email = ON` и при импорте остался `email_confirmed_at IS NULL`, юзер не залогинится без подтверждения письма |
| **Detection** | `old_auth_stats.email_confirmed_null` count. PROD Dashboard → Auth → Email Auth → Confirm email. |
| **Mitigation** | По умолчанию принимаем «Вариант A» из [03_AUTH_MAPPING.md § 7](03_AUTH_MAPPING.md#7-неподтверждённые-email-email_confirmed_at-is-null): импорт ставит `email_confirmed_at = now()` для всех. Это политическое решение product. |
| **Owner** | product |

## R-16. Триггер `auto_create_tender_registry` дублирует строки registry

| | |
|---|---|
| **Probability** | high (если не выключить триггер) |
| **Impact** | high — на каждый импортированный `tenders.INSERT` в `tender_registry` добавляется новая строка, при том что OLD-tender_registry мы тоже импортируем → две записи на тендер |
| **Detection** | После импорта: `SELECT tender_number, COUNT(*) FROM tender_registry GROUP BY tender_number HAVING COUNT(*) > 1` |
| **Mitigation** | Импорт `tender_registry` ДО `tenders`. Перед импортом `tenders` — `ALTER TABLE public.tenders DISABLE TRIGGER trigger_auto_create_tender_registry`. После — `ENABLE TRIGGER`. |
| **Owner** | tech lead |

## Принятые риски (не митигируются)

- **R-08 (loss of sessions)** — accepted, UX уведомление.
- **R-13 (JWT secret mismatch)** — accepted, побочка cutover-а.

## Открытые вопросы для уточнения

- Какая политика на confirm-email в PROD? (см. R-15)
- Все ли OAuth-провайдеры из OLD реально использовались? Если в OLD только email-провайдер — R-14 закрывается. (см. `old_auth_stats.auth_identities_by_provider`)
- Окно cutover-а: какое допустимое время недоступности для пользователей? (влияет на стратегию write-window R-09)
