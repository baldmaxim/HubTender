# App-Auth Migration Plan — полный уход от Supabase Auth

> План перехода с Supabase Auth (GoTrue) на собственный **Go app-auth**.
> **В этом документе ничего не реализуется и не деплоится.** Код / production
> env / `DATABASE_URL` / Supabase SDK не меняются. Секреты в git не попадают.
> Связано: [19](./19_RUNTIME_CUTOVER_PLAN.md), [20](./20_RUNTIME_CUTOVER_READINESS.md),
> [21](./21_PRODUCTION_ENV_READINESS.md),
> `docs/yandex-migration/04_AUTH_STRATEGY.md`.

- Дата (UTC): 2026-05-18
- Состояние факт-чек по коду выполнен (см. §4–6) — перед реализацией сверять
  заново, состояние может измениться.

## 1. Current state

- Yandex DB содержит **`auth.users` compatibility table** (Option A bridge):
  `id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, role,
  …` + GoTrue token-колонки (DEFAULT `''`). FK `public.users.id → auth.users`.
- `auth.users.encrypted_password` перенесён **byte-to-byte** (не рехеширован).
- bcrypt verification пройдена: `YANDEX_AUTH_VERIFY_OK` (33/33 hash match,
  bcrypt smoke ✓).
- Бизнес-БД на Yandex; миграционные гейты зелёные
  (`SCHEMA_VERIFY_OK`/`DATA_IMPORT_OK`/`YANDEX_VERIFY_OK`/`YANDEX_AUTH_VERIFY_OK`/
  `GO_BFF_YANDEX_VERIFY_OK`).
- **Bridge-mode:** Supabase Auth всё ещё выпускает JWT; Go BFF валидирует
  Supabase JWT (JWKS/issuer = `ocauafggjrqvopxjihas`). Auth drift decision —
  RESOLVED (login only; registration/reset/email/password change disabled до
  app-auth).

## 2. Target state

- Go BFF выпускает **собственные access/refresh токены** (RS256, свой JWKS +
  issuer).
- Frontend больше **не использует `supabase.auth`** — отдельный app-auth
  client.
- Из runtime удаляются `SUPABASE_JWKS_URL` / `SUPABASE_JWT_ISSUER` (и Supabase
  Auth-зависимость middleware).
- Пользователи логинятся **старым паролем** (bcrypt из `auth.users.
  encrypted_password`) через Go BFF — без сброса.
- Supabase project больше **не нужен для auth** (закрытие/архив — отдельным
  шагом после стабилизации).

## 3. Backend tasks

- `POST /api/v1/auth/login` — email+пароль → bcrypt compare → access+refresh.
- `POST /api/v1/auth/register` — создать `auth.users` + `public.users`
  (роль/доступ как в `register_user`), выдать токены (учесть auth drift
  decision: регистрация может быть закрыта/только-admin до решения).
- `POST /api/v1/auth/logout` — инвалидация refresh (удалить/отметить хэш).
- `POST /api/v1/auth/refresh` — ротация refresh, новый access.
- `POST /api/v1/auth/forgot-password` — выпуск reset-токена (хэш в БД),
  отправка письма (см. §7 — blocker).
- `POST /api/v1/auth/reset-password` — проверка reset-токена (по хэшу, TTL,
  one-time) → новый bcrypt.
- `GET /api/v1/auth/me` **или** существующий `GET /api/v1/me`, но
  валидирующий **app JWT**.
- Заменить Supabase JWKS/issuer на **app JWKS/issuer** в middleware и
  `main.go`; опубликовать app JWKS endpoint (`SigningKey.PublicJWKS()`).
- **refresh tokens** хранить только в **хэшированном** виде.
- **password reset tokens** хранить только хэшированными, one-time, с TTL.
- **Не логировать** пароли / access / refresh / reset-токены / bcrypt-хэши.
- Rate-limiting на `login` / `forgot-password` (обязательный TODO).

## 4. Existing backend/internal/auth status (факт по коду)

| Файл | Что есть | Статус |
|---|---|---|
| `backend/internal/auth/password.go` | `HashPassword`, `ComparePassword`, `HashCost=10`, `ErrPasswordMismatch`; Supabase-совместимый bcrypt-префикс (тест `password_test.go`) | ✅ готово |
| `backend/internal/auth/issuer.go` | `Issuer`/`IssuerConfig`/`NewIssuer`, `IssueAccessToken(userID,email,role)`, `IssueRefreshToken()`, `AccessClaims`, `AccessTTL()`, `SigningKey()` (RS256 access+refresh; тест `issuer_test.go`) | ✅ готово |
| `backend/internal/auth/keys.go` | `SigningKey`, `LoadSigningKey`, `JWK`/`JWKSet`, `PublicJWKS()`, kid = RFC 7638 thumbprint | ✅ готово |
| `backend/internal/middleware/auth.go` | `JWTAuth`/`VerifyToken` через `keyfunc` + `supabaseClaims`, `expectedIssuer` = Supabase; `AuthUser{ID,Email}` в `CtxUser` | ⚠️ привязан к **Supabase JWT** — нужен переключатель на app JWKS/issuer |
| `backend/cmd/server/main.go` | `keyfunc.NewDefault([cfg.SupabaseJWKSURL])` + `JWTAuth(kf, issuer)`; `POST /api/v1/users/register` = post-signup insert в `public.users` (не app-auth register); `GET /api/v1/me` валидирует Supabase JWT | ⚠️ нет `/api/v1/auth/*` маршрутов; JWKS/issuer = Supabase |

