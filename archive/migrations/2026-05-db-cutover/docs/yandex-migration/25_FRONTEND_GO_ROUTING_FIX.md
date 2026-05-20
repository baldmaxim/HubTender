# Frontend Go-Routing Fix (offline)

> Оффлайн-разбор: почему production-бандл ходил за бизнес-данными в Supabase
> pre-prod вместо Go BFF → Yandex, и проверенный фикс build-конфига.
> **Ничего не задеплоено, не запушено. БД/backend/`DATABASE_URL`/import/
> clean/repair/Supabase Auth — не трогались.** Секретов в git нет (только
> плейсхолдеры/публичные значения).

- Дата (UTC): 2026-05-18
- Связано: [24](./24_FRONTEND_DEPLOY_RESULT.md) (`FRONTEND_DEPLOY_FAILED_ROLLED_BACK`),
  [23](./23_RUNTIME_CUTOVER_RESULT.md) (`RUNTIME_CUTOVER_OK`).

## 1. Root cause (доказан эмпирически)

`src/lib/api/featureFlags.ts`:
```ts
const API_MODE = (import.meta.env.VITE_API_MODE ?? 'supabase') as ...;
export function isGoEnabled(domain) {
  const envVal = import.meta.env[domainEnvKey(domain)];   // ДИНАМИЧЕСКИЙ ключ
  if (envVal !== undefined) return envVal === 'true';
  return API_MODE === 'go';
}
```
- Хелперы `src/lib/api/*` устроены как `if (isGoEnabled(d)) apiFetch('/api/v1/...')
  else supabase.from(...)`. В прод-бандле обе ветки присутствуют как код —
  фактический маршрут решает рантайм-значение `isGoEnabled()`.
- Серверная сборка передавала env через **shell-export** (`export ...` /
  `set -a; . /root/fe-build.env; set +a`). Vite надёжно inline-ит
  **статические** `import.meta.env.VITE_X` (поэтому
  `VITE_SUPABASE_URL/KEY`, `VITE_API_URL`, `VITE_API_REALTIME_ENABLED`
  сработали → login и WS жили). Но per-domain флаг читается
  **динамически** `import.meta.env[`VITE_API_${D}_ENABLED`]` — он берётся из
  инлайн-объекта `import.meta.env`, который при shell-only передаче в
  итоговый бандл не попал → `envVal=undefined` для всех доменов, а
  `API_MODE` в той сборке не дал `'go'` → `isGoEnabled()=false` для всех →
  каждый хелпер ушёл в Supabase-fallback.
- Усугубляющий фактор: SSH-сессия на сервере была нестабильна (env-
  переменные неоднократно пропадали между командами — `SB_ANON`/`SB_EMAIL`
  обнулялись), т.е. shell-env мог не дойти до процесса `npm run build`.

### Эмпирическое подтверждение фикса

Локальная prod-сборка с **файлом** `.env.production` (Vite 5.4.21,
`npx vite build`, изолированный `dist_verify`, dummy anon-ключ — на
маршрутизацию не влияет). В app-чанке `assets/index-*.js` инлайн-объект
`import.meta.env` содержит:
```
VITE_API_MODE:"go"
VITE_API_FI_ENABLED:"true"
VITE_API_TENDERS_ENABLED:"true"
… все 18 VITE_API_*_ENABLED:"true" + VITE_API_REALTIME_ENABLED:"true"
VITE_SUPABASE_URL:"https://ocauafggjrqvopxjihas.supabase.co"
```
Значит при рантайме `import.meta.env['VITE_API_FI_ENABLED'] === 'true'` →
`isGoEnabled('fi')=true` → `getTenderById` зовёт
`apiFetch('/api/v1/tenders/{id}')` (а не `supabase.from('tenders')…eq('id')`,
который и давал `supabase.co/rest/v1/tenders?select=*&id=eq.<uuid>`). То же
для всех 18 доменов. `/api/v1/*` — присутствует в app-чанке. `rest/v1`
встречается 1× только в `vendor-supabase` — это константа библиотеки
supabase-js (Auth-клиент), не бизнес-вызовы.

**Вывод:** причина — механизм передачи env (shell vs файл), НЕ кодовая база.
Канонический детерминированный способ (его же документирует `.env.example`:
«Copy to .env or .env.local») — **файл `.env.production`**.

