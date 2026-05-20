# MCP Live Preflight: OLD → PROD

Generated: `2026-05-12T03:49:36.741Z`  
Source: live SELECT via Supabase MCP (read-only).

- OLD: `wkywhjljrhewfpedbjzx` — PostgreSQL 17.6 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit
- PROD: `ocauafggjrqvopxjihas` — PostgreSQL 17.6 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit

## Резюме

- Версии PostgreSQL совпадают.
- Public/auth схемы есть на обеих сторонах. `public.users`, `auth.users`, `auth.identities` присутствуют.
- IMPORT_ORDER таблиц: 40. PROD-only таблиц (auth scaffolding): 3.
- OLD auth.users: 33; PROD auth.users: 32.
- ID overlap (same id on OLD и PROD): 32; same_id_diff_email: 0; same_email_diff_id: 0.
- Blockers: 0; Risks: 25; Info: 63.
- **Финальный статус: MCP_PREFLIGHT_OK_WITH_WARNINGS**

## OLD row counts

| Table | Rows |
|-------|-----:|
| `roles` | 9 |
| `units` | 28 |
| `construction_scopes` | 5 |
| `tender_statuses` | 4 |
| `markup_parameters` | 15 |
| `library_folders` | 7 |
| `notifications` | 0 |
| `users` | 33 |
| `cost_categories` | 24 |
| `material_names` | 6552 |
| `work_names` | 2338 |
| `detail_cost_categories` | 218 |
| `markup_tactics` | 3 |
| `materials_library` | 1819 |
| `works_library` | 855 |
| `tender_registry` | 64 |
| `tenders` | 45 |
| `client_positions` | 39478 |
| `import_sessions` | 217 |
| `templates` | 238 |
| `construction_cost_volumes` | 3292 |
| `tender_insurance` | 13 |
| `tender_markup_percentage` | 537 |
| `tender_notes` | 6 |
| `tender_pricing_distribution` | 28 |
| `tender_documents` | 0 |
| `subcontract_growth_exclusions` | 1429 |
| `user_tasks` | 162 |
| `boq_items` | 101495 |
| `boq_items_audit` | 327344 |
| `template_items` | 1104 |
| `user_position_filters` | 7647 |
| `comparison_notes` | 1961 |
| `cost_redistribution_results` | 29169 |
| `projects` | 12 |
| `project_additional_agreements` | 76 |
| `project_monthly_completion` | 386 |
| `tender_groups` | 44 |
| `tender_group_members` | 150 |
| `tender_iterations` | 0 |

## PROD row counts

| Table | Rows | Δ (OLD − PROD) |
|-------|-----:|---------------:|
| `roles` | 9 | 0 |
| `units` | 27 | 1 |
| `construction_scopes` | 5 | 0 |
| `tender_statuses` | 4 | 0 |
| `markup_parameters` | 15 | 0 |
| `library_folders` | 4 | 3 |
| `notifications` | 0 | 0 |
| `users` | 32 | 1 |
| `cost_categories` | 24 | 0 |
| `material_names` | 5943 | 609 |
| `work_names` | 2189 | 149 |
| `detail_cost_categories` | 218 | 0 |
| `markup_tactics` | 3 | 0 |
| `materials_library` | 1773 | 46 |
| `works_library` | 847 | 8 |
| `tender_registry` | 55 | 9 |
| `tenders` | 38 | 7 |
| `client_positions` | 31894 | 7584 |
| `import_sessions` | 132 | 85 |
| `templates` | 266 | -28 |
| `construction_cost_volumes` | 2344 | 948 |
| `tender_insurance` | 8 | 5 |
| `tender_markup_percentage` | 477 | 60 |
| `tender_notes` | 6 | 0 |
| `tender_pricing_distribution` | 24 | 4 |
| `tender_documents` | 0 | 0 |
| `subcontract_growth_exclusions` | 1031 | 398 |
| `user_tasks` | 150 | 12 |
| `boq_items` | 70303 | 31192 |
| `boq_items_audit` | 220262 | 107082 |
| `template_items` | 1169 | -65 |
| `user_position_filters` | 6077 | 1570 |
| `comparison_notes` | 1353 | 608 |
| `cost_redistribution_results` | 23674 | 5495 |
| `projects` | 12 | 0 |
| `project_additional_agreements` | 76 | 0 |
| `project_monthly_completion` | 386 | 0 |
| `tender_groups` | 24 | 20 |
| `tender_group_members` | 78 | 72 |
| `tender_iterations` | 0 | 0 |

