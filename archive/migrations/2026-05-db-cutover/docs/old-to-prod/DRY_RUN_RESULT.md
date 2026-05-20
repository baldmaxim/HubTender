# Dry-run Result: OLD → PROD (MCP preflight mode)

Generated: 2026-05-12  (PowerShell shell, Windows 10 Pro)
Command:

```powershell
$env:ALLOW_AUTH_IMPORT="true"
$env:ALLOW_DISABLE_IMPORT_TRIGGERS="true"
npm run old-to-prod:migrate -- --dry-run --use-mcp-preflight
```

Polynomial-time preflight (read-only):

| Check | Result |
|---|---|
| `scripts/old-to-prod/.env.old-to-prod` exists | ✓ |
| `.env.old-to-prod` not tracked by git | ✓ (matches `.gitignore:70 .env.*`; `git ls-files` returns "did not match any file(s)") |
| `.old-to-prod-export/schema_diff.json` exists | ✓ |
| `schema_diff.json.source` | `"mcp"` ✓ |
| `schema_diff.json.blockers.length` | `0` ✓ |
| `docs/old-to-prod/MCP_PREFLIGHT.md` no `MCP_PREFLIGHT_FAILED` | ✓ (status: `MCP_PREFLIGHT_OK_WITH_WARNINGS`) |
| `ALLOW_AUTH_IMPORT=true` (process env) | ✓ |
| `ALLOW_DISABLE_IMPORT_TRIGGERS=true` (process env) | ✓ |

## Финальный статус

**`DRY_RUN_OK_WITH_WARNINGS`**

