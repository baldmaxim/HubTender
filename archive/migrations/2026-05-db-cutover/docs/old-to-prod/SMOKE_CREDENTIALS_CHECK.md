# Smoke credentials check (read-only, no DB writes)

> Re-run 2026-05-16 after operator updated `OLD_SUPABASE_ANON_KEY`. Read-only
> Supabase Auth REST probe. No DB modified, no import, no repair, Промт 1.7
> not run. Password / access_token / refresh_token never printed. Email masked.

## Status: **SMOKE_CREDENTIALS_OK** (resolved 2026-05-16)

После исправления пароля в `.env.old-to-prod` обе пробы прошли.

| Step | Result | user_id |
|---|---|---|
| OLD login | **OK** | `d5309c31-5157-4da0-8d85-6b2cda9ba8d4` |
| PROD login | **OK** | `d5309c31-5157-4da0-8d85-6b2cda9ba8d4` (тот же) |
| `npm run old-to-prod:verify-auth` | **AUTH_VERIFY_OK** | — |

Совпадение `user_id` на OLD и PROD доказывает: миграция auth корректна —
тот же аккаунт, тот же пароль (bcrypt byte-identical), логинится на обеих
базах. Прошлые `invalid_credentials` были из-за неверного пароля в `.env`,
не из-за переноса данных.

### History (для аудита)
1. `401 Invalid API key` — устаревший `OLD_SUPABASE_ANON_KEY` → исправлен.
2. `400 invalid_credentials` ×2 — неверный `MIGRATION_SMOKE_PASSWORD` → исправлен.
3. ✅ OLD OK + PROD OK + `AUTH_VERIFY_OK`.

## Results

| Step | Result | Detail |
|---|---|---|
| OLD login | **FAILED** | `HTTP 400 {"error_code":"invalid_credentials","msg":"Invalid login credentials"}` |
| PROD login | **NOT TESTED** | пропущен по спецификации (OLD failed → stop) |
| verify-auth | **NOT RUN** | запускается только если OLD OK И PROD OK |

Smoke email (masked): `o***@gmail.com`

## Анализ (окончательный)

После обновления anon-ключа проба прошла дальше: ошибка сменилась
`401 Invalid API key` → **`400 invalid_credentials`**. Это значит:

- `OLD_SUPABASE_ANON_KEY` теперь **валиден** (REST-запрос принят).
- Пара `MIGRATION_SMOKE_EMAIL` / `MIGRATION_SMOKE_PASSWORD` **не
  аутентифицируется на самом OLD** — источнике истины.

Раз пара не работает даже на OLD, то `HTTP 400` на PROD (в `08_verify_auth`)
**не является дефектом миграции**. Пароль в `.env` для этого аккаунта
неверен/устарел изначально.

## Подтверждение целостности auth-миграции (не зависит от этой пробы)

`AUTH_VERIFY_RESULT.md` DB-проверки — все PASS:
- auth.users old=33 prod=33 ✓
- auth.identities 4 + bootstrap 29 = prod 33 ✓
- passwords match=33 mismatch=0 ✓ (bcrypt byte-identical OLD↔PROD)
- NULL token-column audit total_null=0 ✓ (GoTrue schema-баг устранён, `REPAIR_OK`)
- generated-column audit ✓

Миграция перенесла `encrypted_password` точно. Невозможность залогиниться
smoke-парой одинаково проявляется и на OLD, и на PROD — следовательно
причина в самой паре, а не в переносе.

## Next step

1. Выбрать **реально рабочий low-privilege аккаунт** и проверить, что им
   можно залогиниться на OLD вручную (Supabase Dashboard / приложение).
2. Обновить `MIGRATION_SMOKE_EMAIL` / `MIGRATION_SMOKE_PASSWORD` в
   `scripts/old-to-prod/.env.old-to-prod` на эту проверенную пару
   (не admin/director).
3. Повторить read-only smoke-пробу. Ожидаемо: OLD OK → PROD проба.
   - Если **OLD OK, PROD OK** → `npm run old-to-prod:verify-auth` →
     ожидаем `AUTH_VERIFY_OK` → статус `SMOKE_CREDENTIALS_OK`.
   - Если **OLD OK, PROD FAILED** → blocker `SMOKE_AUTH_MIGRATION_BLOCKED`
     (тогда это уже дефект переноса конкретного аккаунта).
4. К Промту 1.7 / Go BFF verification — **только** после `AUTH_VERIFY_OK`.

## Ничего не запускалось

- DB не изменялась (read-only REST-проба).
- import / repair / migrate / Промт 1.7 — не запускались.
