# HUBTender — Requalification текущего прода (этап 3.3R|1, 2026-08-05)

## 1. Причина

Во время первоначального 24H hold базового релиза `04ef152` на прод были выкачены (владельцем, вне release-контура) frontend и backend из main (`c2c1171`), применена миграция ai-key и произошёл кратковременный HTTP 500. Текущая прод-версия потребовала отдельной security/runtime квалификации перед этапом 3.4.

## 2. Base release hold

Базовое окно 04.08 10:10 → 05.08 10:10 UTC: 309 проб, 0 сбоев — см. `HUBTENDER_PRODUCTION_24H_HOLD.md`. Отнесено к предыдущему прод-состоянию; для текущего состояния выполнен отдельный rehold (§13 ниже).

## 3. Out-of-band deployment (дифф-аудит `04ef152 → c2c1171 → 3203935`)

| Область | Изменения | Security/DB/runtime-эффект |
|---|---|---|
| Архивы/мёртвые скрипты | ~250 удалений (archive/, scripts/archive, supabase-legacy) | нулевой (не в рантайме) |
| Quality-правила | trim_scale в 13 md-фингерпринтах | только стабильность подтверждений «Проверки данных»; финформулы не задеты |
| ai-key-ui | keycrypt, ai_key repo, services, handler, wire/routes, openrouter KeySource, frontend AdminAiSettings, миграция + baseline, 2 guard-скрипта | новая поверхность — покрыта аудитом §4–7 |
| Frontend cleanup | удалена страница ConstructionCost + меню/роуты | UI-only |
| Доки | deployment/hold отчёты | нет |

**Критические контуры не тронуты**: `internal/calc`, BOQ-мутации, recalc, revision/CAS, recovery, approval, redistribution, Smart Import, Review Pack — ни одного файла в диффе. `c2c1171 → 3203935` — только документация.

## 4. Текущая идентичность прода

- Backend/frontend: `c2c1171` (маршрутная сигнатура /key 401; бандл `index-RTxlj7W8.js`, Last-Modified 04.08 10:47:21 GMT — не менялся до конца rehold).
- main/report: `3203935`.
- Миграция `2026_08_ai_api_key_ui.sql` (sha256 `3fdee29c…`) применена 04.08 ~12:47Z (×2, идемпотентно) — 4 колонки + check-constraint, plaintext-дефолтов нет.
- Ключ сохранён из UI 04.08 **12:52:46Z** (`api_key_set_at`) — последнее изменение прода → `REQUALIFICATION_HOLD_START`.

## 5. HTTP 500 review

Код `c2c1171` (выкачен ~12:30Z) писал в колонки до миграции → SQLSTATE 42703 на `POST /admin/ai/openrouter/key`. Окно ~12:30–12:47Z 04.08; затронут только админ-эндпоинт сохранения ключа; UPDATE атомарный — partial writes невозможны; `AIKeyResolver` штатно деградировал на env; AI выключен, пользователи не задеты. После миграции ключ сохранён с первой попытки; повторов 0 (key-related 5xx после миграции не наблюдалось; фактическое сохранение и последующая работа ключа — доказательство).

## 6–7. Threat model / шифрование и хранение

- **Хранение**: только AES-256-GCM-шифротекст в `ai_feature_settings.api_key_ciphertext` (bytea, ~101 байт), суффикс ≤8 симв., временные метки, set_by.
- **KDF**: ключ шифрования = SHA-256(байты PEM JWT-private-key). Детерминированный, без усечения, без парсинга PEM. **Domain separation отсутствует** — backlog (HKDF с context `hubtender/openrouter-key-encryption/v1`); немедленной утечки не создаёт (материал высокоэнтропийный, использование единственное).
- **Envelope v0**: `nonce || ciphertext`, длина nonce фиксирована AEAD (GCM 12), парсер отвергает короткие/битые blob'ы fail-closed (`ErrCiphertext`). Version byte отсутствует — допустимо при одном фиксированном формате; **обязательное ограничение runbook**: следующая security-миграция вводит versioned envelope (`version|alg|key-id|nonce|ct`) + процедуру re-encryption.
- **Master-материал**: файл/переменная на сервере, вне БД/бэкапов/репозитория/фронта; derived key не логируется. Бэкап БД содержит только шифротекст; без master-материала не расшифровывается (доказано wrong-master-тестом).
- **Ограничение ротации**: смена JWT signing key без re-encryption делает шифротекст нечитаемым (fail-closed, деградация на env) — ротация JWT-ключа запрещена без пере-ввода OpenRouter-ключа, пока нет re-encryption procedure.

