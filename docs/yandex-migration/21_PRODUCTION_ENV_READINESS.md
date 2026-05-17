# Production Env Readiness — Yandex CA & DSN

> Закрывает технический blocker «Production CA path + backend container mount»
> из [20_RUNTIME_CUTOVER_READINESS.md](./20_RUNTIME_CUTOVER_READINESS.md) §3 /
> [19_RUNTIME_CUTOVER_PLAN.md](./19_RUNTIME_CUTOVER_PLAN.md) §4. **Ничего не
> выполняется и не деплоится.** Production env/код/`DATABASE_URL` не меняются.
> Реальные DSN / пароли / токены / сертификаты в git НЕ попадают (только
> плейсхолдеры, имена переменных, публичные JWKS/issuer).

- Дата (UTC): 2026-05-18
- Backend runtime image: `gcr.io/distroless/static-debian12` (см.
  `backend/Dockerfile`) — нет shell/пакетного менеджера, CA **нельзя** скачать
  в рантайме; он должен быть в файловой системе контейнера.
- Backend читает только `DATABASE_URL` (один DSN: pgx-пул + realtime
  `LISTEN/NOTIFY`); отдельного realtime-DSN env нет.
- Репозиторный `docker-compose.yml` — **local-dev** (api+redis+caddy), у `api`
  тома для CA нет. Production compose/манифест **в репозитории отсутствует** →
  ниже только non-secret template; репо-compose НЕ меняется (чтобы не сломать
  local dev).

## 1. Production CA requirement

- Yandex Managed PostgreSQL требует SSL **`verify-full`**.
- CA-файл должен быть доступен **внутри backend runtime-контейнера**.
- Локальный `/private/tmp/yandex-ca.pem` (использовался в локальном smoke)
  **НЕ годится** для production (эфемерный путь, теряется при пересоздании).
- Рекомендуемый **in-container** путь: **`/certs/yandex-ca.pem`** (read-only).
- Источник CA: `https://storage.yandexcloud.net/cloud-certs/CA.pem` (bundle, 2
  cert, действует до **2027-06-20** — запланировать ротацию заранее).

## 2. Required production env

| Переменная | Значение (production) |
|---|---|
| `DATABASE_URL` | Yandex DSN с `...?sslmode=verify-full&sslrootcert=/certs/yandex-ca.pem` (session-mode pooler; реальное значение — только в secret-manager) |
| `SUPABASE_JWKS_URL` | `https://ocauafggjrqvopxjihas.supabase.co/auth/v1/.well-known/jwks.json` (без изменений) |
| `SUPABASE_JWT_ISSUER` | `https://ocauafggjrqvopxjihas.supabase.co/auth/v1` (без изменений) |
| `CORS_ORIGINS` | без изменений (если origin фронта не меняется) |
| `DB_MAX_CONNS` | пересмотреть под Yandex (≥ pool BFF + listener, ≤ лимит кластера; держать умеренным) |
| ~~Supabase DB DSN~~ | **после cutover не использовать** (никакого Supabase DB DSN в backend env) |

Плейсхолдер DSN (НЕ реальный):
```
DATABASE_URL=postgresql://<user>:<password>@<cluster-host>.mdb.yandexcloud.net:6432/<db>?sslmode=verify-full&sslrootcert=/certs/yandex-ca.pem
```

## 3. Secret manager

- Yandex `DATABASE_URL` хранится **только** в secret-manager / deployment
  secret (Lockbox / Vault / CI secret / orchestrator secret).
- **НЕ** в git; **НЕ** в `.env.example` с реальным значением (там только
  плейсхолдер); **НЕ** в логах (скрипты редактируют DSN при выводе).
- CA-файл (`.pem`) — на хосте/в secret-volume, **в git не коммитить**
  (`.certs/` локально не добавлять в индекс).
- Ротация: обновить CA-файл и (при смене) DSN-secret до истечения CA.

## 4. Docker / compose mount (template — placeholders only)

