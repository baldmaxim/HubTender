# Frontend Deploy Result

> Деплой production-фронта на `tender.su10.ru` (same-origin → Go BFF →
> Yandex; Supabase Auth — источник JWT). Без app-auth, без удаления Supabase
> SDK, без import/clean/repair, без изменения `DATABASE_URL`/БД. Секреты в git
> не попадали (`.env` не коммитился; в репо только плейсхолдеры).

- Дата (UTC): 2026-05-18
- Связано: [19](./19_RUNTIME_CUTOVER_PLAN.md), [20](./20_RUNTIME_CUTOVER_READINESS.md),
  [21](./21_PRODUCTION_ENV_READINESS.md), [23](./23_RUNTIME_CUTOVER_RESULT.md).

## 1. Что сделано (OK)

| Шаг | Результат |
|---|---|
| nginx `tender.su10.ru`: `location /api/` + `/api/v1/ws` → `127.0.0.1:3006` | ✓ (backup конфига сохранён) |
| Proxy-проверка `/api/v1/me` без токена | ✓ 401 + JSON RFC7807 (Go BFF, не SPA-fallback) |
| Сборка фронта (`npm run build`, Vite 5) | ✓ `dist/` собран |
| Деплой `dist/ → /srv/sites/tender.su10.ru/public` (rsync, backup) | ✓ бэкап `public.backup-20260518-000447` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | ✓ корректный anon-ключ вшит (после фикса — первая сборка имела неверный ключ → 401 на login) |
| Supabase Auth login через браузер | ✓ 200, JWT получен |
| WebSocket `wss://tender.su10.ru/api/v1/ws` | ✓ 101 Switching Protocols (Go BFF realtime → Yandex) |

## 2. Критический дефект (критерий приёмки Шаг 6 п.8 — НАРУШЕН)

**Бизнес-данные читаются/пишутся в Supabase pre-prod (`ocauafggjrqvopxjihas`),
НЕ в Yandex через Go BFF.**

Подтверждение (DevTools → Network → Request URL):
```
https://ocauafggjrqvopxjihas.supabase.co/rest/v1/tenders?select=*&id=eq.<uuid>  → 200
```
Аналогично `boq_items?select=…`, `notifications?select=…`, `users?select=…`
(синтаксис `?select=`/`eq.`/`order=` = supabase-js/PostgREST). Запросов
`https://tender.su10.ru/api/v1/*` (кроме `ws`) в Network нет.

### Корень (по анализу кода, не по догадке)

- В `src/pages/` прямой `supabase.from(` — **1 файл** (`PositionItems/hooks/
  useAuditRollback.ts`). Массовых немигрированных страниц нет.
- Основная масса `supabase.from(` — **fallback-ветка внутри `src/lib/api/*`
  хелперов** (`if (isGoEnabled(domain)) apiFetch(...) else supabase...`).
- Деплоенный бандл берёт fallback → значит **`isGoEnabled()` == false в
  production-бандле**.
- `isGoEnabled` (`src/lib/api/featureFlags.ts`) per-domain флаг читает через
  **динамический** `import.meta.env[domainEnvKey(domain)]`. Vite надёжно
  inline-ит только **статические** `import.meta.env.VITE_X`; значения,
  переданные через shell-export (`set -a; . envfile; set +a`), в **динамический**
  доступ прод-бандла не попадают. Статически читаемые
  `VITE_SUPABASE_URL/KEY`, `VITE_API_URL`, `VITE_API_REALTIME_ENABLED`
  сработали (login + WS живы) — поэтому дефект селективный.
- Итог: Go-роутинг для доменных хелперов не включился → весь бизнес-трафик
  ушёл в Supabase-fallback.

### Риск

Записи через текущий фронт идут в Supabase Postgres, не в Yandex →
расхождение Yandex↔Supabase (тот же класс риска, что 20 §1 / §7). «Работает»
лишь потому, что в Supabase pre-prod данные ещё есть.

## 3. Final status

```
FRONTEND_DEPLOY_FAILED_ROLLED_BACK
```

Backend не затронут: `23_RUNTIME_CUTOVER_RESULT.md = RUNTIME_CUTOVER_OK` в силе
(Go BFF ↔ Yandex рабочий; nginx-proxy и Auth/WS-путь корректны). БД / Yandex /
`DATABASE_URL` / import / clean / repair / Supabase Auth — **не трогались**.

## 4. Rollback (выполнен)

**Хронология бэкапов (важно — выбор цели отката):**
- `public.backup-20260517-235047` — снят **перед первым деплоем** =
  исходный статический плейсхолдер (`<title>tender.su10.ru</title>`, без
  `assets/`). ✅ **корректная цель отката**.
- `public.backup-20260518-000447` — снят перед вторым деплоем, когда в
  `public` уже лежала первая неудачная сборка (неверный ключ). ❌ не
  использован (вернул бы сломанный фронт, а не исходное состояние).

Выполнено (только статика; БД/backend/`DATABASE_URL` не трогались):
```
rsync -a --delete /srv/sites/tender.su10.ru/public.backup-20260517-235047/ \
  /srv/sites/tender.su10.ru/public/
```
Проверка после отката:
```
curl -sI https://tender.su10.ru | head -n1   → HTTP/1.1 200 OK
curl -s  https://tender.su10.ru/ | head      → исходный плейсхолдер
ls .../public/assets                          → пусто (React-бандл снят)
```
nginx reload не требовался (docroot тот же). Go BFF оставлен running и
корректен; после отката статики на него ничего не указывает (новый фронт не
публичен). nginx-proxy `/api/` оставлен (безвреден — плейсхолдер `/api` не
зовёт); при желании откатывается из `tender.su10.ru.bak.*`.

Резюме по неприкосновенному: rollback затронул **только** статику
`tender.su10.ru/public`. БД не трогалась; backend Go BFF на Yandex не
трогался; `DATABASE_URL` не менялся; Yandex/Supabase Auth не трогались.

## 5. Правильный фикс (вне server-итераций, отдельный авторизованный этап)

1. Передавать build-env через **реальный `.env.production`-файл** в каталоге
   сборки (Vite `loadEnv` кладёт его и в динамический `import.meta.env`),
   а не через shell-export. `.env` — НЕ в git; добавляет оператор.
2. Либо `VITE_API_MODE=go` гарантированно статически (проверить inline в
   бандле), т.к. `isGoEnabled` fallback = `API_MODE === 'go'`.
3. Пересборка → проверка в бандле, что доменные вызовы идут на
   `https://tender.su10.ru/api/v1/*`, а не `*.supabase.co/rest/v1/*`.
4. Повторить browser-smoke §6 (вкл. п.8: ноль business-PostgREST).
5. Отдельно: `users?select=…` из AuthContext — это bridge-Auth-путь
   (профиль из Supabase); решить, допускается ли он в критерии (auth vs
   business) или тоже переводится на Go.

---

> Статус: фронт поднят, login/WS через Go/Yandex работают, **но бизнес-данные
> идут в Supabase, не в Yandex** (критерий §6.8 нарушен) →
> `FRONTEND_DEPLOY_FAILED`. БД/import/repair/app-auth не трогались; backend
> cutover (`RUNTIME_CUTOVER_OK`) в силе; rollback статики готов (§4).
