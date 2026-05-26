# Archive — DB cutover 2026-05

Снимок миграционного контура HubTender. Перенесён в `archive/` после
завершения переключения на Yandex Managed PostgreSQL — чтобы основной
репозиторий выглядел как обычный runtime-проект, а не как миграционный
стенд. Все материалы сохранены **as-is**: можно воспроизвести шаги,
посмотреть отчёты, при необходимости восстановить и запустить скрипты.

## Когда выполнена миграция

- **2026-05-17 — 2026-05-18:** первичный prod cutover (OLD Supabase → PROD
  Supabase → Yandex Managed PostgreSQL → Go BFF runtime на Yandex)
- **2026-05-18:** `RUNTIME_CUTOVER_OK` — Go BFF переключён на Yandex
  `DATABASE_URL`
- **2026-05-20:** свежий end-to-end data refresh OLD → PROD → Yandex
  поверх существующего runtime
- **2026-05-21:** `FRONTEND_DEPLOY_OK` — фронт через Go BFF → Yandex;
  Phase 5 (frontend Supabase business migration) завершена
- **2026-05-25:** ещё один data refresh — кластер Yandex переехал на
  `c-c9qmbgvs6rit4qfe0dni.rw.mdb.yandexcloud.net`. Тулчейн временно
  восстановлен из архива, прогнан, заархивирован обратно. Отчёт:
  `docs/yandex-migration/28_DATA_REFRESH_2026_05_25.md` (в active docs)

## Source chain

```
OLD Supabase (wkywhjljrhewfpedbjzx, archive-only)
        │
        ▼   scripts/old-to-prod/
PROD Supabase (ocauafggjrqvopxjihas, archive source + Auth bridge)
        │
        ▼   scripts/prod-to-yandex/
Yandex Managed PostgreSQL  ←  Active runtime БД
   (rc1d-m4ubd0uem0j9gqqc.mdb.yandexcloud.net:6432/HubTender)
        ▲
        │
   Go BFF (production container `hubtender-bff`, systemd)
        ▲
        │
   React frontend (https://tender.su10.ru/api/v1/*)
        ▲
        │
   Supabase Auth (JWKS/JWT bridge — оставлен временно)
```

## Финальные статусы (зелёные)

| Token | Where |
|---|---|
| `VERIFY_OK` (OLD → PROD) | `docs/old-to-prod/VERIFY_RESULT.md` |
| `AUTH_VERIFY_OK` (OLD → PROD) | `docs/old-to-prod/AUTH_VERIFY_RESULT.md` |
| `DATA_IMPORT_OK` (PROD → Yandex) | `docs/yandex-migration/12_DATA_IMPORT_REPORT.md` |
| `YANDEX_VERIFY_OK` | `docs/yandex-migration/13_YANDEX_VERIFY_RESULT.md` |
| `YANDEX_AUTH_VERIFY_OK` | `docs/yandex-migration/14_YANDEX_AUTH_VERIFY_RESULT.md` |
| `SCHEMA_VERIFY_OK` | `docs/yandex-migration/09_SCHEMA_VERIFY_RESULT.md` |
| `GO_BFF_YANDEX_VERIFY_OK` | `docs/yandex-migration/18_GO_BFF_YANDEX_VERIFICATION.md` |
| `RUNTIME_CUTOVER_OK` | `docs/yandex-migration/23_RUNTIME_CUTOVER_RESULT.md` |
| `FRONTEND_SUPABASE_WRITE_PATHS_MIGRATED` | `docs/yandex-migration/26_FRONTEND_SUPABASE_WRITE_PATHS.md` |
| `FRONTEND_DEPLOY_OK` | `docs/yandex-migration/24_FRONTEND_DEPLOY_RESULT.md` |
| `FINAL_DATA_REFRESH_OK` | `docs/yandex-migration/27_FINAL_DATA_REFRESH_RESULT.md` |

## Что куда легло

