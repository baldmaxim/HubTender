# 03. Auth mapping: OLD Supabase Auth → PROD Supabase Auth

> На этом шаге Supabase Auth ещё **не** заменяется на Go-Auth — оба проекта используют GoTrue (Supabase Auth) в стандартной конфигурации. Замена на Go-Auth — отдельный шаг, после миграции в Yandex (см. [../yandex-migration/01_SUPABASE_AUDIT.md § 13](../yandex-migration/01_SUPABASE_AUDIT.md#13-migration-backlog-последовательность-задач), Этап 2).

## 1. Что переносим из `auth.users`

| Колонка | Перенос | Заметка |
|---|---|---|
| `id` | да | PK; UUID-коллизии практически невозможны |
| `email` | да | UNIQUE — конфликты разрешаем руками до импорта |
| `encrypted_password` | да | bcrypt-хэш, **детерминирован**, переживёт смену проекта |
| `email_confirmed_at` | да | оставляем как есть |
| `confirmed_at` (computed alias) | да | в новых версиях GoTrue вычисляется |
| `raw_user_meta_data` | да | бизнес-метаданные (full_name, avatar и т.д.) |
| `raw_app_meta_data` | да | provider list — на PROD достраиваем `{"provider": "email", "providers": ["email"]}` если пусто |
| `instance_id` | **нет, hardcode** | в Supabase single-tenant всегда `00000000-0000-0000-0000-000000000000` — оставлять OLD-значение нельзя, это поле принадлежит instance OLD-проекта |
| `aud` | **нет, hardcode `'authenticated'`** | то же — поле проекта |
| `role` | да | обычно `'authenticated'`; копируем как есть |
| `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change_token_current` | принудительно `''` | NOT NULL DEFAULT '' — если в дампе NULL, ставим пустую строку |
| `phone`, `phone_confirmed_at`, `phone_change`, `phone_change_token` | да, если есть | в HubTender не используется, но переносим для полноты |
| `email_change`, `email_change_confirm_status` | да | редко используется |
| `created_at`, `updated_at`, `last_sign_in_at` | да | для аналитики |
| `banned_until` | да | если кто-то забанен — пусть остаётся |
| `deleted_at` | да | soft-delete |
| `is_sso_user`, `is_anonymous` | да, если есть | для совместимости с GoTrue ≥ 2.140 |
| `reauthentication_token`, `reauthentication_sent_at` | принудительно `''` / NULL | редко используется |

**Что не переносим внутри `auth.users`:**
- никаких внутренних `instance_id`/`aud` OLD-проекта;
- никаких устаревших колонок (`role` enum-варианты, удалённые в новых версиях GoTrue) — фильтр на стороне импорт-скрипта.

## 2. `auth.identities`

GoTrue использует `auth.identities` для:
- хранения связи юзер ↔ провайдер (email, google, github, …),
- для email/password юзера тоже создаётся identity с `provider='email'`, `provider_id = email`,
- `identity_data` — provider-specific JSONB.

**Решение: переносим полностью.**

| Колонка | Перенос | Заметка |
|---|---|---|
| `id` | да | PK |
| `user_id` | да | FK → auth.users(id) — parent должен быть импортирован первым |
| `provider_id` | да | составной UNIQUE с provider |
| `provider` | да | `'email'`, `'google'`, … |
| `identity_data` | да | JSONB, специфичен для провайдера |
| `last_sign_in_at`, `created_at`, `updated_at` | да | |
| `email` (в новых версиях GoTrue) | да, если есть | |

Если в дампе OLD identity отсутствует для email-юзера (старая Supabase < 2022) — GoTrue создаст её автоматически при первом успешном `signInWithPassword`. Можно опционально проинициализировать самим:

```sql
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider)
SELECT u.email, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email'
FROM auth.users u
WHERE u.email IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email'
  )
ON CONFLICT (provider, provider_id) DO NOTHING;
```

## 3. `auth.sessions` и `auth.refresh_tokens`

**Не переносим.**

Причины:
- сессии привязаны к instance_id OLD-проекта;
- JWT в refresh-токенах подписаны JWT-secret OLD-проекта; на PROD при разных секретах они не валидны;
- даже при идентичном JWT-secret URL issuer-а (`https://<project-ref>.supabase.co/auth/v1`) **в любом случае разный**, и валидация на сервере (`iss` claim) их отвергнет;
- сессия — эфемерное состояние, terminate-нуть всех юзеров в момент cutover — нормальная UX-практика.

**Эффект для пользователя:** при первом запросе после cutover клиент получит 401 → редирект на `/login` → юзер вводит свой OLD-пароль → bcrypt проверка проходит (хэш скопирован) → новая сессия от PROD.

## 4. Старые пароли — будут ли работать

**Да.** GoTrue хранит пароли как `bcrypt`-хэш (cost-factor 10 по умолчанию). bcrypt — **детерминирован** относительно `password + salt`, и не зависит ни от instance_id, ни от JWT-secret. Перенос `encrypted_password` 1:1 → юзер вводит свой старый пароль → bcrypt-сравнение проходит → login успех.

Условия:
- столбец `encrypted_password` должен быть скопирован без изменений (никаких re-hash);
- bcrypt cost-factor одинаковый — он закодирован прямо в хэше (`$2a$10$...`), GoTrue его разберёт.

## 5. Smoke-тест

В `.env.old-to-prod` есть `MIGRATION_SMOKE_EMAIL` + `MIGRATION_SMOKE_PASSWORD`. Это реальная учётка из OLD, которой мы дополнительно проверяем перенос. После dry-run import → выполнить:

```js
// тест-скрипт (создаётся отдельно, не в этом аудите)
import { createClient } from '@supabase/supabase-js';
const supa = createClient(process.env.PROD_SUPABASE_URL, anonKey);
const { data, error } = await supa.auth.signInWithPassword({
  email: process.env.MIGRATION_SMOKE_EMAIL,
  password: process.env.MIGRATION_SMOKE_PASSWORD,
});
if (error) throw error;
console.log('smoke login ok, user.id =', data.user.id);
```

Если ошибка `invalid_credentials` → bcrypt-хэш не перенёсся / запись отсутствует / `email_confirmed_at IS NULL` + у PROD включена `confirm-policy`. Дебаг: посмотреть в `prod_auth_stats.json` для email юзера (хотя сам email замаскирован), проверить `auth.users` SQL'ом под service_role.

**Важно:** в логах smoke-теста **не печатать пароль**. Скрипт читает его из env и использует сразу, не выводя.

## 6. OAuth-only пользователи (`encrypted_password IS NULL`)

Если у юзера в OLD нет пароля (только Google / GitHub / …):

- **Что делаем:** копируем строку `auth.users` (с NULL encrypted_password) и **обязательно** копируем соответствующую запись `auth.identities`.
- **Условие работоспособности на PROD:** OAuth-провайдер должен быть **сконфигурирован** в Supabase Dashboard → Auth → Providers → Google (или какой использовался). Если на PROD провайдер не настроен — юзер не сможет залогиниться, пока провайдер не настроен либо пока юзер не выполнит password-reset.
- **Рекомендация:** перед cutover убедиться, что **все провайдеры, которые есть в OLD `auth.identities.provider`**, настроены и в PROD. Список можно получить из `old_auth_stats.json` → `auth_identities_by_provider`.

## 7. Неподтверждённые email (`email_confirmed_at IS NULL`)

- Копируются как есть.
- Если на PROD политика `Auth → Email Auth → Confirm email = ON` (по умолчанию), такие юзеры не смогут залогиниться, пока не подтвердят email через присланную ссылку. На login GoTrue вернёт `Email not confirmed`.
- **Варианты:**
  - **A (рекомендуется):** при импорте принудительно проставить `email_confirmed_at = now()` для всех — считаем, что live-prod email-ы уже фактически подтверждены (если юзер активно использовал OLD).
  - **B:** оставить как есть, на PROD выключить confirm-policy, потом включить обратно после фазы переноса.
  - **C:** оставить как есть, юзеры пройдут confirm заново — UX-потеря.

Решение принимается за пределами этого документа (бизнес-решение). По умолчанию в импорт-скриптах применяем **вариант A**.

## 8. JWT secret — должен ли совпадать?

**Короткий ответ: не обязательно, лучше разный.**

| Сценарий | Что произойдёт | Стоит ли |
|---|---|---|
| **JWT secret разный (PROD ≠ OLD)** | Все живые токены с OLD получат `invalid signature` на PROD → редирект на /login → юзер заново вводит пароль → новые токены подписаны PROD-секретом. Это явный, чистый cutover. | **Да, рекомендуется.** |
| **JWT secret одинаковый (PROD = OLD)** | Старые токены с OLD продолжат **подписываться валидно**, но JWT issuer (`iss`) у PROD — другой URL, и Go BFF проверяет `iss == SUPABASE_JWT_ISSUER`. Поэтому Go BFF всё равно их отвергнет. Эффект — тот же relogin, но с лишним недопониманием «почему signature валидна, а login всё равно нужен». | Не стоит, добавляет путаницы без выгоды. |

В terms of API: `SUPABASE_JWT_SECRET` (env var Go BFF) — это base64 от symmetric key, выдаётся Supabase в Dashboard → Settings → JWT. Должен быть выставлен **PROD-секрет** в .env Go BFF. То же касается `SUPABASE_JWKS_URL` — должен указывать на PROD `https://ocauafggjrqvopxjihas.supabase.co/auth/v1/.well-known/jwks.json`.

## 9. Что произойдёт, если JWT secret разный (детальная картинка)

1. Клиент с активной OLD-сессией шлёт запрос `Authorization: Bearer <old_jwt>`.
2. Go BFF (с PROD-секретом + PROD-issuer) валидирует JWT → подпись не совпала → 401.
3. Фронт-обёртка [src/lib/api/client.ts](../../src/lib/api/client.ts) ловит 401, перенаправляет на `/login`.
4. Юзер вводит email + пароль (тот же, что в OLD).
5. `supabase.auth.signInWithPassword` идёт **в PROD Supabase URL** (он уже подменён в .env), GoTrue PROD сверяет bcrypt-хэш скопированного `encrypted_password` → совпало → выдаёт новый JWT, подписанный PROD-секретом.
6. Клиент сохраняет новую сессию в localStorage (`autoRefreshToken: true`).
7. Дальше — обычная работа.

**Окно недоступности для юзера:** 1 редирект + 1 ввод пароля. Если у юзера сохранён пароль в браузере — браузер автоподставит, окно сокращается до 1 клика.

## 10. Контроль безопасности

- `MIGRATION_SMOKE_PASSWORD` хранится в `.env.old-to-prod` — файл gitignored.
- Никакой скрипт в `scripts/old-to-prod/` **не логирует** ни пароль, ни encrypted_password, ни full email, ни connection string. Только агрегаты и маскированные email-ы (`j***@example.com`).
- Все запросы к auth-таблицам идут с service_role connection string — это server-only ключ, в браузер никогда не попадает.
- При экспорте дампа `auth.users` через `pg_dump --data-only` файл с хэшами **никогда не коммитится** в git и хранится в `.old-to-prod-export/` (тоже gitignored).
