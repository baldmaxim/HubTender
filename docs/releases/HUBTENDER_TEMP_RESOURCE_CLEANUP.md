# HUBTender — очистка временных ресурсов (этап 3.3R|1 closeout, 2026-08-05)

Решение владельца (письменно, директива 3.3R|1 closeout): `STOP_REMAINING_REQUAL_TESTS_APPROVED=true`, `CLEANUP_ALL_TEST_RESOURCES_APPROVED=true`, `TEMP_YC_CLUSTER_DELETE_APPROVED=true`, `OWNER_ACCEPTS_REQUALIFICATION_RESIDUAL_RISK=true`.

## Остановленные тесты (статус, не PASS)

| Тест | Статус | Причина / успел |
|---|---|---|
| Repository full suite vs клон | **ABORTED_BY_OWNER** | WAN-латентность + ресурсы хоста; 1-й прогон упёрся в 10-мин таймаут go test (services/handlers PASS), 2-й остановлен |
| Clone Playwright | **NOT EXECUTED TO COMPLETION** | Node OOM (16 ГБ хост, свободно <1 ГБ), конфликт с контейнерами другого проекта |
| Clone race detector | **NOT EXECUTED TO COMPLETION** (keycrypt — race PASS) | падения docker-демона под нагрузкой |

Компенсация: race-чистый полный сьют `9781291` (RC-гейты), прод-браузерный смоук базового релиза, targeted AI-key Go/API/security PASS (см. requal-отчёт). **OWNER ACCEPTED RESIDUAL TEST RISK.**

## Удаление временного Yandex-клона

- Identity guard перед удалением (повторно): клон `c9qla6***` = `hubtender-migration-test-9781291-20260803`, labels `temporary=true, purpose=migration-rehearsal, release=9781291`; прод `c9qmbg***` = `postgresql-psdsk2`; ID/host различаются — PASS.
- `yc managed-postgresql cluster delete <точный ID>` — операция **done за 4m35s** (синхронно), после чего `cluster list`: клонов migration-test **0**, прод RUNNING/ALIVE.
- Биллинг клона (~7–10 ₽/час) остановлен.

## Удаление clone-SG

`enpebj***` (имя = имени клона, не default-SG сети) удалён после удаления кластера (attachments 0). Прод-SG и default-SG сети не менялись.

## IAM / секреты

- Yandex SA (профиль `hubtender`, authorized_key в корне проекта, gitignored) — **оставлен**: операционный доступ к облаку TenderHUB, не clone-only. Рекомендация владельцу: отозвать ключ через консоль, когда облачные операции перестанут быть нужны.
- Локально удалены: тестовый JWT-ключ клона + wrong-master PEM, минт-утилита (`backend/tmp_mint/`, mint.exe), токены (.tok-*), clone-DSN, список тест-пользователей, скрипты/логи API- и UI-смоука (содержали синтетические ключи/суффиксы), fake-OpenRouter сервер (файл+процесс).
- Сохранены (redacted, без секретов): `requal-evidence-summary.json`, rehearsal-артефакты (clone-summary, deployment-matrix, readiness и др.), release-документация, sha256 миграции.

## Локальный Docker

Удалены только доказанно наши: контейнер `requal-api`, образ `hubtender-api:c2c1171`, volume `go-mod-cache`. Остановлены наши процессы: vite:5199, fake-провайдер, go test. **Не тронуты**: `docker-api-1`, `docker-worker-*`, `docker-db_postgres-1` (другой проект), прод-ресурсы, release-образы (`hubtender-api:rc2-9781291` и пр.), чужие volumes. Глобальный prune не использовался.

## Production after-cleanup (13:2xZ 05.08)

Кластер RUNNING/ALIVE; фронт 200, api-гейт 401, key-гейт 401; rollout **off**, stale/calc/failed **0/0/0**, ai_usage **0**, сессии 20 (живой трафик). Рестартов прод-контейнеров из-за очистки нет (прод не трогали вовсе). Writes не выполнялись. Clone-hostname в прод-конфиге не используется (никогда не прописывался).

## Credential revocation

`OLD_OPENROUTER_KEY_REVOKED=true`, `MERIDIAN_SA_KEY_REVOKED=true` — по письменному заявлению владельца → `ALL_KNOWN_COMPROMISED_KEYS_REVOKED=true`.

## Итог

Chargeable/running тестовых ресурсов: **0**. Бэкапы прода (financial 2 795 MB + автоматические) сохранены. Вердикт этапа — в `HUBTENDER_CURRENT_PRODUCTION_REQUALIFICATION.md`.
