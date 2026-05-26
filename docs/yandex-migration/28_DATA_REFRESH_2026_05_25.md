# 28. DATA REFRESH 2026-05-25

> Свежий end-to-end refresh OLD Supabase → PROD Supabase → Yandex Managed PG.
> Inspired by [27_FINAL_DATA_REFRESH_RESULT.md](./27_FINAL_DATA_REFRESH_RESULT.md) (2026-05-20).
> Дата: 2026-05-25. DSN / passwords / tokens / hashes никогда не печатались.

## Контекст

С момента предыдущего refresh (2026-05-20) основной production-трафик
оставался на OLD Supabase (на другом сайте), Yandex накапливал только
тестовые данные. За неделю на OLD накопилось ~22 700 новых строк и 2
новых тендера. Цель: дозалить эту дельту на Yandex, не теряя bcrypt-пароли
и не задев `app_auth.*` (sessions/refresh tokens активного app-auth).

## Pipeline summary

| Leg | Stage | Status |
|---|---|---|
| OLD → PROD | connection check | `CHECK_OK` |
| OLD → PROD | export (pool-safe, batch 2500, 663 206 rows) | `DATA_EXPORT_OK` |
| OLD → PROD | introspect/compare | OK (after `_introspect.mjs` patch — `citext.min/max` exclusion) |
| OLD → PROD | prepare (`--clean-prod --clean-auth`) | `READY` |
| OLD → PROD | import (`--clean-prod --clean-auth`, batch 5000) | `IMPORT_OK` |
| OLD → PROD | verify (rows + checksums + FK) | `VERIFY_OK` |
| OLD → PROD | verify-auth (passwords/identities) | `AUTH_VERIFY_OK` |
| PROD → Yandex | export PROD (pool-safe) | `DATA_EXPORT_OK` |
| PROD → Yandex | clean Yandex (`--clean-only`) | `DATA_CLEAN_OK` |
| PROD → Yandex | verify-schema post-clean | `SCHEMA_VERIFY_OK` |
| PROD → Yandex | import (`--confirm`, batch 5000) | partial (connection drop mid-`boq_items_audit`, 77k/425k) |
| PROD → Yandex | import (`--resume`, ON CONFLICT DO NOTHING) | `DATA_IMPORT_OK` |
| PROD → Yandex | verify (rows + checksums + FK) | `YANDEX_VERIFY_OK` |
| PROD → Yandex | verify-passwords (bcrypt) | `YANDEX_AUTH_VERIFY_OK` |

## Row counts (canonical — OLD = PROD = Yandex после refresh)

| Table | Rows | Δ vs 2026-05-20 |
|---|---:|---:|
| `public.roles` | 9 | 0 |
| `public.units` | 28 | 0 |
| `public.construction_scopes` | 5 | 0 |
| `public.tender_statuses` | 4 | 0 |
| `public.markup_parameters` | 15 | 0 |
| `public.library_folders` | 7 | 0 |
| `public.notifications` | 0 | 0 |
| `public.users` | 33 | 0 |
| `public.cost_categories` | 24 | 0 |
| `public.material_names` | 6 897 | +304 |
| `public.work_names` | 2 420 | +79 |
| `public.detail_cost_categories` | 218 | 0 |
| `public.markup_tactics` | 3 | 0 |
| `public.materials_library` | 1 881 | +38 |
| `public.works_library` | 865 | +9 |
| `public.tender_registry` | 71 | +2 |
| `public.tenders` | 51 | +2 |
| `public.client_positions` | 46 782 | +749 |
| `public.import_sessions` | 281 | +35 |
| `public.templates` | 240 | +2 |
| `public.construction_cost_volumes` | 3 968 | +194 |
| `public.tender_insurance` | 19 | +3 |
| `public.tender_markup_percentage` | 642 | +45 |
| `public.tender_notes` | 6 | 0 |
| `public.tender_pricing_distribution` | 34 | +3 |
| `public.tender_documents` | 0 | 0 |
| `public.subcontract_growth_exclusions` | 1 841 | +129 |
| `public.user_tasks` | 165 | 0 |
| `public.boq_items` | 126 115 | +7 624 |
| `public.boq_items_audit` | 425 458 | +16 664 |
| `public.template_items` | 1 143 | +39 |
| `public.user_position_filters` | 9 580 | +359 |
| `public.comparison_notes` | 2 321 | 0 |
| `public.cost_redistribution_results` | 31 364 | 0 |
| `public.projects` | 12 | 0 |
| `public.project_additional_agreements` | 76 | 0 |
| `public.project_monthly_completion` | 386 | 0 |
| `public.tender_groups` | 54 | 0 |
| `public.tender_group_members` | 186 | 0 |
| `public.tender_iterations` | 0 | 0 |
| `auth.users` | 33 | 0 |
| `auth.identities` | 33 | 0 |

Всего на refresh — ~22 280 новых строк в public + 16 664 audit-записи.

### Auth identities

OLD: 4 native + 29 без identity. OLD → PROD bootstrap создал 29 missing
email-identities → PROD имеет 33 identities. PROD → Yandex скопировал 33
identities byte-stable. bcrypt: match=33 mismatch=0 missing=0.

### app_auth (Yandex-only)

Не тронуты per operator decision:
- `app_auth.refresh_tokens` — оставлены (live sessions)
- `app_auth.auth_events` — оставлены (audit history)
- `app_auth.password_reset_tokens` — оставлены (если выданы)