## 2. Нужные production env-переменные (из кода)

| Переменная | Откуда | Значение |
|---|---|---|
| `VITE_SUPABASE_URL` | `src/lib/supabase/client.ts:3` (static) | `https://ocauafggjrqvopxjihas.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `client.ts:4` (static, **не** `_ANON_KEY`) | anon/publishable (public-by-design) |
| `VITE_API_URL` | `featureFlags.ts:38` (static, **не** `_BASE_URL`; в prod обязателен) | `https://tender.su10.ru` |
| `VITE_API_MODE` | `featureFlags.ts:25` (static) | `go` |
| `VITE_API_REALTIME_ENABLED` | `featureFlags.ts:50` (static) | `true` |
| `VITE_API_<DOMAIN>_ENABLED` ×18 | `featureFlags.ts:27-34` (**динамический**) | `true` — **ОБЯЗАТЕЛЬНО в .env-файле** |

18 доменов: references, tenders, positions, boq, timeline, users,
redistributions, insurance, positionFilters, notifications, tenderRegistry,
costs, nomenclatures, importLog, projects, userAdmin, markup, fi.

## 3. Почему shell-export/per-domain не сработали — кратко

- Static `import.meta.env.VITE_X` → inline из любого источника (shell ок).
- Dynamic `import.meta.env[ключ]` → только из инлайн-объекта, который
  детерминированно наполняется из **`.env`-файлов** (`loadEnv`), не из
  ad-hoc shell в нестабильной сессии. Фикс — `.env.production` файл.

## 4. Какой `.env.production` нужен

Шаблон-деливерабл: **`.env.production.yandex.example`** (в корне репо;
добавлен в `.gitignore` whitelist рядом с прочими `.example`). Применение:
```
cp .env.production.yandex.example .env.production   # .env.production gitignored
# вписать реальный VITE_SUPABASE_PUBLISHABLE_KEY (anon)
npm run build                                       # Vite авто-грузит .env.production
```
Все 18 `VITE_API_*_ENABLED=true` + `VITE_API_MODE=go` +
`VITE_API_REALTIME_ENABLED=true` + `VITE_API_URL=https://tender.su10.ru` +
`VITE_SUPABASE_URL` + ключ. **Не** через `export`/`set -a`.

## 5. Допустимые Supabase-вызовы (временно, bridge)

- **`supabase.auth.*` только** — login/JWT/`getSession` (`src/lib/api/
  client.ts` берёт Bearer из `supabase.auth.getSession()`); `AuthContext`
  auth-поток. Сеть на `*.supabase.co/auth/v1/*` — допустима.

## 6. Недопустимые Supabase-вызовы (бизнес-данные)

`supabase.from` / `supabase.rpc` / `supabase.channel` для бизнес-данных →
должны идти через Go BFF. С `.env.production` (флаги=true) **gated-хелперы
`src/lib/api/*`** уходят в Go (проверено §1). `supabase.channel()` закрыт
`isRealtimeEnabled()` → при `VITE_API_REALTIME_ENABLED=true` используется
Go WS-хаб (`wss://tender.su10.ru/api/v1/ws`, ранее 101 OK).

### ⚠️ Остаточные НЕ-gated прямые вызовы (env-фикс их НЕ покрывает)

Эти callsites зовут Supabase напрямую вне `isGoEnabled()` — останутся на
Supabase даже с верным `.env.production`; требуют миграции кода (Phase 5,
вне scope env-фикса):

| Файл | Вызов | Тип |
|---|---|---|
| `src/hooks/useTenderNotes.ts:48` | `from('users').select…in(id)` | read |
| `src/utils/versionTransfer/createNewVersion.ts:128` | `from('tenders').delete()` | **write** |
| `src/utils/versionTransfer/executeVersionTransfer.ts:42` | `rpc('execute_version_transfer')` | **write** |
| `src/utils/versionTransfer/cloneTenderAsNewVersion.ts:21` | `rpc('clone_tender_as_new_version')` | **write** |
| `src/pages/PositionItems/hooks/useAuditRollback.ts:38` | `from('boq_items').insert()` | **write** |
| `src/pages/ClientPositions/hooks/useMassBoqImport.ts:411` | `rpc('bulk_import_client_position_boq')` | **write** |
| `src/lib/supabaseWithAudit.ts` (deprecated) | `rpc(*_boq_item_with_audit)` | **write** |
| `src/utils/checkDatabaseStructure.ts:134` | `rpc('check_rls_status')` | diag (dev) |

