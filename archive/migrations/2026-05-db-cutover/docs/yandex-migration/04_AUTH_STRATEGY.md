# 04. AUTH STRATEGY — замена Supabase Auth на app-auth в Go

> Стратегия аутентификации после ухода с Supabase. В этом промте код не меняется.
> Состояние backend-кода ниже зафиксировано по фактическому содержимому репозитория.

Связано: [02_PROD_TO_YANDEX_PLAN.md](./02_PROD_TO_YANDEX_PLAN.md) (Stage 2, 5), [03_SCHEMA_STRATEGY.md](./03_SCHEMA_STRATEGY.md) (§4–5).

## 1. Supabase Auth / GoTrue will not run in Yandex

Yandex Managed PostgreSQL — это только PostgreSQL. **GoTrue (Supabase Auth) там не работает.**
Логин/регистрация/refresh/сброс пароля перестанут существовать как Supabase-сервис.

## 2. Need custom app auth in Go BFF

Аутентификацию полностью берёт на себя **Go BFF**: проверка пароля, выпуск JWT, refresh,
сброс пароля, `me`. Без этого переключение на Yandex невозможно.

## 3. Preserve old passwords

- **Source:** PROD Supabase `auth.users.encrypted_password` (bcrypt-хеши).
- **Target:** `app_auth.password_credentials` (рекомендуется) **или** `auth.users` compatibility table
  (см. [03_SCHEMA_STRATEGY.md](./03_SCHEMA_STRATEGY.md) §4).
- bcrypt-хеш копируется **as-is**.
- **Не рехешировать.**
- **Не логировать хеши.**

## 4. Plaintext passwords do not exist

Plaintext-паролей нет ни в source, ни где-либо ещё. Доступен только bcrypt-хеш.

## 5. Supabase access/refresh sessions do not migrate

Старые Supabase access/refresh токены и сессии **не мигрируются**.

## 6. Users will need to log in again

После финального переключения auth все пользователи **логинятся заново** (пароли сохранены —
повторная регистрация не нужна, только повторный вход).

## 7. Текущее состояние `backend/internal/auth/` (по факту в репозитории)

| Файл | Что есть | Статус |
|---|---|---|
| `password.go` | bcrypt hash/compare; поддержка префиксов `$2a$`/`$2b$`/`$2y$`; cost 10 (Supabase-совместимо) | ✅ Реализовано (+ `password_test.go`) |
| `issuer.go` | App JWT issuer RS256: access-token (~15m) + refresh-token (~30d), claims sub/email/role, kid в header | ✅ Реализовано (+ `issuer_test.go`) |
| `keys.go` | RSA key management, kid (RFC 7638 JWK thumbprint), `PublicJWKS()` для JWKS-эндпоинта | ✅ Реализовано |
| HTTP handlers (login/register/logout/refresh/forgot/reset) | — | ❌ **Отсутствуют** |
| Проводка в `backend/cmd/server/main.go` + регистрация маршрутов | — | ❌ **Отсутствует / неполная** |

Связанные факты в коде:

- `GET /api/v1/me` уже существует, но валидирует **Supabase JWT** через middleware.
- `POST /api/v1/users/register` (`handlers/users_write.go`) создаёт строку `public.users` **после**
  Supabase signup — это не самостоятельный app-auth register.
- `backend/internal/middleware/auth.go`: `JWTAuth` + `VerifyToken`, keyfunc через
  `keyfunc.NewDefault([Supabase JWKS URL])`, разбор `supabaseClaims`, `AuthUser{ID,Email}` в `CtxUser`.

> Перед реализацией Stage 2 ещё раз сверять факты с кодом — состояние пакета может измениться.

## 8. Required Go auth endpoints before final switch

До финального переключения реализовать в Go BFF:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `GET /api/v1/auth/me` (или существующий `GET /api/v1/me`, но валидирующий **app JWT**)

## 9. JWT middleware

- **Сейчас:** Supabase JWKS URL + Supabase issuer (`keyfunc.NewDefault`, `supabaseClaims`).
- **Будущее:** собственный JWKS Go BFF (`SigningKey.PublicJWKS()`) + app issuer.
- Логика `VerifyToken` / `JWTAuth` может остаться похожей — меняются **источник ключей и config**
  (JWKS URL, expected issuer), не структура проверки.

## 10. Frontend call-sites to replace

При переводе на app-auth заменить (отдельной задачей, не в этом промте):

- `src/lib/supabase/client.ts` — инициализация Supabase Auth client
- `src/lib/api/client.ts` — извлечение JWT (`supabase.auth.getSession()` → Bearer) для вызовов Go BFF
- `src/contexts/AuthContext.tsx` — `onAuthStateChange` → session-проверка app-auth, `GET /api/v1/me`
- `src/pages/Auth/Login.tsx` — `signInWithPassword` → `POST /api/v1/auth/login`
- `src/pages/Auth/Register.tsx` — `signUp` → `POST /api/v1/auth/register`
- `src/pages/Auth/ForgotPassword.tsx` — `resetPasswordForEmail` → `POST /api/v1/auth/forgot-password`
- `src/pages/Auth/ResetPassword.tsx` — recovery-flow → `POST /api/v1/auth/reset-password`

## 11. Forgot / reset password

- Раньше письма (recovery / confirmation) слал **Supabase Auth**.
- Go BFF потребует собственный **SMTP / email-провайдер** для forgot/reset.
- **Email-провайдер — открытый blocker** для Stage 2 / финального switch.

## 12. Security

- **Не логировать** пароли, bcrypt-хеши, JWT, refresh-токены.
- Refresh-токены хранить **в хешированном виде** (не plaintext в БД).
- Rate-limiting на `login` / `forgot-password` — **обязательная будущая задача (TODO)**.
- TLS `verify-full` на подключении к БД; пароли БД только в Lockbox/Vault.
