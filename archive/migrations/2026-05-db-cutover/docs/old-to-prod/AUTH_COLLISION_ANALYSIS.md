# Auth collision analysis: OLD → PROD

Generated: `2026-05-12T04:30:49.118Z`  
Source: live SELECT via Supabase MCP (read-only).

OLD: `wkywhjljrhewfpedbjzx`  
PROD: `ocauafggjrqvopxjihas`

**Recommendation: `clean-prod`**
> Email + id совпадают, но 2 пользователей сменили пароль и 1 имеют дрейф метаданных. OLD — truth-of-record (live prod). --resume не пройдёт (требует byte-identical). Рекомендуется TRUNCATE auth.users/auth.identities на PROD + full re-import из OLD. PROD-only данных в auth НЕТ (все 32 пользователей PROD есть на OLD).

## Сводка

| Метрика | Значение |
|---|---:|
| auth.users на OLD | 33 |
| auth.users на PROD | 32 |
| intersection_count (same id) | 32 |
| OLD-only users | 1 |
| PROD-only users | 0 |
| same id + same email + same password hash | 29 |
| same id + same email + different password hash | 2 |
| same id + different email | 0 |
| same email + different id | 0 |
| same id + same email + same pw, метаданные дрейфуют | 1 |
| identity (provider, provider_id) collisions | 0 |
| OLD-users без email-identity | 29 |
| PROD-users без email-identity | 0 |

## Blockers

_none_

## Warnings

- ⚠ **PASSWORD_HASH_DRIFT** — count=2. Same id+email but different password hash — пароль был сменён на одной из сторон после первого импорта. Truth-of-record должен быть OLD (live prod).
- ⚠ **USER_META_DRIFT** — count=1. Метаданные пользователя (raw_user_meta_data / raw_app_meta_data) разошлись.
- ⚠ **OLD_USERS_WITHOUT_IDENTITY** — count=29. OLD-пользователи без auth.identities — исторические записи до того, как Supabase Auth начал требовать identity-row.
- ⚠ **OLD_ONLY_USERS** — count=1. Пользователь(и) есть на OLD, но не на PROD — будут добавлены в любом сценарии.

## OLD-only users (будут добавлены)

- `747928c0-e0be-472f-b082-a687986d8b4d`

## Same id, **разные password sha256** (truth = OLD)

| user_id | OLD pw_sha256 | PROD pw_sha256 |
|---|---|---|
| `d5309c31-5157-4da0-8d85-6b2cda9ba8d4` | `d745e1085363cbf9…` | `6ad3dcdcf28f4c21…` |
| `eafa3aec-d7fa-49e9-9d9d-16650512ea0f` | `500e82806cf0a62b…` | `10a53d5a7a4de6a1…` |

## Same id, метаданные дрейфуют (email+pw совпадают)

| user_id | user_meta совпадает | app_meta совпадает |
|---|---|---|
| `61a4e42b-1733-4f75-b8ff-a41221f42ff7` | ✓ | ✗ |

## Identity collisions (provider, provider_id_hash)

_none_

## OLD users без email-identity (исторические)

29 пользователей. user_ids:

- `075be1fd-411d-4230-82e4-3c74533e2110`
- `087a4849-5994-439a-8468-8586f4799fad`
- `1da9a0f4-e777-4235-8c78-93d0da49d66d`
- `3465545f-75b4-4677-b610-458cc08465c7`
- `398be2d0-5c3f-4b9a-8991-7003a1232910`
- `4bd3746f-2479-411c-9e41-e40fddb9d762`
- `509b4ae6-8da9-4c06-b2cc-8e5e473baa5b`
- `51d0ff67-df5d-449a-a55e-5b1704ad5cbf`
- `51f57ae3-36d8-4cae-835f-7c0cc91ffceb`
- `61a4e42b-1733-4f75-b8ff-a41221f42ff7`
- `6ae52af3-8e6c-42ab-9863-c86c7405ab80`
- `70a14f2d-3814-494e-938c-9a77606ea5a7`
- `76204f62-f5a8-4767-a17d-9a094ec9a189`
- `7cf1aea7-9b59-482b-bbb4-f3b84e4aa06c`
- `9a9c1c85-7626-45b5-87a5-654d859f4b15`
- `a0ce6ff0-c9f2-4743-89c7-01e88df1d147`
- `b03b4f95-22db-49e4-b560-6deb5018eb6c`
- `bfdcc352-cd72-4ae6-9c28-f4ceef072343`
- `c7996a99-7775-4fb9-94b2-3d004d28a7fe`
- `d33fbf76-ab97-4c82-aedb-2f4483042332`
- `d5309c31-5157-4da0-8d85-6b2cda9ba8d4`
- `e235b79e-d9c6-49d5-bf96-6a6e574c2634`
- `e4d2b78b-981d-496b-873f-dc55efd04084`
- `e89b3cc5-654a-458c-b9cb-39f6c7cea084`
- `eafa3aec-d7fa-49e9-9d9d-16650512ea0f`
- `ef02cb31-4c00-424c-aa83-48d61e75e327`
- `ef7de6df-7cda-4791-9ac4-8e1b8ce3c3da`
- `f24d231b-4d25-4d22-a291-363fc0f28c34`
- `fad4189b-014b-491b-a274-3c4c949a3324`

## PROD users без email-identity

_none_

## Следующий шаг

Для auth phase: clean-prod-AUTH (TRUNCATE auth.users + auth.identities на PROD) → full re-import из OLD.

⚠ Текущий `scripts/old-to-prod/06_import_prod.mjs` НЕ умеет `TRUNCATE auth.users` через `--clean-prod` (`CLEAN_PROD_PROHIBITED` исключает seed-таблицы, но auth schema целиком вне scope clean-prod). Два варианта:

1. **Ручной TRUNCATE auth на PROD** через MCP (одна транзакция), затем обычный import с `--use-mcp-preflight`:
   ```sql
   BEGIN;
   DELETE FROM auth.identities;
   DELETE FROM auth.users;
   COMMIT;
   ```
   (auth.users FK от других таблиц проверить отдельно — public.users FK `auth_users.id` будет каскадить или RESTRICT'ить).

2. **Доработать `06_import_prod.mjs`**, добавив `--clean-auth` гард с `ALLOW_CLEAN_AUTH=true`. Дольше, но безопаснее (двухключевой gate сохраняется).

Затем:
```powershell
$env:ALLOW_AUTH_IMPORT="true"
$env:ALLOW_DISABLE_IMPORT_TRIGGERS="true"
npm run old-to-prod:migrate -- --dry-run --use-mcp-preflight --import-only
```
