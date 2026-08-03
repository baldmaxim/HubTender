# HUBTender — Production Clone Rehearsal (этап 3.2, 2026-08-03)

Репетиция релиза `9781291` (app = RC2 `0bffa67`) на **настоящем production-бэкапе**, восстановленном во временный Yandex Managed PostgreSQL кластер. **Production не изменялся** (только read-only preflight).

## 1. Клон

| | |
|---|---|
| Источник | prod-кластер `c9qmbg***` (PG 17.10, БД HubTender + FOT_Prod), бэкап AUTOMATED 2026-08-03T00:12Z (95 MB) |
| Клон | `hubtender-migration-test-9781291-20260803` (`c9qla6***`), 1 хост ru-central1-d, b2.medium, 20 GB network-ssd, PG 17.10 |
| Restore | ~27 минут до RUNNING/ALIVE — **это и есть фактический restore-test прод-бэкапа** |
| Сеть | public IP + выделенная SG `enpebj***`: TCP 6432 только с 45.80.128.254/32 и адм. IP/32; egress any |
| Identity guard | PASS: хост ≠ прод-хоста, counts = preflight (84/75 796/217 789/36/20), схема в до-миграционном состоянии |
| Изоляция | тестовый JWT-ключ (не прод), notifications выключены (SMTP нет), OpenRouter не сконфигурирован (fake/off), rollout=off, публичного домена нет, доступ только localhost:18092 |
| Метки | purpose=migration-rehearsal, temporary=true, planned-delete-after=20260805; deletion-protection выкл |

## 2. Data-gates на клоне (реальные данные)

`markup_multiplyformat_affected = 0` (backfill применён к прод ранее) — **PASS автоматически**. FK-нарушения: cross-tender 0, cross-position-parent 0, dangling 0 — **PASS**. Owner-review не потребовался.

## 3. Фаза ADDITIVE — PASS

23 инкрементальных файла (7 pending + 16 идемпотентных повторов уже применённых) в лексикографическом порядке, затем **повторно целиком** (идемпотентность). Замер на файл 3.6–7.8 s, из них ~3–4 s — docker+TLS-оверхед подключения; чистое SQL-время фазы **< 1 минуты**. Проверки после: `section_number/position_name` ✓ (на этом проде их НЕ БЫЛО — фикс RC1 обязателен), revision-поля ✓, AI-таблицы 6 ✓, память импорта 2 ✓, композитные FK **провалидировались на живых данных** ✓, rollout=off ✓, quote-dates ✓.

## 4. Совместимость старого backend 6e8ea39 — ROLLING ADDITIVE COMPATIBLE

Прод-образ `hubtender-api:old-6e8ea39` против мигрированного клона: startup OK, `/health` и `/health/db` 200, auth-контур цел (401 без токена), чтение тендеров 200, **запись работает** (создание тендера → 201). SQL-триггеры grand-total в этой фазе ещё живы — старый код полностью работоспособен. ⇒ **Additive-миграции можно применять к прод БЕЗ остановки старого backend.**

## 5. Backfill multiplyFormat — подтверждённый no-op (0 строк до, 0 после).

## 6. Release backend 9781291 до retirement — PASS

`/health|db|recalc|ai` = 200. Смоук на клоне: BOQ create **201** (authoritative total 500 = 5×100×1); revision-цикл жив (rev 1/1 → 2/2 → 3/3, status calculated, CAS-успех после каждого пересчёта); tri-state PATCH `null` с If-Match → 200, в БД реальный NULL; ETag-конкуренция: устаревший → 412; **FX-репрайс по продуктовому пути** `PATCH /tenders/{id}/admin-fields` → 204, курс 90→95, авторитетный пересчёт; аналитика ×6 (quality-analytics, benchmarks, source, action-plan, change-impact, review-report) — **200 на реальных прод-данных**; `review-report.xlsx` — 200, верный MIME, 12 955 B; admin-AI: role-гейт (admin 200 / engineer 403), rollout state off, emergency-off 200, rollout остался off; capability для non-pilot корректно `rollout_off/available:false`; retired-endpoint `PATCH /items/bulk-commercial` → 410.

## 7. Фаза RETIREMENT — PASS

