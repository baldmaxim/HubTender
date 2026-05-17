# Runtime Cutover Readiness Checklist

> Снимок готовности к production runtime cutover (Go BFF `DATABASE_URL` → Yandex
> PostgreSQL). **Cutover в этом документе НЕ выполняется.** Production env / код
> / deployment не меняются. Дополняет план
> [19_RUNTIME_CUTOVER_PLAN.md](./19_RUNTIME_CUTOVER_PLAN.md). Реальные DSN /
> пароли / токены / сертификаты в git не попадают.

- Дата снимка (UTC): 2026-05-18
- Migration gates (зелёные): `SCHEMA_VERIFY_OK`, `DATA_IMPORT_OK`,
  `YANDEX_VERIFY_OK`, `YANDEX_AUTH_VERIFY_OK`, `GO_BFF_YANDEX_VERIFY_OK`
  (+ `SCHEMA_APPLY_OK`, `TENDERS_UPDATED_AT_REPAIR_OK`).
- Архитектура после cutover (временный bridge): frontend → Supabase Auth
  (login/JWT) → Go BFF (валидация Supabase JWT) → **Yandex PostgreSQL** (только
  DB меняется). Полный отказ от Supabase Auth — отдельный этап.

## 1. Data freshness

- ✅ **Оператор подтвердил:** после последнего PROD Supabase → Yandex
  export/import записей в PROD Supabase **не было** → данные Yandex актуальны.
- ⚠️ **Условие сохранения готовности:** если до момента cutover в PROD Supabase
  появятся любые записи — данные Yandex устаревают, и **обязательно** повторить
  цикл: write-freeze → fresh export → `clean-yandex` → import → `verify` →
  `verify-passwords` → Go BFF smoke. Без этого cutover = **No-Go**.
- Действие перед Go: повторно подтвердить write-freeze/отсутствие дельты
  непосредственно в окно cutover (не полагаться только на прошлое
  подтверждение).

## 2. Auth drift decision

- Bridge mode: login/JWT по-прежнему через **PROD Supabase Auth**; Go BFF
  валидирует Supabase JWT (JWKS/issuer не меняются). DB уже Yandex.
- **Решение (требует фиксации оператором):** до app-auth —
  - **отключить или строго контролировать**: новые регистрации, password
    reset, смену email, смену пароля (эти операции идут в Supabase Auth и НЕ
    синхронизируются в Yandex `auth.users`/`public.users` → FK/доступ/хеши
    рассинхронизируются);
  - **login существующих пользователей — разрешён** (JWT валиден, профиль уже
    в Yandex после миграции).
- Варианты: (1) выключить registration/reset в UI/Supabase; (2) только login;
  (3) sync Supabase Auth→Yandex; (4) ускорить app-auth. Рекомендация: (1)+(2)
  до app-auth, либо письменно принять риск drift с владельцем.
- Статус: **OPEN** — решение и его исполнитель не зафиксированы.

## 3. Production CA

- Нужен **стабильный** путь к Yandex CA в production контейнере/хосте.
- ❌ Локальный `/private/tmp/yandex-ca.pem` (использовался в локальном smoke) —
  **не подходит** для production (эфемерный путь).
- ✅ Рекомендуемый in-container путь: **`/certs/yandex-ca.pem`**.
- `DATABASE_URL` должен использовать
  **`sslmode=verify-full&sslrootcert=/certs/yandex-ca.pem`**.
- Runtime-образ `distroless/static` (нет shell/пакетного менеджера, CA нельзя
  скачать в рантайме) → CA **смонтировать томом** read-only (или забейкать
  `COPY` в образ). В `docker-compose.yml` сервис `api` сейчас **не** монтирует
  CA — добавить для prod:
  `volumes: [ "<host CA path>:/certs/yandex-ca.pem:ro" ]`.
- Источник CA: `https://storage.yandexcloud.net/cloud-certs/CA.pem` (bundle, 2
  cert, действует до **2027-06-20** — запланировать ротацию).
- Статус: **OPEN** — стабильный prod-путь и том не настроены.

## 4. Production env to change during cutover