## Schema blockers

_none_

## Auth blockers

_none_

### Auth-related risks (non-blocking)

- ⚠️ **OLD_MISSING_IDENTITY** — OLD has 29 of 33 auth.users without auth.identities (legacy: rows pre-date identities)
- ⚠️ **AUTH_ID_OVERLAP** — 32 auth.users ids exist on BOTH OLD and PROD — import will require conflict resolution

## Dangerous triggers

Required-disable triggers (per `scripts/old-to-prod/_tables.mjs`):

| Trigger | On PROD? |
|---------|----------|
| `trigger_auto_create_tender_registry` (`tenders`) | ✅ found |
| `trg_boq_items_audit` (`boq_items`) | ✅ found |

Plan: import-скрипт `06_import_prod.mjs` отключает эти триггеры на время загрузки при `ALLOW_DISABLE_IMPORT_TRIGGERS=true`.

## Collisions (auth.users / auth.identities)

| Метрика | Значение |
|---------|---------:|
| same id (OLD ∩ PROD) | 32 |
| same email_hash (OLD ∩ PROD) | 32 |
| same id, разный email | 0 |
| same email, разный id | 0 |
| OLD-only users | 1 |
| PROD-only users | 0 |
| identity overlap consistent | 3 |
| identity overlap MISMATCH | 0 |

## Рекомендации

Для import-окна нужны следующие env-флаги:

```
ALLOW_AUTH_IMPORT=true               # OLD имеет 33 auth.users, нужно перенести 1 OLD-only + identities
ALLOW_DISABLE_IMPORT_TRIGGERS=true   # PROD имеет 2 required-disable triggers (trigger_auto_create_tender_registry, trg_boq_items_audit)
ALLOW_PROD_OVERWRITE=<решение>       # PROD уже содержит 32 пересекающихся auth.users.id; решить: skip vs overwrite
```

Дополнительно:
- На OLD 29 auth.users без auth.identities (исторические записи). PROD уже регенерировал identities для перенесённых ранее 29 пользователей. При повторном импорте OLD-only-пользователя `747928c0...` его identity (1 шт.) должна попасть в PROD; для остальных PROD-identity актуальнее, чем OLD-identity — настройте policy на `SKIP_IF_EXISTS`.
- **PROD НЕ пуст**: 37 из 40 IMPORT_ORDER-таблиц содержат данные (boq_items=70303, tenders=38, и т.д.). Это значит был частичный импорт. Перед повторным импортом решите: (a) `--clean-prod` + полный re-import, либо (b) `ON CONFLICT DO NOTHING` для существующих + insert OLD-deltas.
- 13 RLS-политик с OLD отсутствуют на PROD. Не критично для данных, но может сломать legacy supabase-клиента. После cutover PROD идёт под Go BFF service-role, так что RLS-расхождение допустимо.
- 26 функций имеют разные тела на OLD vs PROD (md5 mismatch). Это ожидаемо — на PROD уже применены phase-1 миграции. Импорт данных не вызывает функции, так что не блокирует.

## Финальный статус

**MCP_PREFLIGHT_OK_WITH_WARNINGS**

Reason: schema совместима для импорта, но есть 25 нетривиальных риск(ов) — операционно учесть, но не блокируют.

## Next step

Можно запускать:

```bash
node scripts/old-to-prod/migrate.mjs --dry-run
```

Для live import выставить env-флаги выше, затем без `--dry-run`.
