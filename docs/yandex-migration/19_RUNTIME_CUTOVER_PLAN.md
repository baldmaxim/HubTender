# Runtime Cutover Plan

> Защищённый план production runtime cutover: переключение Go BFF
> `DATABASE_URL` на Yandex PostgreSQL. **В этом документе ничего не
> выполняется** — это план. Cutover — отдельный авторизованный шаг.
> Реальные DSN / пароли / токены / сертификаты в этот документ и в git не
> попадают (только имена переменных и project refs).

## 1. Current status

- **Yandex schema/data/auth verified.**
  - `08_SCHEMA_APPLY_RESULT.md` = `SCHEMA_APPLY_OK`
  - `09_SCHEMA_VERIFY_RESULT.md` = `SCHEMA_VERIFY_OK`
  - `12_DATA_IMPORT_REPORT.md` = `DATA_IMPORT_OK`
  - `13_YANDEX_VERIFY_RESULT.md` = `YANDEX_VERIFY_OK`
  - `14_YANDEX_AUTH_VERIFY_RESULT.md` = `YANDEX_AUTH_VERIFY_OK`
  - `17_TENDERS_UPDATED_AT_REPAIR_RESULT.md` = `TENDERS_UPDATED_AT_REPAIR_OK`
- **Go BFF Yandex verification OK** — `18_GO_BFF_YANDEX_VERIFICATION.md` =
  `GO_BFF_YANDEX_VERIFY_OK` (health/DB/Supabase-JWT auth/references/tenders/
  realtime `rowchange` — все OK на session-mode pooler).
- Предыстория OLD→PROD: `VERIFY_OK` / `AUTH_VERIFY_OK` /
  `READY_FOR_YANDEX_MIGRATION`.
- **Production runtime ещё НЕ переключён**: production `DATABASE_URL`
  по-прежнему указывает на PROD Supabase; backend/frontend deployment не
  менялись.
- **Supabase Auth остаётся временно** (login/JWT по-прежнему через PROD
  Supabase Auth).

## 2. Bridge architecture

Целевая **временная** архитектура после этого cutover:

```
React frontend
  → Supabase Auth (login, выпуск JWT)            [PROD Supabase, без изменений]
  → Go BFF: валидация Supabase JWT (JWKS/issuer)  [PROD Supabase, без изменений]
  → Go BFF: DATABASE_URL = Yandex PostgreSQL       [МЕНЯЕТСЯ этим cutover]
```

- Это **НЕ полный отказ от Supabase**: Supabase Auth (GoTrue) и Supabase SDK
  на фронте остаются.
- Это **DB runtime cutover**: меняется только источник данных Go BFF
  (PROD Supabase DB → Yandex PostgreSQL).
- **App-auth migration — следующий большой этап** (собственный login/JWT
  issuer/JWKS в Go, `app_auth` password store, отказ от Supabase Auth). Вне
  этого cutover.

## 3. Preconditions

Перед production cutover обязательно подтвердить:

1. **Актуальность последнего export/import Yandex.** Если в PROD Supabase
   были записи **после** последнего export — данные Yandex устарели. Тогда
   повторить полный цикл: freeze writes → fresh export PROD Supabase →
   `clean-yandex` → import → `verify` → `verify-passwords` → Go BFF smoke.
   Без подтверждённого write-freeze в окно export — cutover **No-Go**.
2. **PROD Supabase backup / restore point** создан.
3. **Yandex backup / restore point** создан (snapshot + PITR, если доступен).
4. **Production host имеет Yandex CA** на стабильном управляемом пути
   (не временный `/private/tmp/yandex-ca.pem` и не репозиторный
   `.certs/yandex-ca.pem`).
5. Production DSN использует **`sslmode=verify-full`**.
6. Подтверждён **session-mode** pooler Yandex (transaction-pooler ломает
   `LISTEN/NOTIFY`).
7. **`LISTEN/NOTIFY` канал `rowchange`** проверен на production-подобном
   соединении (end-to-end получение NOTIFY backend-ом).