| Переменная | Действие |
|---|---|
| `DATABASE_URL` | **изменить** → Yandex DSN (`...@<host>.mdb.yandexcloud.net:6432/<db>?sslmode=verify-full&sslrootcert=/certs/yandex-ca.pem`); session-mode pooler |
| `SUPABASE_JWKS_URL` | **без изменений** — `https://ocauafggjrqvopxjihas.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_JWT_ISSUER` | **без изменений** — `https://ocauafggjrqvopxjihas.supabase.co/auth/v1` |
| `CORS_ORIGINS` | **без изменений** (если origin фронта не меняется) |
| `DB_MAX_CONNS` | **проверить** под Yandex pool/session-mode (≥ pool BFF + listener, не превышать лимит кластера; держать умеренным) |

Backend читает только `DATABASE_URL` (один DSN на pgx-пул и LISTEN/NOTIFY) →
он обязан быть **session-safe**; текущий session-mode pooler это обеспечивает.

## 5. Backups (перед cutover, обязательно)

- ☐ **Yandex** restore point (snapshot + PITR, если доступен) — создать
  непосредственно перед cutover.
- ☐ **PROD Supabase** restore point — создать непосредственно перед cutover.
- Оба — обязательные предусловия Go; без них **No-Go**.

## 6. Runtime smoke after switch

После переключения и рестарта backend прогнать:

- `GET /health`
- `GET /health/db`
- Supabase Auth login (получить JWT)
- `GET /api/v1/me`
- `GET /api/v1/me/permissions`
- `GET /api/v1/references/roles` / `units` / `material-names` / `work-names` /
  `cost-categories` / `detail-cost-categories`
- `GET /api/v1/tenders?limit=5`
- Realtime: listener подключён, `LISTEN/NOTIFY` канал `rowchange` доставляет
  события (без write-тестов, если они не разрешены оператором)

Любой провал из списка stop-conditions (см. 19 §9) → немедленный rollback.

## 7. Rollback

- **До новых writes в Yandex:** вернуть `DATABASE_URL` на PROD Supabase DSN →
  рестарт backend → проверить `/health/db` → пользователи снова на Supabase DB.
  Откат полный, безопасный.
- **После новых writes в Yandex:** простой откат **опасен** — записи,
  сделанные в Yandex после cutover, отсутствуют в PROD Supabase; требуется
  **reconciliation / export delta** Yandex → PROD до повторной попытки. Иначе
  потеря данных.
- Назначить **rollback owner** заранее.

## 8. Go / No-Go

| Пункт | Status | Owner |
|---|---|---|
| `SCHEMA_VERIFY_OK` | ✅ | — |
| `DATA_IMPORT_OK` | ✅ | — |
| `YANDEX_VERIFY_OK` | ✅ | — |
| `YANDEX_AUTH_VERIFY_OK` | ✅ | — |
| `GO_BFF_YANDEX_VERIFY_OK` | ✅ | — |
| Data freshness re-confirmed в окно cutover | ☐ OPEN | оператор |
| Auth drift decision зафиксирован (отключить registration/reset либо принять риск) | ☐ OPEN | владелец продукта/оператор |
| Production CA на стабильном пути + том в compose | ☐ OPEN | DevOps |
| `DATABASE_URL` (Yandex DSN, verify-full, /certs CA) подготовлен в secret-manager | ☐ OPEN | DevOps |
| `DB_MAX_CONNS` проверен под Yandex | ☐ OPEN | DevOps |
| Yandex restore point | ☐ OPEN | DevOps |
| PROD Supabase restore point | ☐ OPEN | DevOps |
| Rollback owner назначен | ☐ OPEN | — |
| Operator approval (явное «Go») | ☐ OPEN | оператор |

**Go только если ВСЕ пункты ✅.** Любой ☐ OPEN = **No-Go**.

## 9. Non-goals (напоминание)

Этот cutover **не** удаляет Supabase Auth/SDK, **не** меняет frontend, **не**
выполняет app-auth migration, **не** удаляет Supabase project (остаётся
rollback-путём и источником Auth до app-auth).

---

> Статус: **READINESS SNAPSHOT — NOT EXECUTED.** Cutover не выполнялся;
> production env/код/deployment не менялись. Реальный cutover — отдельный
> авторизованный промт после закрытия всех ☐ OPEN.
