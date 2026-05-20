# Next phase — App-auth migration

После DB cutover на Yandex и завершения Phase 5 (frontend Supabase
business migration) единственным runtime-зависимостью от Supabase
остаётся **Supabase Auth bridge** (выдача и валидация JWT). Этот файл —
короткое summary плана перехода; полная версия в
`docs/yandex-migration/22_APP_AUTH_MIGRATION_PLAN.md`.

## Зачем

| Сейчас | После app-auth |
|---|---|
| Login через Supabase Auth | Login через Go BFF `/api/v1/auth/login` |
| ES256 JWT выдаёт Supabase | ES256/HS256 JWT выдаёт Go BFF |
| JWKS на supabase.co | JWKS на tender.su10.ru или внутренний key |
| `@supabase/supabase-js` в bundle | удаление пакета |
| 2 внешних зависимости (Yandex + Supabase Auth) | 1 (только Yandex) |
| Невозможно полностью отключить Supabase project | Можно |

## Phase 6 scope (кратко)

- Backend:
  - `POST /api/v1/auth/login` (email/password → JWT)
  - `POST /api/v1/auth/refresh` (refresh token)
  - `POST /api/v1/auth/logout`
  - `POST /api/v1/auth/register` (если оставляем self-service)
  - `POST /api/v1/auth/forgot-password`, `/reset-password`
  - hash passwords с bcrypt (или argon2) — `auth.users.encrypted_password`
    уже содержит bcrypt-хеши, перенесённые с Supabase
  - issue ES256 JWT с теми же claims (`sub`, `email`, `exp`, `iat`) +
    свой `iss` (`https://tender.su10.ru/auth/v1` или подобный)
  - `/auth/v1/.well-known/jwks.json` endpoint
- Frontend:
  - заменить `supabase.auth.signInWithPassword` на `fetch('/api/v1/auth/login')`
  - заменить `supabase.auth.signOut` на `fetch('/api/v1/auth/logout')`
  - заменить `supabase.auth.getSession` / `onAuthStateChange` на
    `localStorage` + событие через WS hub
  - удалить `@supabase/supabase-js` из `package.json`
  - удалить `src/lib/supabase/client.ts`
  - переменные `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` —
    убрать из `.env*`
- Backend env:
  - сгенерировать ES256 keypair, private — в vault, public — раздаётся
    через JWKS endpoint
  - `SUPABASE_JWKS_URL` / `SUPABASE_JWT_ISSUER` — убрать или переименовать
- Smoke / verification:
  - проверить что login работает
  - проверить что existing JWT (Supabase ES256) перестают приниматься
    после grace period
  - проверить что `bcrypt` hash compare работает на 33+ существующих
    юзеров без password reset

## Не делать в этом этапе

- Не менять схему `auth.users` / `auth.identities` — данные уже там
- Не сбрасывать пароли — bcrypt уже совместим
- Не трогать Yandex DB кроме добавления endpoint для login
- Не менять frontend routing / роли

## Risks

- **Grace period**: пока действующие Supabase JWT (выпущенные до cutover)
  не истекли, нужно временно принимать ОБА issuer (Supabase + own). Это
  усложнение в JWT-валидации middleware.
- **Email-confirmation / password-reset**: сейчас email отправляет
  Supabase. Нужно либо SMTP-провайдер (Sendgrid/Mailgun) либо локальный
  postfix. Без email-flow self-service registration сломается.
- **OAuth**: если есть OAuth-логин (Google/etc), он завязан на Supabase
  Auth и потребует отдельной интеграции.
- **Audit log**: `auth.audit_log_entries` — Supabase-specific. После
  app-auth нужно решить, делать ли свой audit или дропать.

## Pre-conditions для старта Phase 6

- [x] DB на Yandex стабильно ≥ 30 дней под нагрузкой (FRONTEND_DEPLOY_OK
      2026-05-21 — стартовая точка отсчёта)
- [ ] Решён вопрос с email-провайдером
- [ ] Сгенерирован ES256 keypair, vault-storage настроен
- [ ] Backup/restore Yandex настроены и протестированы
- [ ] OAuth-зависимости (если есть) проинвентаризованы

## Полный план

См. `docs/yandex-migration/22_APP_AUTH_MIGRATION_PLAN.md` — детальный
дизайн с этапами, моделями данных, JWT-структурой, тестовым планом.