```
archive/migrations/2026-05-db-cutover/
├── README.md                                    ← этот файл
├── docs/
│   ├── old-to-prod/                             ← 17 отчётов про OLD → PROD
│   └── yandex-migration/                        ← 30 docs (планы + результаты + cutover + Phase 5 + refresh)
└── scripts/
    ├── old-to-prod/                             ← export/prepare/import/verify, MCP preflight
    ├── prod-to-yandex/                          ← schema/export/import/verify против Yandex
    └── yandex-preflight/                        ← target-кластер readiness checks
```

## Что НЕ перенесено

- `docs/yandex-migration/22_APP_AUTH_MIGRATION_PLAN.md` — **остался** в
  активной части `docs/yandex-migration/` (или см.
  `docs/NEXT_PHASE_APP_AUTH.md` для краткой версии), потому что app-auth
  миграция — следующая phase, ещё не выполнена.
- `db/yandex/sql/` — **остался** в `db/yandex/sql/` как актуальный
  schema baseline Yandex.
- Реальные env-файлы (`scripts/*/.env.*`) — не коммитятся (gitignored)
  и не архивируются.
- Export dirs (`.old-to-prod-export/`, `.prod-to-yandex-export/`) —
  локальные временные артефакты, не для архива.

## Эти скрипты больше НЕ являются runtime-командами

Из `package.json` убраны вызовы:

- `old-to-prod:*` (16 npm scripts)
- `prod-to-yandex:*` (10 npm scripts)
- `yandex:preflight` (1 npm script)

Импорт-тулчейн полностью переведён в архив. Запускать их повторно для
обычного runtime **не нужно** — Yandex уже active DB.

## Как восстановить миграционный тулчейн (если понадобится)

Только при необходимости (rollback или recovery; обычная эксплуатация
проекта в этих скриптах не нуждается):

1. Скопировать обратно скрипты в `scripts/`:
   ```bash
   cp -r archive/migrations/2026-05-db-cutover/scripts/old-to-prod scripts/
   cp -r archive/migrations/2026-05-db-cutover/scripts/prod-to-yandex scripts/
   cp -r archive/migrations/2026-05-db-cutover/scripts/yandex-preflight scripts/
   ```
2. Заполнить env-файлы из `*.example`:
   ```bash
   cp scripts/old-to-prod/.env.old-to-prod.example scripts/old-to-prod/.env.old-to-prod
   cp scripts/prod-to-yandex/.env.prod-to-yandex.example scripts/prod-to-yandex/.env.prod-to-yandex
   cp scripts/yandex-preflight/.env.yandex-preflight.example scripts/yandex-preflight/.env.yandex-preflight
   ```
3. Вернуть скрипты в `package.json` (взять из git history того же файла —
   commit до cleanup'а).
4. См. `docs/yandex-migration/05_CUTOVER_RULES.md` и
   `docs/yandex-migration/10_DATA_MIGRATION_RUNBOOK.md` для процедур.

## Rollback DSN reference

Если нужно экстренно откатиться с Yandex на PROD Supabase:

1. Восстановить значение `DATABASE_URL` Go BFF контейнера на PROD Supabase
   DSN (хранится в защищённом vault оператора — **не в git**).
2. Перезапустить `hubtender-bff` (`systemctl restart hubtender-bff`).
3. Phase 5 frontend совместим с PROD Supabase БД по схеме (одна и та же
   `supabase/schemas/prod.sql` — см. `06_YANDEX_PREFLIGHT.md` про
   `auth_compat`).

> Yandex данные на момент cutover'а синхронизированы с PROD Supabase
> (`YANDEX_VERIFY_OK`). После cutover'а active writes идут только в
> Yandex; PROD Supabase БД зафиксирована на состоянии 2026-05-20 (см.
> `27_FINAL_DATA_REFRESH_RESULT.md`).

## Дальнейшие шаги (не в этом архиве)

- **App-auth migration** (Phase 6) — переход с Supabase Auth bridge на
  app-issued JWT в Go BFF. План: `docs/NEXT_PHASE_APP_AUTH.md` (краткий)
  или полная версия в `docs/yandex-migration/22_APP_AUTH_MIGRATION_PLAN.md`
  (если он сохранён в активной части).
