# 02. Data mapping: OLD Supabase → PROD Supabase

> Этот документ описывает, **какая колонка в OLD → какая колонка в PROD**, что с этим делать на лету и какова стратегия при конфликте. Заполняется на основе baseline-схемы из [supabase/migrations/](../../supabase/migrations/) + правок, обнаруженных скриптом `npm run old-to-prod:compare` и записанных в `.old-to-prod-export/schema_diff.md`.

## 0. Общий подход

- OLD и PROD имеют общий baseline (PROD-миграции 1–9 — это снимок OLD по состоянию на 2026-04-20). Базовая стратегия: **identity mapping** «таблица в таблицу, колонка в колонку», без переименований.
- Расхождения (миграции 10–14, дополнительные таблицы PROD, drift на OLD) обрабатываются в исключениях ниже.
- Импорт идёт под `service_role` (обходит RLS). Триггеры на PROD во время импорта **остаются включёнными** — `pg_notify`-триггеры не страшны (нет подписчиков на time of cutover), `handle_updated_at` корректен (NEW.updated_at будет переписан текущим временем — мы передадим явное `updated_at` в INSERT, и это переживёт триггер; либо примем, что `updated_at` сбросится в `now()`), `log_boq_items_changes` создаст по 1 audit-строке на BOQ-INSERT (приемлемо как «история начала с миграции»), `auto_create_tender_registry` создаст лишние строки в `tender_registry`, если переносить `tenders` без отключения триггера → **до импорта `tenders` триггер `trigger_auto_create_tender_registry` выключается** через `ALTER TABLE public.tenders DISABLE TRIGGER trigger_auto_create_tender_registry` (требует superuser; на Supabase это работает через service_role на migration-only окно).
- Порядок импорта — топологический по FK, parents → children. Сначала reference-таблицы и `auth.users`, затем `public.users`, дальше всё остальное (см. § 3).

## 1. Главная mapping-таблица

Базовая запись для большинства таблиц — «one-to-one». Здесь перечислены только **значимые** случаи; все остальные таблицы из `public.*` импортируются как `INSERT INTO prod.public.<t> SELECT * FROM old.public.<t>` (с поправкой на порядок колонок).