Pipeline корректно дошёл до тех стадий, которые ВОЗМОЖНО прогнать в dry-run-режиме без артефактов. Остальные стадии не запускались — но не из-за дефектов в коде или схеме, а потому что `04_export_old --dry-run` по дизайну **не пишет** `manifest.json`/`auth_stats.json`/`data/*.ndjson` (см. [04_export_old.mjs:209](../../scripts/old-to-prod/04_export_old.mjs#L209) — `writeJson(...)` обёрнут в `if (!dryRun)`).

Это не блокер. PROD не тронут. Никаких ошибок в схеме, FK, enum'ах, триггерах не обнаружено.

## Какие шаги прошли

### ✅ `check` — `00_check_connections.mjs`
- OLD `wkywhjljrhewfpedbjzx` достижим, PostgreSQL 17.
- PROD `ocauafggjrqvopxjihas` достижим, PostgreSQL 17.
- Обе стороны имеют `public.users`, `auth.users`, `auth.identities`.

### ✅ `export --dry-run` — `04_export_old.mjs`
Сюрвей-режим: фактических записей нет, только пересчёт строк по 42 таблицам. Все `IMPORT_ORDER`-таблицы и обе `auth.*`-таблицы успешно опрошены. Числа совпадают с MCP-preflight'ом (см. `MCP_PREFLIGHT.md` → секция OLD row counts).

Сводно: 39 478 client_positions, 101 495 boq_items, 327 344 boq_items_audit, 29 169 cost_redistribution_results, 33 auth.users (33 with_pw, 0 oauth_only, 0 orphans, 0 dup_emails), 4 auth.identities.

`tender_registry` duplicates baseline: 10 дубликатов по `tender_number`, 0 по `title+client_area`. Это **уже** известно из MCP-preflight'а и обрабатывается через `REQUIRES_TRIGGER_DISABLE.tenders = ['trigger_auto_create_tender_registry']`.

## Какие шаги не прошли (точнее — не дошли)

### ⚠ `prepare --dry-run` — `05_prepare_prod.mjs`
**Halt с exit code 2**:

```text
✗ Missing required file(s) in ./.old-to-prod-export:
    - manifest.json
    - auth_stats.json
  Run: MCP live preflight + npm run old-to-prod:export
```

**Причина**: `04_export_old --dry-run` намеренно не создал эти артефакты (см. выше). Сам `05_prepare_prod` в полном порядке — гард на required-files отработал корректно с дружелюбной ошибкой.

### ⏭ `import / verify / verify-auth / smoke`
Не запускались, потому что pipeline остановился после `prepare`. Это поведение `migrate.mjs` (последовательный child-process orchestrator) — фейл стадии прерывает цепочку. Стадии **не имели возможности упасть на реальной проблеме**.

## Blockers

**Нет.** Pipeline корректно отрабатывает гарды на всех уровнях:
- Orchestrator-level: `assertMcpPreflightOk()` пропустил run (blockers=0, статус не FAILED, env-флаги выставлены).
- Stage-level: `05_prepare_prod` дал понятную ошибку про отсутствующие файлы, не сваливаясь в stack trace.

## Warnings

| # | Warning | Импликация |
|---|---------|------------|
| W1 | `migrate --dry-run` физически не может прогнать `prepare/import/verify/verify-auth/smoke` end-to-end, потому что `export --dry-run` не пишет артефакты. | Чтобы реально *прорепетировать* стадии 05–09 без касания PROD, нужна другая последовательность (см. ниже). |
| W2 | MCP preflight статус — `OK_WITH_WARNINGS` (25 risks), не `OK`. | Не блокирует, но при реальном импорте `assertMcpPreflightOk` выдаст non-fatal ⚠. |
| W3 | OLD имеет 29/33 `auth.users` без `auth.identities` (исторические записи). | OLD-only пользователь `747928c0...` принесёт 1 свою identity. Для остальных 32 PROD-identity актуальнее — нужна policy `SKIP_IF_EXISTS`/`RESUME_DO_NOTHING` на `auth.identities`. Уже учтено в `_mapping.mjs`. |
| W4 | PROD непуст: 27/40 IMPORT_ORDER-таблиц содержат данные (boq_items=70 303 vs OLD 101 495 — 69%). | На import-окне будут id-коллизии. Нужно решить policy: `--clean-prod` (полный re-import) либо `ON CONFLICT DO NOTHING` для существующих + delta-insert новых. |
| W5 | `tender_registry` имеет 10 строк, дублирующихся по `tender_number`, на OLD. | Обрабатывается через `REQUIRES_TRIGGER_DISABLE` (отключение `trigger_auto_create_tender_registry`). `ALLOW_DISABLE_IMPORT_TRIGGERS=true` сейчас выставлен — гард пройдёт. |
| W6 | Node pg deprecation warning: «Calling client.query() when the client is already executing a query is deprecated… pg@9.0». | Косметика. Внутри `04_export_old.mjs`. Не блокирует, но желательно поправить до перехода на pg 9.x. |

## Нужно ли править mapping?

**Нет.** Текущий `scripts/old-to-prod/_mapping.mjs` корректен для увиденной картины:
- `SEED_TABLES` (roles, units, construction_scopes, …) — `ON CONFLICT DO NOTHING` ✓
- `REQUIRES_TRIGGER_DISABLE` ⊇ {`trigger_auto_create_tender_registry`, `trg_boq_items_audit`} ✓ (триггеры найдены на PROD при MCP-preflight'е)
- Auth policy `AUTH_FAIL_BY_DEFAULT` / `AUTH_RESUME_IF_IDENTICAL_ONLY` — корректно блокирует overwrite ✓

Единственное место, требующее **решения** (не правки кода): для существующих 32 пересекающихся `auth.users.id` policy сейчас — `AUTH_FAIL_BY_DEFAULT`. Это значит первый же insert в `auth.users` при реальном импорте упадёт. Варианты:

1. **Запустить с `--resume`** — `AUTH_RESUME_IF_IDENTICAL_ONLY` пропустит byte-identical rows; падёт на расхождениях (например, разный `encrypted_password`).
2. **Запустить с `--clean-prod --confirm` + `ALLOW_CLEAN_PROD=true`** — TRUNCATE затем чистый import (PROD сейчас содержит ранее импортированные данные, не оригинальные).
3. **Использовать `ALLOW_PROD_OVERWRITE=true --allow-overwrite`** на public-таблицах (НЕ применяется к auth.users — там всегда FAIL/RESUME).

Это решение, которое должен принять владелец данных, не код.

## Можно ли переходить к rehearsal / import?

**К полноценному rehearsal — да, по следующей последовательности** (без касания PROD):

```powershell
# 1. Export OLD → local NDJSON (читает только OLD, пишет только локально):
npm run old-to-prod:export -- --use-mcp-preflight
#    Это уже НЕ dry-run — создаст .old-to-prod-export/data/*.ndjson + manifest.json + auth_stats.json.
#    OLD продолжает быть read-only (CLAUDE.md: «Old prod allows only read-only dumps»).

# 2. Затем dry-run остальной пайплайн (никаких PROD-записей):
$env:ALLOW_AUTH_IMPORT="true"
$env:ALLOW_DISABLE_IMPORT_TRIGGERS="true"
npm run old-to-prod:migrate -- --dry-run --use-mcp-preflight --import-only
# либо отдельно:
npm run old-to-prod:prepare -- --use-mcp-preflight
npm run old-to-prod:import  -- --dry-run --use-mcp-preflight
npm run old-to-prod:verify  -- --dry-run
npm run old-to-prod:verify-auth -- --dry-run
```

**К реальному import — пока НЕТ.** Нужно сначала:
1. Получить undisputed решение по conflict policy для 32 пересекающихся `auth.users.id` (resume / clean-prod / overwrite).
2. Прогнать rehearsal из пункта выше end-to-end — увидеть `IMPORT_REPORT.md` (dry-run) и `PREPARE_REPORT.md` со статусом `READY`.
3. Зафиксировать окно cutover, гарантировать, что OLD во время окна не пишется (CLAUDE.md: live users → freeze).
4. Только потом снять `--dry-run`.

## Что НЕ было записано

- В PROD: ничего. Проверено отсутствием успешных `06_import_prod` вызовов в логе.
- В OLD: ничего (по дизайну — все скрипты read-only к OLD).
- Локально: только лог `.old-to-prod-export/_mcp_cache/dry_run.log`. Никаких NDJSON, manifest.json, auth_stats.json.

## Лог

Полный лог сохранён: `.old-to-prod-export/_mcp_cache/dry_run.log` (78 строк, не закоммичен — лежит в gitignore'нутом пути под `_mcp_cache/`).