8. **Go BFF локальный smoke с Yandex** прошёл (`GO_BFF_YANDEX_VERIFY_OK`).
9. Supabase JWKS/issuer **остаются PROD Supabase**:
   - `SUPABASE_JWKS_URL=https://ocauafggjrqvopxjihas.supabase.co/auth/v1/.well-known/jwks.json`
   - `SUPABASE_JWT_ISSUER=https://ocauafggjrqvopxjihas.supabase.co/auth/v1`
10. Production secrets подготовлены в secret-manager / Lockbox, **не в git**.

## 4. Production env changes

| Переменная | Было | Станет |
|---|---|---|
| `DATABASE_URL` | PROD Supabase DB DSN | **Yandex PostgreSQL DSN** (`...@<host>.mdb.yandexcloud.net:6432/<db>?sslmode=verify-full&sslrootcert=<in-container CA path>`) |
| `SUPABASE_JWKS_URL` | PROD Supabase | **без изменений** (PROD Supabase) |
| `SUPABASE_JWT_ISSUER` | PROD Supabase | **без изменений** (PROD Supabase) |
| `CORS_ORIGINS` | текущий frontend origin | **без изменений**, если origin фронта не меняется |
| `DB_MAX_CONNS` | текущее значение | проверить под Yandex pool/session-mode (лимит соединений кластера ≥ pool BFF + listener; consider держать умеренным, напр. ~5–20) |

**Yandex CA:** стабильный путь на production host, смонтированный в контейнер
read-only. Runtime-образ — `distroless/static` (нет shell/пакетного менеджера,
CA нельзя скачать в рантайме), поэтому CA должен быть **смонтирован томом**
(или забейкан в образ через `COPY`). В `docker-compose.yml` сервис `api`
сейчас **не** монтирует CA — для prod добавить:
```yaml
  api:
    volumes:
      - <host CA path>:/certs/yandex-ca.pem:ro
```
и в `DATABASE_URL` использовать `sslrootcert=/certs/yandex-ca.pem`
(in-container путь, не хостовый). Не использовать временный
`/private/tmp/yandex-ca.pem`.

**Single-DSN ограничение backend.** `backend/internal/config/config.go`
читает только `DATABASE_URL`; realtime listener использует этот же DSN.
Поэтому он **обязан быть session-safe** (используется и для обычных запросов
из pgx-пула, и для `LISTEN/NOTIFY`). Текущий session-mode pooler это
обеспечивает. Если позже добавить `REALTIME_DATABASE_URL`, runtime можно
разделить: pgx-пул на pooler + отдельный direct/session listener DSN
(отдельная backend-задача, не в этом cutover).

## 5. Cutover steps

1. Объявить **maintenance window**, уведомить пользователей.
2. Остановить write-path старого backend (или подтвердить, что новых записей
   в PROD Supabase нет — write-freeze).
3. Проверить **актуальность данных Yandex** (см. §3.1; при дельте — повторный
   export/clean/import/verify).
4. Сделать **backup/restore point Yandex**.
5. Сделать **backup/restore point PROD Supabase**.
6. Обновить production backend env: `DATABASE_URL` → Yandex; актуальный
   in-container CA path (`sslmode=verify-full`); Supabase JWKS/issuer —
   оставить PROD Supabase.
7. **Перезапустить backend** (rolling/blue-green по возможности).
8. Прогнать post-cutover smoke (см. §6): `/health`, `/health/db`, Supabase
   login, `/api/v1/me`, `/api/v1/me/permissions`, references, tenders,
   realtime listener.
9. Открыть доступ пользователям.
10. Мониторить логи / error rate / latency / DB connections / listener
    reconnects в течение оговорённого периода наблюдения.

## 6. Smoke tests after cutover

- `GET /health`
- `GET /health/db`
- Supabase Auth login (получить JWT)
- `GET /api/v1/me`
- `GET /api/v1/me/permissions`
- `GET /api/v1/references/roles`
- `GET /api/v1/references/units`
- `GET /api/v1/references/material-names`
- `GET /api/v1/references/work-names`
- `GET /api/v1/references/cost-categories`
- `GET /api/v1/references/detail-cost-categories`
- `GET /api/v1/tenders?limit=5`
- открыть страницу тендера (UI)
- открыть BOQ (UI)
- проверить notifications / realtime (`rowchange` доходит до клиента)
- создание/обновление **тестовой** записи — **только** если write-smoke явно
  разрешён оператором (по умолчанию НЕ выполнять)