| OLD table | OLD column | PROD table | PROD column | Transformation | Nullable / default handling | Conflict policy | Risk |
|---|---|---|---|---|---|---|---|
| `auth.users` | `id` | `auth.users` | `id` | none | NOT NULL (PK) | `ON CONFLICT (id) DO NOTHING` | low — UUID collision крайне маловероятен |
| `auth.users` | `email` | `auth.users` | `email` | none | nullable (allowed in Supabase Auth) | если в PROD уже есть строка с тем же id — оставить PROD; если другой id с тем же email — блокер, разрешать руками | high — дубль email на PROD → UNIQUE violation |
| `auth.users` | `encrypted_password` | `auth.users` | `encrypted_password` | none | nullable (OAuth-only) | копируем bcrypt-хэш как есть | medium — без переноса юзер не залогинится |
| `auth.users` | `email_confirmed_at` | `auth.users` | `email_confirmed_at` | none | nullable | копируем; неподтверждённые останутся неподтверждёнными | low |
| `auth.users` | `raw_user_meta_data` | `auth.users` | `raw_user_meta_data` | none | nullable, default `{}` | copy as-is | low |
| `auth.users` | `raw_app_meta_data` | `auth.users` | `raw_app_meta_data` | **set `provider`/`providers` если в OLD пусто** | nullable, default `{}` | merge: PROD-defaults + OLD-keys | low |
| `auth.users` | `instance_id` | `auth.users` | `instance_id` | **PROD-instance_id**, не копируем OLD | NOT NULL | hardcode = `00000000-0000-0000-0000-000000000000` (single-tenant Supabase) | low |
| `auth.users` | `aud` | `auth.users` | `aud` | **`'authenticated'`** | NOT NULL | hardcode | low |
| `auth.users` | `confirmation_token`, `recovery_token`, `email_change_token_*` | (same) | (same) | **обнулить** в '' (Supabase NOT NULL DEFAULT '') | NOT NULL DEFAULT '' | set '' | low |
| `auth.users` | `created_at`, `updated_at`, `last_sign_in_at` | (same) | (same) | none | nullable / now() | copy | low |
| `auth.identities` | `provider_id` | `auth.identities` | `provider_id` | none | NOT NULL | `ON CONFLICT (provider_id, provider) DO NOTHING` | medium |
| `auth.identities` | `user_id` | `auth.identities` | `user_id` | none | NOT NULL FK → auth.users.id | требует, чтобы parent уже был импортирован | medium |
| `auth.identities` | `identity_data` | `auth.identities` | `identity_data` | none | NOT NULL jsonb | copy as-is | medium — provider-specific |
| `auth.identities` | `provider` | `auth.identities` | `provider` | none | NOT NULL | copy | low |
| `auth.identities` | `email` | `auth.identities` | `email` | none | nullable (старые версии Supabase не имели этой колонки) | copy or NULL | low |
| `auth.sessions` | * | — | — | **НЕ ПЕРЕНОСИМ** | n/a | n/a | low — все юзеры relogin'утся |
| `auth.refresh_tokens` | * | — | — | **НЕ ПЕРЕНОСИМ** | n/a | n/a | low |
| `public.users` | `id` | `public.users` | `id` | none | NOT NULL (PK, FK → auth.users.id) | `ON CONFLICT (id) DO NOTHING` | low |
| `public.users` | `role_code` | `public.users` | `role_code` | проверить, что роль есть в `public.roles` PROD; если нет — fallback `'engineer'` | NOT NULL | copy | high — enum drift |
| `public.users` | `allowed_pages` | `public.users` | `allowed_pages` | none | nullable, default `[]` | copy | low |
| `public.users` | `access_status` | `public.users` | `access_status` | none | NOT NULL default `'pending'` | copy | low |
| `public.tenders` | `*` | `public.tenders` | `*` | если в OLD нет `cached_grand_total` — set 0; если нет `volume_title` — set `'Полный объём строительства'`; `apply_subcontract_*_growth` — set true | NOT NULL вновь добавленные → default | `ON CONFLICT (id) DO NOTHING` | medium |
| `public.tenders` | `markup_tactic_id` | `public.tenders` | `markup_tactic_id` | проверить наличие в PROD `public.markup_tactics`; если ссылка orphan — NULLify | nullable | NULL if missing | medium |
| `public.client_positions` | `*` | `public.client_positions` | `*` | none | identical schema (high baseline coverage) | `ON CONFLICT (id) DO NOTHING` | low |
| `public.boq_items` | `*` | `public.boq_items` | `*` | none | identical | `ON CONFLICT (id) DO NOTHING` | low (но audit-trigger создаст N строк в `boq_items_audit`) |
| `public.boq_items_audit` | `*` | `public.boq_items_audit` | `*` | **импортировать ПОСЛЕ boq_items, иначе FK сломается** | identical | `ON CONFLICT (id) DO NOTHING` | low |
| `public.cost_redistribution_results` | `*` | `public.cost_redistribution_results` | `*` | таблица **ENABLE RLS** на PROD (миграция 13) — импорт под service_role | identical | `ON CONFLICT (id) DO NOTHING` | medium |
| `public.tender_registry` | `*` | `public.tender_registry` | `*` | **до импорта `tenders` выключить триггер `trigger_auto_create_tender_registry`**, чтобы registry-строки не дублировались | identical | `ON CONFLICT (id) DO NOTHING` | high — побочка триггера |
| `public.markup_tactics` | `*` | `public.markup_tactics` | `*` | none | identical | `ON CONFLICT (id) DO NOTHING` | low |
| `public.tender_iterations` | `*` | `public.tender_iterations` | `*` | **может отсутствовать в OLD** (если миграция новая); если так — пропустить | identical | `ON CONFLICT (id) DO NOTHING` | medium |
| `public.tender_groups` / `_group_members` | `*` | (same) | `*` | то же — может не быть в OLD | identical | `ON CONFLICT (id) DO NOTHING` | medium |
| `public.subcontract_growth_exclusions` | `*` | (same) | `*` | то же | identical | `ON CONFLICT (id) DO NOTHING` | medium |
| `public.notifications` | `*` | (same) | `*` | none | identical | `ON CONFLICT (id) DO NOTHING` | low |
| `public.user_position_filters` / `user_tasks` / `tender_notes` | `*` | (same) | `*` | none | identical | `ON CONFLICT (id) DO NOTHING` | low |
| `public.roles` | `*` | `public.roles` | `*` | **в PROD seed-данные уже есть** (миграция 9). Применять `ON CONFLICT (code) DO NOTHING` — PROD-seed побеждает. | identical | PROD wins | low |
| `public.units` | `*` | `public.units` | `*` | то же — PROD-seed wins | identical | PROD wins | low |
| `public.cost_categories` / `detail_cost_categories` | `*` | (same) | `*` | то же — PROD-seed wins, нестандартные OLD-категории попадают через `INSERT ... ON CONFLICT (id) DO NOTHING` | identical | PROD-id wins | low |
| `public.markup_parameters` | `*` | `public.markup_parameters` | `*` | PROD-seed wins | identical | PROD-id wins | low |
| `public.tender_statuses` / `construction_scopes` | `*` | (same) | `*` | PROD-seed wins | identical | PROD-id wins | low |
| `public.material_names` / `work_names` | `*` | (same) | `*` | none | identical | `ON CONFLICT (id) DO NOTHING` | low |
| `public.materials_library` / `works_library` / `library_folders` | `*` | (same) | `*` | none | identical | `ON CONFLICT (id) DO NOTHING` | low |
| `public.templates` / `template_items` | `*` | (same) | `*` | none | identical | `ON CONFLICT (id) DO NOTHING` | low |
| `public.import_sessions` | `*` | (same) | `*` | none | identical | `ON CONFLICT (id) DO NOTHING` | low |
| `public.construction_cost_volumes` | `*` | (same) | `*` | none | identical | `ON CONFLICT (id) DO NOTHING` | low |
| `public.tender_insurance` | `*` | (same) | `*` | none | UNIQUE (tender_id) | `ON CONFLICT (tender_id) DO NOTHING` | low |
| `public.tender_markup_percentage` | `*` | (same) | `*` | none | UNIQUE (tender_id, markup_parameter_id) | `ON CONFLICT ... DO NOTHING` | low |
| `public.tender_pricing_distribution` | `*` | (same) | `*` | может отсутствовать в OLD | UNIQUE (tender_id, markup_tactic_id) | `ON CONFLICT ... DO NOTHING` | medium |
| `public.projects` / `project_additional_agreements` / `project_monthly_completion` | `*` | (same) | `*` | none | identical | `ON CONFLICT (id) DO NOTHING` | low |
| `public.tender_documents` | `*` | (same) | `*` | может отсутствовать в OLD | identical | `ON CONFLICT (id) DO NOTHING` | medium |
| `public.comparison_notes` | `*` | (same) | `*` | none | identical | `ON CONFLICT (id) DO NOTHING` | low |

