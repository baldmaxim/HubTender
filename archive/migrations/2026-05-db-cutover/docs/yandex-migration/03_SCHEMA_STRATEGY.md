# 03. SCHEMA STRATEGY — PROD Supabase → Yandex PostgreSQL

> Стратегия получения чистой схемы для Yandex Managed PostgreSQL. В этом промте схема
> **не генерируется** и `db/yandex/sql/` **не создаётся** — только проектное решение.

Связано: [02_PROD_TO_YANDEX_PLAN.md](./02_PROD_TO_YANDEX_PLAN.md) (Stage 1), [04_AUTH_STRATEGY.md](./04_AUTH_STRATEGY.md).

## 1. Do not use `supabase/schemas/prod.sql` directly

`supabase/schemas/prod.sql` **нельзя** использовать как deploy-source для Yandex:

- генерируется `supabase db dump --schema public` → **только схема `public`**, без `auth`/RLS/триггеров;
- содержит битые cross-schema FK: вместо `auth.users` / `public.roles` встречается `REFERENCES None.None(None)`;
- может содержать или содержит Supabase-specific артефакты (realtime-таблицы, объекты от dump'а);
- не является cleaned deploy-source.

**Использовать только как справочник (reference), не как run-once script.**

## 2. Source of schema

- Источник истины схемы — **`supabase/migrations/`** (упорядоченный прикладной DDL, миграции 1–N).
- Корректные определения cross-schema FK берутся из миграций (напр. `public.users.id → auth.users(id) ON DELETE CASCADE`), а не из `prod.sql`.
- **Cleaned schema generation — отдельная задача** (выход в будущую `db/yandex/sql/`); в этом промте не делается.

## 3. Remove Supabase-internal schemas

В cleaned schema для Yandex **исключить** Supabase-internal схемы и объекты:

- `realtime` (Supabase Realtime; заменён нативным WS-хабом Go BFF)
- `storage`
- `vault`
- `graphql`
- `supabase_migrations`
- `extensions` / `pgsodium` и прочие Supabase-specific объекты, где применимо

## 4. Auth dependency strategy

Сейчас `public.users.id` и ещё ряд public-таблиц ссылаются на `auth.users(id)` (схема Supabase Auth).
Yandex не имеет GoTrue, поэтому нужна стратегия для зависимости от схемы `auth`.

- **Option A — minimal `auth.users` compatibility table:** тонкая таблица `auth.users` (id + минимум
  колонок, включая хранилище bcrypt-хеша) как родитель существующих FK. Минимальные изменения схемы,
  быстрый bridge, но сохраняет искусственную зависимость от схемы `auth`.
- **Option B — `app_auth.password_credentials` + FK rewrite:** перенести `encrypted_password` в
  `app_auth.password_credentials`, переписать FK на `public.users` / app identity table, полностью
  убрать зависимость от схемы `auth`. Чище архитектурно, требует переработки FK и кода auth.

**Рекомендация:** целевая архитектура — **Option B**. Допустимо использовать **Option A как
временный bridge** на ранних этапах, с последующим переходом на Option B. Окончательный выбор и
реализация — **не в этом промте**.

## 5. FK strategy

Public-таблицы, исторически ссылающиеся на `auth.users(id)` (по миграциям/`prod.sql`):

- `public.users.id` → `auth.users(id)` **ON DELETE CASCADE**
- `public.tenders.created_by`
- `public.tender_registry.created_by`
- `public.markup_tactics.user_id`
- `public.import_sessions.user_id`, `public.import_sessions.cancelled_by`
- `public.tender_notes.user_id` (ON DELETE CASCADE)
- `public.comparison_notes.created_by`
- `public.cost_redistribution_results.created_by`

Выбор (увязан с §4):

- сохранить thin `auth.users` как parent FK (**Option A**), **или**
- переписать FK на `public.users` / app identity table (**Option B**).

**Это решение не реализуется в этом промте** — только зафиксировать варианты.

## 6. RLS

- Supabase RLS-политики, использующие `auth.uid()` и роли `authenticated` / `service_role`
  (в текущей схеме: ~16 таблиц, 35+ policy, паттерн `(SELECT auth.uid())`), **не переносить как есть**.
- Контроль доступа после Yandex обеспечивает **Go BFF на уровне приложения**.
- Defence-in-depth RLS возможен **только отдельным проектированием** — через
  `current_setting('app.user_id', true)::uuid` вместо `auth.uid()`, без зависимости от Supabase-ролей.

## 7. SQL functions using `auth.uid()`

Функции/политики, завязанные на `auth.uid()`, перед применением на Yandex:

- переписать на явный параметр `p_user_id`, **или**
- использовать `current_setting('app.user_id', true)::uuid`;
- **не** использовать Supabase `auth.uid()` как внешнюю зависимость.

## 8. pg_notify — сохранить

Realtime Go BFF держится на `LISTEN/NOTIFY`. **Сохранить точно:**

- функцию `public.notify_row_change()`;
- канал `pg_notify` — **`rowchange`**;
- триггеры на таблицах:
  - `tenders`
  - `notifications`
  - `boq_items`
  - `client_positions`
  - `cost_redistribution_results`
  - `construction_cost_volumes`

## 9. Supabase-only `pgrst` channel

Канал PostgREST schema-reload **`pgrst`** — Supabase-only. Если присутствует в схеме —
переносить **не обязательно** (Go BFF его не использует).

## 10. Extensions

- **Не выполнять `CREATE EXTENSION`** в migration SQL для Yandex.
- `pgcrypto` / `uuid-ossp` должны быть включены в настройках Yandex-кластера **до** применения схемы
  (console / CLI / API) — см. [01_YANDEX_TARGET_INVENTORY.md](./01_YANDEX_TARGET_INVENTORY.md) §4.
- Cleaned schema должна избегать schema-qualified вызовов вида `extensions.uuid_generate_v4()` /
  `extensions.gen_random_uuid()` — использовать неквалифицированные имена.
- Текущая схема использует оба: `gen_random_uuid()` (~22) и `uuid_generate_v4()` (~19). Если при
  чистке унифицировать на `gen_random_uuid()` — потребуется только `pgcrypto`; пока обе функции
  используются — нужны оба расширения.

## 11. Audit/history tables — без enforced FK на «живых» родителей

- Audit/history-таблицы намеренно ссылаются на **уже удалённые** родительские строки:
  `boq_items_audit` хранит INSERT/UPDATE/**DELETE**-историю BOQ-элементов, поэтому
  `boq_items_audit.boq_item_id` — это **исторический указатель**, а не живой FK.
- **Enforced FK несовместим с семантикой delete-audit:** он отверг бы импорт исторических
  DELETE-записей по удалённым `boq_items`.
- **Факт PROD:** в live PROD Supabase FK `boq_items_audit.boq_item_id → boq_items` **отсутствует**
  (единственный FK на этой таблице — `changed_by → users`). Базовая миграция ошибочно несла этот
  FK, и cleaned-схема его унаследовала — это schema-fidelity gap.
- **Решение:** cleaned Yandex-схема **намеренно НЕ создаёт** этот FK
  (`db/yandex/sql/06_indexes_constraints.sql`); вместо него — обычный lookup-индекс
  `idx_boq_items_audit_boq_item_id`. `NOT VALID` FK не используется (он всё равно enforce'ит новые
  вставки). Целостность проверяется **audit-history check** (сравнение total / orphan /
  unique-orphan baseline PROD-export ↔ Yandex), а не FK-enforcement. Подробности и диагностика —
  [15_AUDIT_FK_SCHEMA_DECISION.md](./15_AUDIT_FK_SCHEMA_DECISION.md).