**Чего не хватает (нужно реализовать):**
- HTTP handlers: `backend/internal/handlers/auth*.go` — login/register/logout/
  refresh/forgot-password/reset-password (+ опц. JWKS endpoint).
- Сервис/репозиторий auth: выдача/ротация/инвалидация refresh, reset-токены.
- Переключение middleware (`VerifyToken`) и `main.go` keyfunc с Supabase JWKS
  на app JWKS/issuer (config: `APP_JWT_PRIVATE_KEY`/`APP_JWT_ISSUER`/
  `APP_JWKS_URL` вместо `SUPABASE_JWKS_URL`/`SUPABASE_JWT_ISSUER`).
- Регистрация маршрутов `/api/v1/auth/*` в `main.go` (login/register/refresh/
  forgot/reset — public; logout/me — за auth-middleware).
- `claims` для app JWT (sub/email/role) вместо `supabaseClaims`.

Готово: bcrypt + JWT issuer + JWKS-ключи + их unit-тесты. Не готово: HTTP-слой,
storage refresh/reset, проводка, middleware-swap.

## 5. Database tasks

- **Решение по storage паролей** (выбрать одно):
  - **Вариант A (быстрее):** оставить `auth.users.encrypted_password` как
    storage; app-auth читает/пишет туда. Минимальные изменения, сохраняет
    bridge-таблицу.
  - **Вариант B (чище, целевой):** `app_auth.password_credentials`
    (`user_id` FK → `public.users`, `password_hash`, `updated_at`),
    мигрировать `auth.users.encrypted_password` → `app_auth`, переписать FK,
    убрать зависимость от схемы `auth`.
  - Рекомендация: **A на первом этапе** (минимум риска, login старым паролем
    работает сразу), **B — последующим рефактором**.
- Новые таблицы (схема `app_auth`):
  - `refresh_tokens` (`id`, `user_id`, `token_hash`, `expires_at`,
    `created_at`, `revoked_at`, опц. `user_agent`/`ip`) — хранить **хэш**.
  - `password_reset_tokens` (`user_id`, `token_hash`, `expires_at`,
    `used_at`) — one-time, TTL, **хэш**.
  - опц. `auth_audit` (login/logout/refresh/reset события; без секретов).
- Миграции — отдельным `db/yandex/sql`-подобным набором/обычной миграцией;
  применять через тот же gated apply-механизм (не в этом промте).
- Никаких bcrypt-рехэшей при миграции хранилища (byte-to-byte перенос).

## 6. Frontend tasks (факт по call-sites)

| Файл | Текущие `supabase.auth.*` | Замена |
|---|---|---|
| `src/lib/supabase/client.ts` | `createClient(url, anonKey, …)` (init Auth client) | оставить только если ещё нужен Supabase для не-auth; auth убрать |
| `src/lib/api/client.ts:37` | `supabase.auth.getSession()` → Bearer для Go BFF | брать app access token из app-auth client |
| `src/contexts/AuthContext.tsx` | `getSession()` (70), `signOut()` (81), `onAuthStateChange()` (97) | app session-проверка + `GET /api/v1/me` (app JWT); свой listener/refresh |
| `src/pages/Auth/Login.tsx` | `signInWithPassword` (43), `signOut` (130/192/249) | `POST /api/v1/auth/login` |
| `src/pages/Auth/Register.tsx` | `signUp` (31), `signOut` (75/112) | `POST /api/v1/auth/register` (учесть auth drift gate) |
| `src/pages/Auth/ForgotPassword.tsx` | `resetPasswordForEmail` (21) | `POST /api/v1/auth/forgot-password` |
| `src/pages/Auth/ResetPassword.tsx` | `getSession` (39/105), `onAuthStateChange` (64), `signOut` (83), `updateUser` (112) | `POST /api/v1/auth/reset-password` (по reset-токену) |

План:
- создать **`src/lib/auth/client.ts`** (login/register/logout/refresh/forgot/
  reset, хранение session/access/refresh, авто-refresh access по истечению,
  выдача Bearer для `src/lib/api/client.ts`).
