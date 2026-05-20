# Post-migration cleanup inventory

Снимок состояния репозитория после DB-cutover и frontend deploy. Что
оставлено активным, что архивировано, что осталось как bridge.

- Дата (UTC): 2026-05-21
- Cutover branch HEAD: см. `archive/migrations/2026-05-db-cutover/README.md`
- Финальные статусы миграции: `FINAL_DATA_REFRESH_OK`, `FRONTEND_DEPLOY_OK`

## Active runtime — keep

| Что | Где | Зачем |
|---|---|---|
| Frontend SPA | `src/` | Production-фронт; Phase 5 baseline |
| Backend Go BFF | `backend/` | Активный API сервер (через nginx → Yandex) |
| Yandex schema baseline | `db/yandex/sql/` | Source-of-truth схемы applied на Yandex |
| Smoke harness | `scripts/smoke/go-bff.mjs` | `npm run smoke`, активная верификация |
| Dual-run harness | `scripts/dual-run/` | Diff Supabase vs Go (для regression) |
| Cutover row-counts | `scripts/cutover/verify_rowcounts.mjs` | Поддерживаемая утилита |
| Bench harness | `scripts/bench/` | Performance compare |
| Future-phase plan | `docs/yandex-migration/22_APP_AUTH_MIGRATION_PLAN.md` | Phase 6 — app-auth |
| Active docs | `docs/ARCHITECTURE.md`, `docs/RUNTIME_ENV.md`, `docs/NEXT_PHASE_APP_AUTH.md` | Новые post-migration docs |
| Page-level docs | `docs/{CLIENT_POSITIONS,TENDERS,DASHBOARD_*,…}.md` | Дизайн/функционал |
| Supabase Auth bridge | `src/lib/supabase/client.ts`, `supabase.auth.*` | JWT bridge до Phase 6 |
| Supabase JWT middleware | `backend/internal/middleware/auth.go` | JWKS verify до Phase 6 |
| `@supabase/supabase-js` | `package.json` | Используется Auth bridge |

## Migration archive — moved

Перенесено в `archive/migrations/2026-05-db-cutover/`:

| Что | Откуда | Куда |
|---|---|---|
| 29 docs миграции | `docs/yandex-migration/{00..21,23..27}_*.md` + `YANDEX_TARGET_INVENTORY.md` + `01_SUPABASE_AUDIT.md` | `archive/.../docs/yandex-migration/` |
| 17 docs OLD→PROD | `docs/old-to-prod/` (всё) | `archive/.../docs/old-to-prod/` |
| 19 scripts OLD→PROD | `scripts/old-to-prod/` | `archive/.../scripts/old-to-prod/` |
| 16 scripts PROD→Yandex | `scripts/prod-to-yandex/` | `archive/.../scripts/prod-to-yandex/` |
| 2 scripts Yandex preflight | `scripts/yandex-preflight/` | `archive/.../scripts/yandex-preflight/` |

**Исключения** (НЕ перенесены, оставлены в активной части):

- `docs/yandex-migration/22_APP_AUTH_MIGRATION_PLAN.md` — план следующей
  Phase 6, остался в `docs/yandex-migration/`
- `db/yandex/sql/` — applied schema baseline, остался в `db/`

## Delete local-only / ignored artefacts

Эти артефакты в `.gitignore`, в git их нет, но рекомендуется удалить
**локально** после успешного cutover'а:

| Что | Размер | Где |
|---|---|---|
| `.old-to-prod-export/` | manifest + ndjson всех таблиц OLD | local |
| `.prod-to-yandex-export/` | manifest + ndjson всех таблиц PROD | local |
| `.certs/` | Yandex root CA (`yandex-ca.pem`) для скриптов | local (если не нужен для dev) |
| `.migrations/` (если был) | временные dump'ы | local |
| Реальные env-файлы | `scripts/old-to-prod/.env.old-to-prod`, `scripts/prod-to-yandex/.env.prod-to-yandex`, `scripts/yandex-preflight/.env.yandex-preflight` | local, gitignored |

Команды (для оператора локально):

```bash
rm -rf .old-to-prod-export/ .prod-to-yandex-export/
# .certs — оставить если нужно для dev-подключений к Yandex
# scripts/*/.env.* — удалить или сохранить в vault
```

## Keep temporarily (до Phase 6)

| Что | Где | До какого момента |
|---|---|---|
| `src/lib/supabase/client.ts` | frontend | Phase 6 → app-auth |
| `supabase.auth.*` calls | `src/contexts/AuthContext.tsx`, `src/pages/Auth/Login.tsx`, `src/pages/Auth/Register.tsx` | Phase 6 |
| `@supabase/supabase-js` package | `package.json` | Phase 6 |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env*` + bundle | Phase 6 |
| `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER` | backend env | Phase 6 (grace period для существующих JWT) |
| `auth.users`, `auth.identities` в Yandex | DB | Forever (FK + история) |
| `docs/yandex-migration/22_APP_AUTH_MIGRATION_PLAN.md` | docs | До завершения Phase 6 |

## Remove from active commands

Удалено из `package.json` (после cleanup):

- `old-to-prod:check`, `:introspect-old`, `:introspect-prod`, `:compare`,
  `:export`, `:prepare`, `:import`, `:verify`, `:verify-auth`,
  `:repair-auth`, `:test-temporal`, `:test-raw-types`, `:smoke`,
  `:verify-go`, `:migrate` — **15 scripts**
- `prod-to-yandex:check`, `:schema`, `:verify-schema`, `:export`,
  `:import`, `:verify`, `:verify-passwords`, `:migrate`,
  `:repair-audit-fk`, `:repair-tenders-updated-at` — **10 scripts**
- `yandex:preflight` — **1 script**

**Итого:** 26 npm scripts убрано. Сами `.mjs` файлы перенесены в archive.

## Что оставлено в package.json

```text
dev, build, typecheck, lint, preview,
test, test:go, smoke,
gen:types, gen:schema
```

Это активные команды runtime-проекта (build/lint/test/smoke + утилиты
для генерации типов / схемы из Supabase).

`gen:types` и `gen:schema` пока ссылаются на Supabase project ref
(`ocauafggjrqvopxjihas`) — типы / схема сейчас совпадают с Yandex, но
после Phase 6 (когда Supabase project можно будет потушить) эти команды
нужно либо перевести на Yandex (через `pg_dump` или Bytebase), либо
снести.

## Сводка изменений

- 4 новых docs: `ARCHITECTURE.md`, `RUNTIME_ENV.md`, `NEXT_PHASE_APP_AUTH.md`,
  `cleanup/POST_MIGRATION_CLEANUP_INVENTORY.md` (этот файл)
- 1 README archive: `archive/migrations/2026-05-db-cutover/README.md`
- 88 файлов перенесены в archive (29 yandex-migration docs + 17 old-to-prod docs + 37 scripts + 5 README + envs)
- 26 npm scripts удалены из `package.json`
- 0 изменений в `backend/`, `src/`, `db/`
- 0 изменений в runtime-логике
- 0 секретов в коммите