Production compose/манифест неизвестен → ниже **шаблон**, репо-compose не
меняется. Хостовый путь и значения — плейсхолдеры.

docker-compose (production override, НЕ репозиторный local-dev файл):
```yaml
services:
  api:
    environment:
      DATABASE_URL: ${DATABASE_URL}          # из secret-manager, verify-full
      SUPABASE_JWKS_URL: https://ocauafggjrqvopxjihas.supabase.co/auth/v1/.well-known/jwks.json
      SUPABASE_JWT_ISSUER: https://ocauafggjrqvopxjihas.supabase.co/auth/v1
      CORS_ORIGINS: ${CORS_ORIGINS}
      DB_MAX_CONNS: ${DB_MAX_CONNS}
    volumes:
      - <HOST_CA_PATH>/yandex-ca.pem:/certs/yandex-ca.pem:ro   # read-only
```
`docker run` эквивалент:
```
docker run --rm -p 3005:3005 \
  --env-file <SECRET_ENV_FILE_OUTSIDE_GIT> \
  -v <HOST_CA_PATH>/yandex-ca.pem:/certs/yandex-ca.pem:ro \
  hubtender-api:<tag>
```
Kubernetes-вариант (кратко): CA как `Secret`/`ConfigMap`, смонтированный
файлом в `/certs/yandex-ca.pem` (`readOnly: true`); DSN — из `Secret` env.

Альтернатива (если volume недоступен): `COPY <ca>.pem /certs/yandex-ca.pem` в
production-Dockerfile — но тогда ротация CA = пересборка образа (репозиторный
`backend/Dockerfile` не менять для этого).

## 5. Verification before cutover

1. Запустить контейнер с Yandex `DATABASE_URL` (verify-full, CA в
   `/certs/yandex-ca.pem`).
2. `GET /health` → 200.
3. `GET /health/db` → 200 (реальный коннект к Yandex).
4. Проверить логи backend: **нет** TLS/cert ошибок (`x509`, `certificate`,
   `sslmode`, `verify`).
5. Подтвердить, что **realtime listener стартует** (`connected; listening on
   channel rowchange`).
6. Прогнать read-only smoke (`/api/v1/me`, references, tenders) — как в
   `18_GO_BFF_YANDEX_VERIFICATION.md`.
7. **Без write-тестов**, если они явно не разрешены оператором.

(Уже подтверждено локально: `GO_BFF_YANDEX_VERIFY_OK`. Здесь — повтор на
production-подобном окружении с production CA путём.)

## 6. Rollback

- Восстановить **предыдущий `DATABASE_URL` secret** (PROD Supabase DSN).
- Перезапустить backend.
- Проверить `GET /health/db` (коннект к Supabase).
- До новых writes в Yandex — откат полный/безопасный. После writes —
  требуется reconciliation/delta (см. 19 §8). CA mount можно оставить —
  он не мешает Supabase DSN.

## 7. Open checklist

| Пункт | Status | Owner |
|---|---|---|
| CA file staged на production host (стабильный путь, не temp) | ☐ OPEN | DevOps |
| CA mounted в контейнер `/certs/yandex-ca.pem:ro` | ☐ OPEN | DevOps |
| `DATABASE_URL` secret подготовлен (Yandex, verify-full, `/certs` CA) в secret-manager | ☐ OPEN | DevOps |
| `DB_MAX_CONNS` пересмотрен под Yandex | ☐ OPEN | DevOps |
| `SUPABASE_JWKS_URL`/`ISSUER` остаются PROD Supabase | ✅ (значения зафиксированы) | — |
| Никаких реальных секретов/сертификатов в git | ✅ (только плейсхолдеры) | — |

**Все ☐ OPEN должны стать ✅ до Go.** Любой open = No-Go (см. 20 §8).

---

> Статус: **DOC ONLY — NOT EXECUTED.** Production env/код/deployment не
> менялись; `docker-compose.yml` не менялся; сертификаты не коммитились.
> Реальный production-конфиг и cutover — отдельные авторизованные шаги.
