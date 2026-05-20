# Runtime Cutover Result

> Практический DB runtime cutover в **bridge-mode** (Go BFF `DATABASE_URL` →
> Yandex; Supabase Auth остаётся источником JWT). App-auth не внедрялся,
> frontend/Supabase SDK не менялись. DSN/пароли/токены не печатались.

- Дата (UTC): 2026-05-18
- Связано: [19](./19_RUNTIME_CUTOVER_PLAN.md), [20](./20_RUNTIME_CUTOVER_READINESS.md),
  [21](./21_PRODUCTION_ENV_READINESS.md), [18](./18_GO_BFF_YANDEX_VERIFICATION.md).

## 0. Где выполнено

Cutover выполнен **оператором на production/new сервере** (`hub`, домен
`tender.su10.ru`), где есть Docker и сетевой доступ к Yandex. Sandbox только
формировал команды и фиксировал результат; реальные секреты в sandbox/git не
попадали. Образ собран **на самом сервере** (native `amd64`) из GitHub `main`
(`backend/` при cutover не менялся → состояние == проверенному
`GO_BFF_YANDEX_VERIFY_OK`).

## 1. Env / DB readiness

| Проверка | Результат |
|---|---|
| Yandex reachable (`:6432` session-mode pooler) | ✓ |
| `DATABASE_URL` → Yandex, `sslmode=verify-full`, `sslrootcert=/certs/yandex-ca.pem` | ✓ |
| CA `/certs/yandex-ca.pem` смонтирован в контейнер read-only | ✓ |
| `.env.prod` ровно 6 backend-ключей; `chmod 600`; вне git | ✓ |
| `SUPABASE_JWKS_URL`/`SUPABASE_JWT_ISSUER` = PROD Supabase `ocauafggjrqvopxjihas` (без изменений) | ✓ |
| `CORS_ORIGINS=https://tender.su10.ru`; `PORT=3005`; `DB_MAX_CONNS` numeric | ✓ |
| Migration gates | ✓ `DATA_IMPORT_OK` / `YANDEX_VERIFY_OK` / `YANDEX_AUTH_VERIFY_OK` / `GO_BFF_YANDEX_VERIFY_OK` |

## 2. Go BFF launch (production/new server)

- Образ `hubtender-api:prod` собран на сервере (`docker build`, multi-stage,
  distroless-static, arch `amd64`).
- Запущен через **systemd** `hubtender-bff.service`
  (`enabled; active (running)`, `Restart=always`), контейнер
  `hubtender-bff` на `127.0.0.1:3006 → 3005` (loopback; внешний доступ только
  через nginx, будет добавлен отдельным шагом).
- Логи старта (без секретов): `database pool connected`;
  `listener connection opened`; `connected; listening on channel 'rowchange'`;
  `server listening` (port 3005). **Нет** `x509`/`certificate`/`tls`/`verify`
  ошибок → verify-full к Yandex успешен.

## 3. Health / DB

| Check | Результат |
|---|---|
| `GET /health` | ✓ 200 |
| `GET /health/db` | ✓ 200 (реальный коннект к Yandex) |

## 4. Supabase Auth smoke

| Check | Результат |
|---|---|
| login через PROD Supabase Auth (`grant_type=password`, токен не печатался) | ✓ HTTP 200, `access_token` получен |

## 5. Endpoint smoke (Bearer, на `127.0.0.1:3006`)

| Endpoint | Результат |
|---|---|
| `/api/v1/me` | ✓ 200 |
| `/api/v1/me/permissions` | ✓ 200 |
| `/api/v1/references/roles` | ✓ 200 |
| `/api/v1/references/units` | ✓ 200 |
| `/api/v1/references/material-names` | ✓ 200 |
| `/api/v1/references/work-names` | ✓ 200 |
| `/api/v1/references/cost-categories` | ✓ 200 |
| `/api/v1/references/detail-cost-categories` | ✓ 200 |
| `/api/v1/tenders?limit=5` | ✓ 200 |

## 6. Realtime

- DB-сторона: ✓ `LISTEN/NOTIFY rowchange` на session-mode pooler.
- Backend realtime listener на production: ✓ `connected; listening on channel
  'rowchange'` (из логов контейнера).
- Write-тесты: **не делались** (read-only smoke, как в readiness §6).

## 7. Final status

```
RUNTIME_CUTOVER_OK
```

> Go BFF на production/new сервере работает против **Yandex PostgreSQL**
> (verify-full, session-mode pooler), Supabase JWT валиден, все smoke-эндпоинты
> 200, realtime listener поднят. Bridge-mode подтверждён практически.

## 8. Можно ли переключать домен/proxy на новый сервер

**Технический гейт пройден** (backend↔Yandex зелёный). Но домен/proxy ещё
**НЕ переключены** — это отдельный контролируемый шаг (§9), т.к. требует:

1. **nginx** на `tender.su10.ru`: добавить `location /api/` и WS-upgrade для
   `/api/v1/ws` → `127.0.0.1:3006`, reload (изменение живого домена).
2. **Frontend**: prod-сборка SPA с `VITE_API_URL=https://tender.su10.ru` (same
   origin) + per-domain `VITE_API_*` флаги + публичные Supabase-ключи, деплой в
   `/srv/sites/tender.su10.ru/public`. `VITE_API_URL` бейкается на build —
   текущий бандл (если есть) мог быть собран под другой API. Это решение
   оператора, вне чистого DB-cutover.

До выполнения §9 пользователи на новый стек **не переключены**.

## 9. Remaining controlled steps (operator decision)

| Шаг | Статус |
|---|---|
| nginx `/api/` + `/api/v1/ws` proxy → 127.0.0.1:3006 на `tender.su10.ru` | ☐ OPEN (ждёт «Go» оператора) |
| Frontend prod-build (`VITE_API_URL=https://tender.su10.ru`) + deploy в `public/` | ☐ OPEN (решение/сборка оператора) |
| End-to-end через `https://tender.su10.ru` (browser smoke + WS handshake) | ☐ OPEN |
| Restore points (Yandex + PROD Supabase) перед публичным переключением | ☐ OPEN |
| Назначен rollback owner | ☐ OPEN |

Rollback (если после публичного переключения критичный fail): вернуть
`DATABASE_URL` secret на PROD Supabase → `systemctl restart
hubtender-bff.service` → проверить `/health/db`. До новых writes в Yandex —
откат полный/безопасный; после writes — нужен reconciliation (см. 20 §7).

Auth drift decision в силе: новые регистрации / password reset / смена
email/пароля — запрещены/контролируются до app-auth.

---

> Статус: **Go BFF DB runtime cutover = `RUNTIME_CUTOVER_OK`** (backend на
> Yandex, smoke зелёный, systemd-managed). Домен/proxy/frontend публично НЕ
> переключены — отдельный авторизованный шаг (§9). Import/clean/repair/app-auth
> не трогались; PROD Supabase остаётся rollback-путём и источником Auth.
