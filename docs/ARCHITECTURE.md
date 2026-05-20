# Architecture — TenderHUB by SU_10

Текущая runtime-архитектура после переезда БД на Yandex Managed PostgreSQL
и завершения Phase 5 (frontend Supabase business migration).

## Topology

```
┌─────────────────────────────────────────────────────────────┐
│  React 18 + Ant Design + Vite frontend                      │
│  https://tender.su10.ru                                     │
│                                                             │
│  ├─ Supabase Auth bridge (login → JWT)                      │
│  │   только supabase.auth.* (signInWithPassword, getSession,│
│  │   onAuthStateChange, signOut)                            │
│  │                                                          │
│  └─ Все бизнес-вызовы → fetch('/api/v1/*', Bearer JWT)      │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTPS + Bearer JWT (Supabase ES256)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  nginx (tender.su10.ru)                                     │
│  /api/   →  127.0.0.1:3006     (Go BFF)                     │
│  /api/v1/ws  →  upgrade WebSocket                           │
│  /         →  SPA fallback (index.html)                     │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Go BFF (chi + pgx/v5 + coder/websocket)                    │
│  container `hubtender-bff` (systemd, multi-stage distroless)│
│                                                             │
│  ├─ JWT verify (JWKS auto-refresh)                          │
│  │   SUPABASE_JWKS_URL = ocauafggjrqvopxjihas/.../jwks.json │
│  │   SUPABASE_JWT_ISSUER = ocauafggjrqvopxjihas/.../auth/v1 │
│  │                                                          │
│  ├─ HTTP handlers /api/v1/* (≈111 уникальных путей)         │
│  ├─ Native WS hub (Postgres LISTEN/NOTIFY → topics)         │
│  ├─ pgxpool: session-mode pooler                            │
│  └─ Audit-in-same-tx pattern для BOQ-мутаций                │
└────────────────┬────────────────────────────────────────────┘
                 │ pgx TLS (sslmode=verify-full)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Yandex Managed PostgreSQL 17                               │
│  rc1d-m4ubd0uem0j9gqqc.mdb.yandexcloud.net:6432/HubTender   │
│  sslrootcert: /certs/yandex-ca.pem                          │
│                                                             │
│  ├─ 41 public-таблица (schema из db/yandex/sql/)            │
│  ├─ auth.users + auth.identities (33/33 — для legacy        │
│  │   user_id FK; Supabase Auth не доступен напрямую)        │
│  ├─ Триггеры trg_notify_row_change_* на 6 таблицах          │
│  │   (notifications, boq_items, client_positions,           │
│  │    cost_redistribution_results, construction_cost_volumes│
│  │    tenders)                                              │
│  └─ Audit log: public.boq_items_audit (~408k rows)          │
└─────────────────────────────────────────────────────────────┘
```

## Что где живёт

| Слой | Где | Описание |
|---|---|---|
| Frontend SPA | `src/` | React/Vite, vendor chunks ~ 1.3 MB gzip |
| API client | `src/lib/api/*.ts` | один файл на домен, все вызовы через `apiFetch(/api/v1/...)` |
| Realtime client | `src/lib/realtime/useRealtimeTopic.ts` | подписка на WS-топики Go BFF |
| Supabase Auth bridge | `src/lib/supabase/client.ts` | только auth, **не business** |
| Go BFF entrypoint | `backend/cmd/server/main.go` | DI + chi router |
| Go BFF слои | `backend/internal/{handlers,services,repository}/` | 3-layer |
| Pricing/markup calc | `backend/internal/calc/` | port TS-ядра (юнит-тесты) |
| Yandex schema baseline | `db/yandex/sql/` | 00..90 SQL — текущий applied schema |
| Static deploy | `dist/` → `/srv/sites/tender.su10.ru/public/` | rsync на nginx |
| Production env | `/etc/hubtender/.env.prod` на prod-сервере | `chmod 600`, **вне git** |

## Auth model (bridge mode)

Сейчас:

1. Пользователь логинится через `supabase.auth.signInWithPassword` на
   `https://ocauafggjrqvopxjihas.supabase.co/auth/v1`.
2. Supabase Auth выдаёт ES256 JWT.
3. Frontend кладёт JWT в `Authorization: Bearer …` заголовок для каждого
   `/api/v1/*` запроса.
4. Go BFF валидирует JWT через JWKS того же Supabase issuer.
5. Sub-claim JWT = `auth.users.id` = `public.users.id`.

Следующая Phase 6 (`docs/NEXT_PHASE_APP_AUTH.md`) — выдача JWT собственным
Go BFF, отказ от Supabase Auth.

## Realtime

- Postgres → `LISTEN/NOTIFY` (channel `rowchange`)
- Go BFF слушает + публикует в native WS hub
- Frontend подключается к `/api/v1/ws` (с JWT в query param `?token=`)
- Топики: `notifications:<user_id>`, `tender:<tender_id>`, `tenders`
- Debounce 200 ms на топик, slow clients drop'аются с логом

## Что НЕ используется в runtime

- ❌ `supabase.from()`, `.rpc()`, `.channel()`, `.removeChannel()` — все
  бизнес-вызовы фронта удалены (Phase 5 baseline,
  `archive/migrations/2026-05-db-cutover/docs/yandex-migration/26_FRONTEND_SUPABASE_WRITE_PATHS.md`)
- ❌ Supabase PostgREST `/rest/v1/*` — отсутствует в bundle (verified)
- ❌ Supabase Realtime каналы — заменены WS hub Go BFF
- ❌ Yandex Identity / IAM — не интегрирован, БД через DSN с паролем

## Внешние зависимости (runtime)

| Service | Назначение | Что произойдёт если упадёт |
|---|---|---|
| Yandex Managed PostgreSQL | Source-of-truth БД | Go BFF не сможет читать/писать → 5xx на бизнес-запросы |
| Supabase Auth | JWKS + login flow | Новые login'ы не пройдут; уже выданные JWT работают до exp |
| nginx | TLS termination + reverse proxy | Frontend недоступен извне |
| systemd `hubtender-bff` | Go BFF process supervisor | Авто-перезапуск при крэше |

## См. также

- `docs/RUNTIME_ENV.md` — переменные окружения и где они живут
- `docs/NEXT_PHASE_APP_AUTH.md` — план перехода с Supabase Auth bridge
- `archive/migrations/2026-05-db-cutover/README.md` — миграционная история
- `CLAUDE.md` — гайд для разработки (стек, команды, паттерны)
- `BRANDING.md` — дизайн-система