## 8. Rotation (клон, синтетические ключи, fake-провайдер)

Save A → rotate B → конкурентные C/D: шифротекст-only в БД, backend-side использование расшифрованного ключа (fake-провайдер видел только текущий bearer), после ротации старый ключ не используется, конкурентная ротация даёт один консистентный финал, invalid/empty запросы (400) не затирают ключ, delete → none, wrong-master fail-closed без 5xx, рестарт с верным master — ключ снова читается.

## 9. Access control

Маршруты key/status/test-connection — внутри admin-группы (`RequireRoles`): unauth 401, non-admin (engineer) 403 на status/save/delete. Read-back эндпоинта нет; наружу — только источник/суффикс/метки времени.

## 10. Clone validation

Клон `c9qla6***` (`hubtender-migration-test-9781291-20260803`, labels temporary=true): identity guard PASS, миграция ×2 на обе БД PASS, Go-тесты (keycrypt+race, openrouter, nomenclature, aieval, services key, repo ai_key-roundtrip, calc, services, handlers) PASS, API-тесты 16/16 PASS. **ABORTED_BY_OWNER** (см. §12 residuals): полный repository-сьют, clone-Playwright, clone-race (кроме keycrypt).

## 11. Production read-only verification

12:52:46Z 04.08 → 13:08Z 05.08: фронт/бэкенд не менялись (Last-Modified/бандл/маршруты), ключ не ротировался (`key_set_at` неизменен), rollout off, ai_usage 0, резерваций 0, stale/calc/failed 0/0/0, calculated 85, бэкенд отвечал во всех пробах (api-гейт 401 + SQL-метрики; внешние `/health*` — SPA-фолбэк nginx, не бэкенд), сессии 10–41. Скан задеплоенного бандла: 0 ключей/PEM.

## 12. Остаточные тесты (решение владельца)

- Repository full clone suite: **ABORTED_BY_OWNER** — WAN-латентность/ресурсы хоста (первый прогон упёрся в 10-мин таймаут go test; services/handlers PASS).
- Clone Playwright: **NOT EXECUTED TO COMPLETION** — Node OOM/нехватка RAM/конфликт с контейнерами другого проекта.
- Clone race detector: **NOT EXECUTED TO COMPLETION** (keycrypt — race PASS) — падения docker-демона под нагрузкой.

Компенсирующие доказательства: race-чистый полный сьют на `9781291` в RC-гейтах; браузерный смоук базового релиза на проде; targeted AI-key Go/API/security-тесты PASS; 24H мониторинг прода; финальный read-only смоук. **OWNER ACCEPTED RESIDUAL TEST RISK** (`OWNER_ACCEPTS_REQUALIFICATION_RESIDUAL_RISK=true`).

## 13. Rehold (24 ч текущего состояния)

`2026-08-04T12:52:46Z → 2026-08-05T12:52:46Z` (UTC, полные 24 ч): **293/293 уникальных проб зелёные** (5-мин интервал), 0 stop-условий, изменений кода/схемы/конфига/ключа в окне не было (сброса hold-clock нет). Разрывы наблюдения: 10:17–10:36Z 05.08 (~19 мин, рестарты окна VS Code) — смежные пробы зелёные.

## 14. Clone deletion

См. `HUBTENDER_TEMP_RESOURCE_CLEANUP.md` (identity guard повторён перед удалением; прод-кластер `c9qmbg***` не затрагивался).

## 15. Оставшиеся pilot-гейты

- Скомпрометированные ключи: `OLD_OPENROUTER_KEY_REVOKED=true`, `MERIDIAN_SA_KEY_REVOKED=true` — по письменному заявлению владельца (директива 3.3R|1) → `ALL_KNOWN_COMPROMISED_KEYS_REVOKED=true`.
- Пилот 3.4|0 — отдельная директива владельца.
- Runbook-ограничения: без ротации JWT-ключа до re-encryption; versioned envelope + HKDF domain separation — обязательные требования следующей security-миграции.

## 16. Вердикт

**CURRENT PRODUCTION REQUALIFIED — OWNER-ACCEPTED RESIDUALS — TEMP RESOURCES DELETED — PILOT READY** (при условии зелёного after-cleanup чека — зафиксирован в cleanup-отчёте).