- хранение токенов: access в памяти; refresh — httpOnly cookie (предпочтительно)
  либо безопасное хранилище; **не** класть refresh в localStorage без
  необходимости.
- заменить `signInWithPassword`/`signUp`/`signOut`/`resetPasswordForEmail`/
  `updateUser`/`getSession`/`onAuthStateChange` на вызовы `src/lib/auth/client`.
- `AuthContext` переключить на app-сессию (`GET /api/v1/me` с app JWT).

## 7. Email / reset password

- Supabase больше **не шлёт письма** (recovery/confirmation).
- Нужно выбрать **SMTP / email-провайдер** (напр. SMTP relay, SES, Postmark,
  Resend — решение оператора).
- **До выбора провайдера `forgot/reset` остаётся blocker** для полного
  отключения Supabase Auth.
- Dev-режим: при `APP_ENV=development` допустимо возвращать reset-link в ответе
  (никогда в prod). В prod — только письмо.

## 8. Cutover strategy

1. Реализовать app-auth в **dev/staging** (handlers + storage + JWKS-swap за
   feature-flag/конфигом).
2. **Dual verification:** один и тот же пользователь/пароль:
   - old Supabase login работает (bridge ещё активен);
   - Go app-auth login работает тем же паролем (bcrypt из `auth.users`).
3. Frontend switch (за флагом): `src/lib/auth/client` вместо `supabase.auth`.
4. Прогнать gates (§10) на staging.
5. Production: переключить middleware/issuer на app JWKS, **удалить**
   `SUPABASE_JWKS_URL`/`SUPABASE_JWT_ISSUER` из runtime.
6. Наблюдение; затем удалить Supabase SDK из фронта (отдельный PR).
7. Закрыть/архивировать Supabase project (последним, после стабилизации —
   он до этого rollback-путь auth).

## 9. Risks

- **Auth drift** после DB cutover (пока Supabase Auth активен) — закрыто
  decision-ом (registration/reset/email/password change disabled), но усиливает
  срочность app-auth.
- **Password reset provider** не выбран — blocker forgot/reset.
- **Refresh token security** — только хэш в БД, ротация, инвалидация,
  кража/replay.
- **JWT key rotation** — план ротации RSA-ключа + kid, перекрытие старого
  JWKS на TTL.
- **Session invalidation** — logout/смена пароля должны рвать активные
  refresh; access живёт до TTL (короткий).
- **Admin/user status compatibility** — `access_status`/`access_enabled`/
  `role_code` должны проверяться app-auth так же, как сейчас (роль в access
  claims ≠ Supabase PostgREST `authenticated`).
- Расхождение `auth.users` ↔ `public.users` при register/reset — единая
  транзакция.

## 10. Gates (Go только если все ✅)

| Gate | Status |
|---|---|
| Backend auth tests OK (`go test ./...` incl. новые auth-хендлеры) | ☐ |
| Frontend build OK (`npm run build`, `npm run lint`) | ☐ |
| Login старым паролем OK (bcrypt из `auth.users.encrypted_password`) | ☐ |
| Refresh OK (ротация, старый refresh инвалидирован) | ☐ |
| Logout OK (refresh отозван) | ☐ |
| Forgot/Reset OK (email provider выбран; токены хэшированы, one-time, TTL) | ☐ |
| `GET /api/v1/me` OK с **app JWT** | ☐ |
| Supabase Auth env (`SUPABASE_JWKS_URL`/`ISSUER`) больше не требуется runtime | ☐ |
| `grep -rn "supabase.auth"` по `src/` — чисто | ☐ |
| Dual-verification (old Supabase + app-auth, один пароль) пройдена | ☐ |

## 11. Recommended next implementation order

1. **DB:** выбрать storage (рекоменд. Вариант A) + миграции `app_auth.
   refresh_tokens` / `password_reset_tokens` (+опц. audit).
2. **Backend handlers:** `login` → `me (app JWT)` → `refresh` → `logout`
   (минимальный рабочий цикл на старых паролях, без email).
3. **Middleware/main.go:** конфиг app JWKS/issuer + переключатель
   (флаг/конфиг), оставив Supabase как fallback до cutover.
4. **Dual verification** на staging (§8.2) — gate перед фронтом.
5. **Frontend:** `src/lib/auth/client.ts` + замена call-sites (§6) за флагом;
   `AuthContext` на app-сессию.
6. **Email provider** (решение оператора) → `forgot/reset`.
7. **register** (с учётом auth drift decision — закрыта/admin-only до решения).
8. Прогнать §10 gates → production swap → удалить Supabase Auth env →
   (позже) убрать Supabase SDK → архив Supabase project.

---

> Статус: **PLAN ONLY — NOT IMPLEMENTED.** Код / env / SDK / `.env.example` не
> менялись; реализация — отдельные авторизованные этапы по порядку §11.