→ До их миграции: version transfer / mass BOQ import / audit-rollback /
deprecated audit-wrappers всё ещё пишут в Supabase → точечный риск
расхождения. Эти операции **операционно избегать** до Phase 5 или
мигрировать на Go-эндпоинты.

## 7. Build result

- `npx vite build` (Vite 5.4.21, mode=production, `.env.production` файл) →
  `✓ built in ~53s`, app-чанк `assets/index-*.js` (~1.1 MB), без ошибок
  (те же informational warnings: eval в MainLayout, dynamic/static import
  markup/notifications, chunk>800kB — не блокеры; идентичны серверной).
- Изолированный `dist_verify` + временный `.env.production` **удалены**
  (build воспроизводим из шаблона; untracked-мусор/эфемерный env не оставлен).

## 8. Bundle verification result

| Проверка | Результат |
|---|---|
| `VITE_API_MODE` в app-чанке | ✓ `:"go"` |
| Все 18 `VITE_API_*_ENABLED` в app-чанке | ✓ `:"true"` (FI/TENDERS/BOQ/… подтверждены) |
| `VITE_API_REALTIME_ENABLED` | ✓ `:"true"` |
| `VITE_SUPABASE_URL` | ✓ pre-prod project (Auth) |
| `/api/v1/*` (tenders/me/ws) в app-чанке | ✓ присутствует (7×) |
| `rest/v1` | только 1× в `vendor-supabase` (lib-константа, не бизнес) |
| Критерий: бизнес-домены `isGoEnabled→true` | ✓ (динамический lookup резолвится из .env-файла) |

Статический grep минифицированного бандла не исполняет рантайм, но значения
инлайн-`import.meta.env` (`VITE_API_*_ENABLED:"true"`, `VITE_API_MODE:"go"`)
вместе с логикой `isGoEnabled` логически гарантируют Go-маршрут для всех 18
gated-доменов.

## 9. Final status

```
FRONTEND_GO_ROUTING_BUILD_OK
```

Build-конфиг исправлен и **проверен оффлайн**: с `.env.production`-файлом
gated-бизнес-домены маршрутизируются в Go BFF → Yandex; Supabase остаётся
только Auth. **НЕ деплоить без отдельного подтверждения.**

Остаётся (вне этого env-фикса): миграция 7 не-gated прямых Supabase-
callsites (§6) на Go — иначе version transfer / mass import / audit-rollback
пишут мимо Yandex.

## 10. Готовность к повторному frontend deploy

Предусловия повторного деплоя (отдельный авторизованный шаг):
1. На сервере: `cp .env.production.yandex.example .env.production`, вписать
   реальный anon-ключ (тем же значением, что дал `HTTP 200` в Supabase Auth
   smoke). **Файл**, не `export`.
2. `npm run build` (Vite сам подхватит `.env.production`).
3. Bundle-проверка перед деплоем: `grep -o 'VITE_API_MODE:"[a-z]*"'` и
   `VITE_API_TENDERS_ENABLED:"true"` присутствуют в `dist/assets/index-*.js`.
4. Деплой `dist/ → /srv/sites/tender.su10.ru/public` (бэкап
   `public.backup-*`), nginx уже проксирует `/api/` + `/api/v1/ws`.
5. Browser-smoke §6 doc 23/24: `/api/v1/*` идут на `tender.su10.ru`,
   **ноль** business `*.supabase.co/rest/v1`; учесть §6-остаток (не-gated
   операции) — не выполнять version transfer / mass import до Phase 5.
6. Решить судьбу §6-остатка (миграция на Go) до активного использования.

---

> Статус: `FRONTEND_GO_ROUTING_BUILD_OK` — root cause (shell-env vs
> .env-файл + динамический `import.meta.env`) найден и фикс проверен
> локальной сборкой; deliverable `.env.production.yandex.example` создан.
> Ничего не задеплоено/не запушено; БД/backend/Yandex/Supabase Auth не
> трогались. Остаток (7 не-gated callsites) задокументирован для Phase 5.