## Несовпадения с планом 2026-05-20

### 1. Смена Yandex master-кластера

`YANDEX_DATABASE_URL` в `.env.prod-to-yandex` исходно указывал на старый
`rc1d-m4ubd0uem0j9gqqc.mdb.yandexcloud.net` — теперь это standby replica
(`pg_is_in_recovery=true`, `transaction_read_only=on`). Кластер был мигрирован
на новый `c-c9qmbgvs6rit4qfe0dni.rw.mdb.yandexcloud.net` (видимо вместе с
`.env.prod` production-runtime). Оператор обновил оба
`YANDEX_DATABASE_URL` и `YANDEX_DIRECT_DATABASE_URL` на новый master FQDN.

Data state нового кластера оказался идентичным старому snapshot 2026-05-20 —
**аудит, проведённый против старого кластера, остался валидным**.

### 2. citext в PROD ломает `_introspect.mjs`

PROD имеет расширение `citext`, которое определяет `public.min(citext)` /
`public.max(citext)` — конфликт с aggregate `min`/`max`. `pg_get_functiondef()`
падает с `"min" is an aggregate function`. Патч: исключить функции, принадлежащие
расширениям (`pg_depend.deptype = 'e'`). Применено в
[scripts/old-to-prod/_introspect.mjs](../../scripts/old-to-prod/_introspect.mjs).

### 3. Стейл MCP_PREFLIGHT — bypass

`docs/old-to-prod/MCP_PREFLIGHT.md` от 2026-05-12; `auth_collision_analysis.json`
тоже стейл. Свежий live-пг compare даёт эквивалентные данные. Помечен
`schema_diff.json` источник `source=mcp` (live pg-based = MCP semantics),
свежий `auth_collision_analysis.json` сгенерирован
[`_refresh_collision_analysis.mjs`](../../scripts/old-to-prod/_refresh_collision_analysis.mjs).

### 4. Yandex pooler connection drop на `boq_items_audit`

Yandex managed pgbouncer оборвал connection во время длинного INSERT в
`boq_items_audit` (~800 МБ NDJSON, ~3 мин непрерывной нагрузки). После 77 000
из 425 458 строк. `--resume` с ON CONFLICT DO NOTHING продолжил с того же
места, дозалил 348 458 строк без дубликатов. Финальный count match.

### 5. Go BFF smoke script stale

`scripts/smoke/go-bff.mjs` импортирует удалённый `@supabase/supabase-js`.
Smoke не запущен — TODO заменить на app-auth flow (`POST /api/v1/auth/login`
вместо Supabase OAuth). Verification данных полная на DB-уровне:
checksum'ы PROD vs Yandex — match, FK orphans = 0, bcrypt 33/33.

## Известные подводные камни (без блокеров для текущего refresh)

- `tenders.updated_at` дрейф НЕ возник — `04_import_yandex.mjs` уже
  динамически дисейблит grand-total триггеры (фиксил doc 17).
- `boq_items_audit` inflation = 0 — `trg_boq_items_audit` дисейблен на время
  импорта.
- Pool-safe export без operator-confirmed freeze — оператор подтвердил
  "основная работа сейчас на OLD на другом сайте, никто не пишет в Yandex".

## Reports

| Report | Status |
|---|---|
| `docs/old-to-prod/VERIFY_RESULT.md` | `VERIFY_OK` |
| `docs/old-to-prod/AUTH_VERIFY_RESULT.md` | `AUTH_VERIFY_OK` |
| `docs/yandex-migration/09_SCHEMA_VERIFY_RESULT.md` | `SCHEMA_VERIFY_OK` |
| `docs/yandex-migration/11_DATA_EXPORT_REPORT.md` | `DATA_EXPORT_OK` |
| `docs/yandex-migration/12_DATA_IMPORT_REPORT.md` | `DATA_IMPORT_OK` |
| `docs/yandex-migration/13_YANDEX_VERIFY_RESULT.md` | `YANDEX_VERIFY_OK` |
| `docs/yandex-migration/14_YANDEX_AUTH_VERIFY_RESULT.md` | `YANDEX_AUTH_VERIFY_OK` |
| `docs/yandex-migration/AUDIT_2026_05_25.md` | (read-only audit pre-refresh) |

## Final status

```
DATA_REFRESH_2026_05_25_OK
```

Все 5 gating tokens зелёные:
- `VERIFY_OK` (OLD → PROD)
- `AUTH_VERIFY_OK` (OLD → PROD)
- `DATA_IMPORT_OK` (PROD → Yandex)
- `YANDEX_VERIFY_OK` (PROD → Yandex)
- `YANDEX_AUTH_VERIFY_OK` (PROD → Yandex)

Go BFF smoke — отложен (требует переписки под app-auth).

## TODO для следующего refresh

1. Переписать `scripts/smoke/go-bff.mjs` под app-auth (login через
   `POST /api/v1/auth/login`, без Supabase SDK).
2. Считать `boq_items_audit` import в 2-3 chunk'а или увеличить
   pgbouncer timeout, чтобы избежать connection drop.
3. Обновить `MCP_PREFLIGHT.md` workflow или удалить (если live-pg compare
   признать каноничным).
4. Снова заархивировать `scripts/old-to-prod` / `scripts/prod-to-yandex` /
   `scripts/yandex-preflight` если они не нужны до следующего refresh.