## 2. Спец-случаи

### 2.1 `auth.users.instance_id` и `aud`

В Supabase single-tenant `instance_id` = `00000000-0000-0000-0000-000000000000`, `aud` = `'authenticated'`. Они **не копируются** из OLD как есть, а ставятся явно — это поля Supabase Auth, и они должны соответствовать конкретному проекту. Скрипт импорта:

```sql
INSERT INTO auth.users (id, instance_id, aud, email, encrypted_password, email_confirmed_at, ...)
SELECT id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', email, encrypted_password, email_confirmed_at, ...
FROM <staging.auth_users>
ON CONFLICT (id) DO NOTHING;
```

### 2.2 NOT NULL token-колонки

`confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change_token_current` в `auth.users` — `NOT NULL DEFAULT ''`. Если выгрузка OLD приходит без них (старая Supabase-схема), импорт-скрипт принудительно ставит `''`.

### 2.3 RLS на PROD

15+ таблиц PROD имеют RLS (см. [00000000000008_baseline_rls.sql](../../supabase/migrations/00000000000008_baseline_rls.sql)). Для импорта **обязательно** использовать service_role-подключение (bypass RLS). Альтернатива — `SET LOCAL row_security = off` в одной транзакции (требует superuser; через service_role работает).

### 2.4 `cost_redistribution_results`

Получила RLS в миграции 13. В OLD скорее всего RLS выключен. Решение: импорт под service_role, после импорта RLS уже включён и работает на новый трафик.

### 2.5 `cached_grand_total` и компании

Колонка `tenders.cached_grand_total` (миграция baseline) — derived value. После импорта данных запустить:

```sql
SELECT public.recalculate_tender_grand_total(id) FROM public.tenders;
```