## 7. Auth drift risk

Пока Supabase Auth остаётся, **любые изменения в Supabase Auth после DB
cutover не синхронизируются автоматически в Yandex `auth.users`** (DB уже
Yandex, а Auth ещё Supabase).

Затронуты:
- новые **регистрации** (новый пользователь появится в Supabase Auth, но не в
  Yandex `auth.users`/`public.users` → FK/доступ сломаются);
- **password reset** (новый bcrypt-хеш в Supabase, в Yandex старый — но JWT
  валидирует Supabase, так что вход пройдёт; рассинхрон хеша);
- **смена email**;
- **смена пароля**.

Mitigation (варианты):
1. Временно **отключить регистрацию / password reset** до app-auth.
2. Разрешить только **login существующих** пользователей.
3. Сделать **sync-процесс** Supabase Auth → Yandex `auth.users`
   (периодический/по событию).
4. **Ускорить переход на Go app-auth** (убирает источник drift полностью).

**Рекомендация:** до app-auth — ограничить новые регистрации и password reset
(вариант 1+2), либо явно и письменно принять риск drift с владельцем.

## 8. Rollback

**До пользовательских writes в Yandex:**
- вернуть `DATABASE_URL` на PROD Supabase DSN;
- перезапустить backend;
- проверить `/health/db`;
- пользователи снова работают с Supabase DB. Откат полный и безопасный.

**После пользовательских writes в Yandex:**
- простой откат **опасен**: записи, сделанные в Yandex после cutover, в PROD
  Supabase отсутствуют;
- требуется **reconciliation / export delta** Yandex → PROD до повторной
  попытки;
- иначе — потеря данных. Назначить владельца rollback и заранее описать
  процедуру delta-сверки.

## 9. Stop conditions

Немедленно остановить cutover (и выполнять rollback по §8) при любом из:

- `/health/db` failed;
- Supabase JWT отвергается (JWKS/issuer mismatch);
- `/api/v1/me` failed;
- references failed;
- tenders failed;
- realtime listener failed (нет подключения / нет `rowchange`);
- SSL CA path invalid / `verify-full` не проходит;
- нестабильное соединение с Yandex (обрывы, таймауты, пул не наполняется);
- обнаружены **неожиданные записи в PROD Supabase после export** (данные
  Yandex устарели);
- auth smoke failed.

## 10. Go / No-Go checklist

| Пункт | Status |
|---|---|
| Yandex verify OK (`YANDEX_VERIFY_OK`) | ☐ |
| Yandex auth verify OK (`YANDEX_AUTH_VERIFY_OK`) | ☐ |
| Go BFF Yandex verify OK (`GO_BFF_YANDEX_VERIFY_OK`) | ☐ |
| Production CA path ready (стабильный, не temp) | ☐ |
| Session-mode pooler ready (LISTEN/NOTIFY OK) | ☐ |
| Backup Yandex ready (snapshot/PITR) | ☐ |
| Backup PROD Supabase ready | ☐ |
| Data freshness confirmed (write-freeze / нет дельты) | ☐ |
| Auth drift decision made (ограничить регистрации/reset или принять риск) | ☐ |
| Rollback owner assigned | ☐ |
| Operator approval (явное «Go») | ☐ |

**Go только если все пункты отмечены.** Любой незакрытый пункт = No-Go.

## 11. Explicit non-goals

- Этот cutover **не удаляет Supabase Auth** (GoTrue остаётся источником
  login/JWT).
- Этот cutover **не удаляет Supabase SDK** (фронт продолжает использовать
  Supabase Auth client).
- **Frontend пока не меняется** (origin/код фронта без изменений).
- **App-auth migration — отдельный этап** (Go app-auth: login/refresh/forgot/
  reset, собственный JWKS, `app_auth` store).
- **Supabase project не удалять сразу после cutover** — он остаётся
  rollback-путём и источником Auth до app-auth.

---

> Статус документа: **PLAN ONLY**. Cutover не выполнялся. Production env не
> менялся. Реальный cutover — отдельный авторизованный промт после закрытия
> Go/No-Go checklist (§10) и решения по auth drift (§7).
