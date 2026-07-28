# HUBTender RC1 — Deployment Manifest

Commit `662f50b`. Deployment-модель: prod-сервер, backend — Docker-образ `hubtender-api:prod` под systemd `hubtender-bff.service` (127.0.0.1:3006, nginx-ingress), frontend — статический `dist/` через rsync (см. `DEPLOY.md`). `scripts/deploy-production.sh` синкает **origin/main** → перед деплоем RC1 обязан быть влит в main (integration plan — в PR).

Этот этап (3.1) деплой НЕ выполняет. Ниже — точный порядок для этапа 3.2.

## Фаза 0 — Backup / preflight

1. `pg_dump` (schema + data) production БД **до** миграций; зафиксировать размер/время. *(manual gate: реальный backup выполняет владелец)*
2. `bash scripts/deploy-production.sh --check` — hostname, env-файлы, docker/systemd/node/rsync.
3. Снять текущие версии: `git -C /opt/hubtender-build rev-parse HEAD`, образ `hubtender-api:prod` (`docker images --digests`), копия текущего `public/` создаётся деплоем автоматически (`public.backup-<TS>`).
4. Preflight-сверка pre-range миграций (см. MIGRATIONS manifest, раздел pre-range): особенно `2026_07_markup_multiplyformat_backfill` и `2026_07_client_positions_rich_runs` — колонки/данные уже в prod.

## Фаза 1 — Readiness audit (до любых изменений)

```
READINESS_DATABASE_URL=<prod DSN> go run -C backend ./cmd/production-readiness-audit --json-out preflight-report.json
```
Read-only. Блокеры (orphan-FK-данные, застрявшие `calculating`, approved при неактуальном расчёте) — разобрать ДО миграций.

## Фаза 2 — Markup impact review *(manual gate)*

Из readiness-отчёта: список markup-тактик/тендеров, чьи суммы изменит `addOne`-дефолт multiplyFormat. Владелец подтверждает список. Без подтверждения — стоп.

## Фаза 3 — ACL verification *(manual gate)*

Из readiness-отчёта: `acl:*` — роли с доступом к admin AI страницам/эндпоинтам. Подтвердить, что `AIAdminRoles` соответствует реальным учёткам администраторов.

## Фаза 4 — Existing tender consistency

Контрольные SELECT из заголовка `2026_07_boq_relation_integrity.sql` (orphan cross-tender/cross-position связи). Ненулевой результат → remediation по сценарию upgrade rehearsal (согласованные UPDATE, повторный SELECT → 0) до применения FK-миграции.

## Фаза 5 — Применение миграций (порядок обязателен)

Применять 10 ★-миграций **лексикографически** (как rehearsal): `ai_feature_settings` → `ai_rollout_controlled` → `boq_quote_source_dates` → `boq_relation_integrity` → `client_positions_section_fields` (no-op на prod) → `financial_calculation_revision` → `retire_bulk_update_commercial_costs` → `retire_save_redistribution_results` → `retire_sql_grand_total_recalc` → `smart_import_memory`. Guard порядка: `node scripts/checks/migrationOrder.check.mjs`.

**Rolling-окно совместимости (старый backend + новая схема):**

| Группа | До применения | После применения | Старый backend в окне | Fail-closed эффект |
|---|---|---|---|---|
| additive (revision, source dates, smart memory, AI-таблицы) | старый код работает | старый код игнорирует новые объекты | совместим | — |
| FK NOT VALID→VALIDATE | старый код работает | новые нарушения отклоняются БД | совместим (валидные записи проходят) | невалидная запись → ошибка БД (желаемое) |
| retire-tombstones (3 шт.) | старый код ещё может звать RPC/триггеры | вызов → RAISE EXCEPTION | **НЕ совместим по этим путям** | старый backend, зовущий retired RPC, получает явную ошибку, не тихую порчу |

⇒ Практический порядок: additive+FK группы можно применять до рестарта backend; **retire-группу применять непосредственно перед/сразу после переключения backend** (минимизировать окно). Весь деплой делать в окно без активных пересчётов.

## Фаза 6 — Backend deployment

`bash scripts/deploy-production.sh backend` (сборка `hubtender-api:prod` из main@RC1, рестарт `hubtender-bff.service`, docker prune). Проверки: `/health`, `/health/db`, `/health/recalc`, `/health/ai`.

## Фаза 7 — Frontend deployment

`bash scripts/deploy-production.sh frontend` (сборка dist из `.env.production.yandex`, rsync с автобэкапом `public.backup-<TS>`).

## Фаза 8 — Recovery health

`GET /health/recalc` — скан работает, застрявших `calculating` нет (или reclaim их разобрал).

## Фаза 9 — AI settings *(manual gate)*

`GET /api/v1/admin/ai/nomenclature/rollout` → `mode: "off"`, пилотный список пуст, circuit closed. `OPENROUTER_API_KEY` в prod env **не задавать** до решения владельца о пилоте.

## Фаза 10 — Smoke

Login → тендер → BOQ-мутация → пересчёт (revision растёт) → аналитика (quality/benchmark/action plan) → review-pack XLSX скачивается → smart import analyze на тестовом файле (без execute в prod-данные либо на тестовом тендере) → admin AI страница открывается, rollout `off`.

## Фаза 11 — Post-deploy метрики

Sentry (frontend+backend) 30–60 мин; логи `hubtender-bff.service`; `/health/recalc` повторно; помнить про Sentry 499 blind spot — отсутствие ошибок ≠ здоровье, смотреть логи nginx.

## Фаза 12 — Emergency rollback

См. `HUBTENDER_RC1_ROLLBACK.md`. Кратко: frontend — вернуть `public.backup-<TS>`; backend — предыдущий образ/ревизия; миграции НЕ откатывать (roll-forward policy); AI — `emergency-off` (при `off` уже неактивен).