— функция уже есть в PROD ([supabase/migrations/00000000000005_baseline_functions.sql:1386](../../supabase/migrations/00000000000005_baseline_functions.sql#L1386)).

### 2.6 Аудит-логи

`boq_items_audit` на каждый INSERT в `boq_items` создаст одну строку из-за триггера `trg_boq_items_audit` (`log_boq_items_changes`). Если в OLD были `boq_items_audit` строки — они импортируются **после** `boq_items`. Дубли (миграционные INSERT + старые audit) разрешаются:
- либо отключением триггера на время импорта `boq_items` (требует superuser);
- либо оставляем дубль — это история.

Рекомендация: отключить триггер на время импорта (`ALTER TABLE public.boq_items DISABLE TRIGGER trg_boq_items_audit;`), импортировать `boq_items`, затем `boq_items_audit`, затем `ENABLE TRIGGER`.

## 3. Порядок импорта (топологический)

1. **Reference & enums** (PROD-seed уже есть, OLD добавляет только пользовательские):
   - `public.units`, `public.roles`, `public.construction_scopes`, `public.tender_statuses`, `public.markup_parameters`, `public.cost_categories`, `public.detail_cost_categories`, `public.material_names`, `public.work_names`.
2. **Auth**:
   - `auth.users` (с instance_id/aud override),
   - `auth.identities`.
3. **Public users**:
   - `public.users` (FK → auth.users.id).
4. **Tactics & libraries**:
   - `public.markup_tactics`, `public.library_folders`, `public.materials_library`, `public.works_library`.
5. **Tenders & registry** (триггер `trigger_auto_create_tender_registry` — выкл):
   - `public.tender_registry`, `public.tenders`, затем включить триггер обратно.
6. **Tender meta**:
   - `public.tender_insurance`, `public.tender_markup_percentage`, `public.tender_pricing_distribution`, `public.tender_documents`, `public.tender_notes`.
7. **Tender timeline** (если есть в OLD):
   - `public.tender_groups`, `public.tender_group_members`, `public.tender_iterations`.
8. **BOQ** (триггер `trg_boq_items_audit` — выкл):
   - `public.client_positions`, `public.boq_items`, затем `public.boq_items_audit`, затем включить триггер обратно.
9. **Derived & misc**:
   - `public.construction_cost_volumes`, `public.subcontract_growth_exclusions`, `public.cost_redistribution_results`.
10. **Templates** (могут быть пустыми):
    - `public.templates`, `public.template_items`.
11. **Projects**:
    - `public.projects`, `public.project_additional_agreements`, `public.project_monthly_completion`.
12. **Operational**:
    - `public.import_sessions` (с поправкой: `user_id` FK → auth.users — должен уже быть), `public.notifications`, `public.user_position_filters`, `public.user_tasks`.
13. **Comparison**:
    - `public.comparison_notes`.
14. **Recalc derived values**:
    - `SELECT public.recalculate_tender_grand_total(id) FROM public.tenders;`

## 4. Конфликт-политика per scope

| Scope | Policy | Rationale |
|---|---|---|
| `id`-коллизия (одинаковый UUID в OLD и PROD) | `DO NOTHING` (OLD не перезаписывает PROD) | PROD-данные — авторитетные после baseline; OLD импорт идёт первым, поэтому коллизия означает «уже импортировали» |
| `email`-коллизия в `auth.users` (разные id) | блокер, разрешить руками | UNIQUE-constraint `auth.users_email_key`; нужно человеческое решение, какая учётка остаётся |
| seed-таблицы (`roles`, `units`, …) | PROD-seed побеждает | PROD-seed согласован с приложением; OLD-кастомные строки попадают через `DO NOTHING` (новый id) |
| derived (`cached_grand_total`) | recalc после импорта | сохранять OLD-значение бессмысленно — оно может расходиться с фактическим суммированием PROD-данных |

## 5. Что НЕ переносится

| Объект | Почему |
|---|---|
| `auth.sessions` | привязаны к JWT-secret конкретного проекта |
| `auth.refresh_tokens` | то же |
| `auth.audit_log_entries` | внутренний лог Supabase Auth, не нужен в PROD |
| `auth.flow_state`, `auth.mfa_*`, `auth.saml_*`, `auth.sso_*`, `auth.one_time_tokens` | служебные, если не использовались — пусто; если использовались — отдельный анализ |
| `storage.*` | в OLD пусто (см. yandex audit) |
| `realtime.*`, `vault.*`, `graphql.*` | служебные Supabase-схемы |
| Системные функции PROD-миграций 10/12/13/14 | уже на PROD, переноса не требуют |
| RLS-политики | создаются миграцией PROD-baseline-8, переноса не требуют |