Старые сессии завершены (0 активных). 3 retire-миграции применены (5.4–5.9 s каждая, мгновенные lock'и). Проверки: grand-total-триггеров **0**; tombstone RPC — `ERROR: COMMERCIAL_COST_WRITE_RETIRED` и на вызов, и на NULL (fail-closed); release backend после retirement: health×4 = 200, финансовый цикл работает (FX 204, rev растёт) — **release не зависит от выведенных SQL-объектов** (после tombstones ни один workflow не упал — сильнейшее доказательство).

## 8. Полная приёмка и soak — PASS

**Go-suite против клон-кластера** (отдельная БД `hubtender_clone_test` на том же временном кластере): 21 пакет ok, **0 реальных падений**. Хроника честно: прогон №1 — интеграционные тесты **отказались** работать с восстановленной БД `HubTender` (guard «имя должно содержать test») — предохранитель против прод-данных сработал как задуман; №2 — каскад от несеяных `units` + 4 leftover-дубликата фикстур первого прогона; после `seed_minimum` и чистки — весь набор зелёный (включая перф-тест ретривала; repository re-verified `ok 15.6s`).

**30-мин soak**: 31 сэмпл, **0 health-фейлов** (health/db/recalc/ai = 200 ежеминутно), память 9.0→13.8 MiB (стабильна), фоновые аналитик-запросы 200×62; активности: review-pack XLSX 200 (m5, m25), FX-репрайс 204 (m10), emergency-off 200 (m15). Rollout после всего — **off**.

**Readiness-after**: rollout=off; grand-total-триггеров 0; композитные FK valid=2; все 86 тендеров `calculated` (84 прод + 2 синтетических), застрявших 0; approved=20 не повреждены; AI-леджер пуст.

Race/браузерный E2E на этом же SHA выполнены ранее в RC2-приёмке (0 гонок; 17/17) — на клоне не повторялись (код идентичен; отклонение задокументировано).

## 9. Production Deployment Matrix (фактическая, по замерам клона)

| # | Фаза | Что | Совместимость | Замер | Stop-условие |
|---|---|---|---|---|---|
| 0 | Final backup | Автоматический/ручной бэкап Yandex (restore проверен этой репетицией: ~27 мин до живого кластера) | — | 95 MB / 27 мин | нет бэкапа → стоп |
| 1 | Preflight | read-only аудит: markup=0, FK=0/0/0, длинных tx нет | — | < 1 мин | любой блокер → стоп |
| 2 | ADDITIVE (23 файла ×1; повтор ×2 по желанию) | психика rolling: **старый backend работает** | старый ✓ / новый требует | SQL < 1 мин | ошибка файла → стоп, схема совместима со старым кодом |
| 3 | Backfill multiplyFormat | no-op (0 строк) | ✓ | ~4 c | affected>0 → owner review |
| 4 | Остановить старый backend | `systemctl stop hubtender-bff` | — | секунды | — |
| 5 | Deploy backend 9781291 | образ из exact SHA (`HUBTENDER_BRANCH=release/hubtender-rc2-staging`), рестарт | новый ✓ | 2–4 мин build+restart | health×4 ≠ 200 → откат образа (retirement ещё НЕ применён — старый образ совместим!) |
| 6 | Backend smoke | health×4, BOQ-мутация на тестовом тендере, FX admin-fields, аналитика | — | 5 мин | fail → откат на старый образ |
| 7 | Deploy frontend | dist из того же SHA, rsync с автобэкапом | ✓ | 3–5 мин | — |
| 8 | Browser smoke | login, позиции, аналитика, Проверка данных | — | 10 мин | fail → вернуть public.backup |
| 9 | RETIREMENT ×3 | tombstones + удаление триггеров | старый ✗ (точка невозврата: дальше только roll-forward) | ~15 c | до этой фазы возможен полный откат |
| 10 | Финальный аудит | readiness, rollout=off, tombstones, здоровье | — | 5 мин | — |

**Maintenance-окно**: строго необходимо только на фазы 4–9 (~15–25 минут). Фазы 0–3 выполняются на работающем проде (rolling подтверждён фактически).

## 10. Клон после репетиции

НЕ удалён (`TEMP_YC_CLUSTER_DELETE_APPROVED=false`). Стоимость ~7–10 ₽/час. Команда удаления (не выполнена): `yc managed-postgresql cluster delete <clone-id>` — выполнить только после владельческого **«GO DELETE TEMP CLONE»** (identity-проверка повторяется перед удалением). Прод-бэкап не удалялся.

## Backlog-находки (не блокеры)

1. `PATCH /api/v1/tenders/{id}` (generic UpdateTender) отдаёт 412 даже на свежий ETag собственного GET — продуктовый путь (`admin-fields`, BOQ-item PATCH) работает; вероятно расхождение сериализации updated_at между путями. Разобрать отдельно.
2. Windows-curl искажает кириллицу в inline `-d` JSON — для скриптовых вызовов использовать `--data-binary @file` (UTF-8).
