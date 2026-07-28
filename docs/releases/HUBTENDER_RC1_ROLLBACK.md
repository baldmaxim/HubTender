# HUBTender RC1 — Rollback Manifest

Commit `662f50b`. Базовый принцип: **схема этого релиза обратно-совместима для чтения**; финансовые retire-миграции сознательно необратимы (unsafe SQL-writers не возвращаются). Основная стратегия — roll-forward; application rollback допустим в узких случаях ниже.

## A. Application rollback (backend)

- Механика: пересобрать `hubtender-api:prod` из предыдущей ревизии main (`HUBTENDER_BRANCH`/checkout) либо перетегировать сохранённый предыдущий образ; `systemctl restart hubtender-bff`.
- **Безопасен**, пока retire-миграции (3 tombstone) НЕ применены.
- **После применения retire-миграций старый backend НЕ безопасен**: пути bulk-commercial/redistribution-RPC/SQL-grand-total у старого кода упрутся в RAISE-tombstone → операции упадут явно (fail-closed, порчи нет, но функциональность деградирует). В этом случае — roll-forward (fix поверх RC1), не rollback.

## B. Frontend rollback

- `public.backup-<TS>` создаётся деплоем автоматически: `rm -rf public && cp -a public.backup-<TS> public` (или rsync обратно). Совместим с любым состоянием схемы: старый UI не знает о новых endpoints и просто их не зовёт.

## C. AI emergency off

- Мгновенно, без деплоя: `POST /api/v1/admin/ai/nomenclature/rollout/emergency-off` (или UI-кнопка). Эффект: rollout `off`, suggest → детерминированный путь, in-flight не продлеваются.
- Дополнительная ступень: убрать `OPENROUTER_API_KEY` из env + рестарт — live-вызовы физически невозможны.

## D. Migration rollback policy

| Группа | Откат | Политика |
|---|---|---|
| additive (revision-колонки, quote-dates, smart-memory, AI-таблицы) | технически DROP-абелен | **не откатывать** — колонки/таблицы безвредны для старого кода; DROP теряет данные (память импорта, AI-телеметрию) |
| FK `boq_relation_integrity` | `ALTER TABLE ... DROP CONSTRAINT` | допустим как временная мера при ложных блокировках legacy-данных; после remediation вернуть FK |
| retire-tombstones ×3 | восстановление исходных функций | **ЗАПРЕЩЕНО** (§E) |

Unsafe down-миграции в репозиторий не добавляются.

## E. Retired SQL writers — не возвращать

`bulk_update_boq_items_commercial_costs`, `save_redistribution_results`, SQL grand-total функции/триггеры — выведены как источники тихой финансовой порчи (клиентские суммы, конкурирующая формула). Возврат = реинтродукция P0-класса багов. При любом инциденте — чинить Go-путь (roll-forward).

## F. Data compatibility

- Данные, созданные RC1 (ревизии, quote-dates, память импорта, AI-леджер), старым кодом читаются/игнорируются без ошибок — колонки nullable/дефолтные, таблицы отдельные.
- Данные, созданные до RC1, новым кодом обрабатываются: миграции содержат idempotent-инициализацию ревизий; upgrade rehearsal репетирует именно legacy-данные.

## G. Переходные состояния при rollback/инциденте

| Состояние | Что делать |
|---|---|
| `stale` (расчёт не соответствует входам) | штатно: recovery-скан поставит пересчёт; вручную — любая финансовая команда триггерит recalc |
| `calculating` завис (crash) | `RECALC_RECOVERY_CALCULATING_TIMEOUT` → advisory-reclaim автоматически; диагностика `GET /health/recalc` |
| `failed` | смотреть error-контекст ревизии; после фикса — повторная команда пересчёта; approve невозможен на неактуальном расчёте (инвариант) |
| in-flight AI budget reservations | истекают по `reservation_timeout_seconds` (default 120s) и высвобождаются maintenance-сканом; ничего не делать |

## H. Когда rollback безопасен, когда roll-forward

| Ситуация | Решение |
|---|---|
| Проблема в UI/фронте | frontend rollback (B) — всегда безопасен |
| Проблема в backend, retire-миграции НЕ применены | application rollback (A) |
| Проблема в backend, retire-миграции применены | **roll-forward** (hotfix поверх RC1); rollback даст fail-closed отказ финансовых операций |
| Проблема в AI-подборе | emergency off (C); rollback не требуется |
| Порча/несоответствие данных | стоп, диагностика readiness-audit'ом; восстановление из Фазы-0 backup — крайняя мера с даунтаймом и потерей новых данных (решение владельца) |
