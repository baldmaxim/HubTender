# CLAUDE.md

Этот файл — инструкция для Claude Code (claude.ai/code) при работе с кодом в этом репозитории.

## Обзор проекта

TenderHUB by SU_10 — портал управления тендерами в строительстве для BOQ (Bill of Quantities, ведомости объёмов работ) и биржевых процессов.

- **Языковые конвенции**: русский UI, английский код, русские сообщения коммитов
- **Стек**: React 18 + Ant Design + Vite + TypeScript на фронте. Go BFF (chi + pgx/v5 + coder/websocket) перед Supabase (Postgres 17 + Auth + JWKS). Supabase Realtime постепенно вытесняется WebSocket-хабом Go BFF.
- **Брендинг**: дизайн-система описана в BRANDING.md
- **Состояние миграции**: pre-prod Supabase-проект `ocauafggjrqvopxjihas`; старый live-prod `wkywhjljrhewfpedbjzx` в режиме read-only до финального cutover. Полный план — в `C:\Users\Usrr\.claude\plans\keen-toasting-iverson.md`.

## Команды разработки

```bash
npm install          # установить зависимости
npm run dev          # dev-сервер (http://localhost:5185, автоматически откроется)
npm run build        # TypeScript-проверка + production-сборка Vite
npm run lint         # ESLint в режиме zero-warning (max-warnings: 0)
npm run preview      # превью production-сборки
npm run gen:types    # перегенерировать src/lib/supabase/database.types.ts из pre-prod
npm run gen:schema   # обновить supabase/schemas/prod.sql

# База данных (MCP-first — см. план по использованию Supabase MCP; CLI — запасной вариант):
supabase db push                # применить миграции через CLI
supabase migration new <name>   # создать шаблон новой миграции
# Предпочтительно: mcp__claude_ai_Supabase__apply_migration(ocauafggjrqvopxjihas, ...)

# Go BFF (сборка в Docker, Go локально не нужен):
docker build -t hubtender-api:local ./backend
docker run --rm --env-file .env -p 3005:3005 hubtender-api:local
curl http://localhost:3005/health     # liveness
curl http://localhost:3005/health/db  # readiness + пинг БД
docker compose up --build             # полный локальный стек: api + redis + caddy

# Юнит-тесты бэка (сейчас покрыт только backend/internal/calc/):
(cd backend && go test ./...)

# Скрипты верификации:
node scripts/smoke/go-bff.mjs                 # прогон всех Go read-эндпоинтов
node scripts/dual-run/positions-with-costs.mjs <tender-id>  # diff RPC vs Go

# Переменные окружения: скопировать .env.example → .env и заполнить креды.
# Supabase free-tier: использовать Session Pooler (порт 5432, aws-0-<region>.pooler.supabase.com),
# потому что прямой хост db.<ref>.supabase.co отдаёт только IPv6.
```

## Критические правила

### База как единственный источник истины
`supabase/schemas/prod.sql` — каноничная схема. ВСЕГДА сверяйся с ней перед любой работой с БД. НИКОГДА не доверяй TypeScript-типам больше, чем определениям из prod.sql. Бизнес-таблицы — в `supabase/migrations/`.

### Секреты не должны начинаться с VITE_
Vite инлайнит каждую `VITE_*`-переменную в клиентский бандл. НИКОГДА не добавляй префикс `VITE_` к секрету:
- ✅ `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (anon-ключ публичен по дизайну)
- ❌ `VITE_SUPABASE_SERVICE_ROLE_KEY`, `VITE_DATABASE_URL`, любой JWT-ключ подписи, пароль БД
- Серверные переменные (dev-скрипты в `scripts/`, Go-бэкенд) используют обычные имена: `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` и т.д.
- Шаблон — в `.env.example`.

### Лимит на размер файла
**СТРОГО**: все файлы должны быть ≤ 600 строк. Разбивай на `components/`, `hooks/`, `utils/`, `types.ts` по необходимости.

### Git-конвенции
- **Коммиты**: русский, повелительное наклонение (например, «Добавить валидацию форм», «Исправить ошибку в расчётах»)
- **Ветки**: префиксы `feature/`, `fix/`, `refactor/`

## Архитектура

### Иерархия провайдеров (App.tsx)
```
ThemeProvider → AuthProvider → ConfigProvider (Ant Design) → AntApp → Routes
```

### Структура роутинга
Все аутентифицированные маршруты обёрнуты в `<ProtectedRoute>` внутри `<MainLayout>`. Маршруты определены в `src/App.tsx`. Публичные маршруты: `/login`, `/register`, `/forgot-password`, `/reset-password`. Боковое меню в MainLayout фильтруется через `hasPageAccess()` по полю `allowed_pages` пользователя.

### Аутентификация и контроль доступа
- **AuthContext** (`src/contexts/AuthContext.tsx`): хук `useAuth()` даёт `user`, `loading`, `signOut`, `refreshUser`
- **Поток авторизации**: Supabase Auth (email/пароль) → загрузка пользователя из `public.users` → загрузка роли из `public.roles`
- **Система ролей**: таблица `roles` содержит `code`, `name`, `color`. Пользователь ссылается на `role_code`. Роли: `administrator`, `developer`, `director`, `senior_group`, `engineer`, `general_director`
- **Доступ к страницам**: `users.allowed_pages` (JSONB-массив; пустой = полный доступ). Проверка через `hasPageAccess(user, path)` из `src/lib/supabase/types.ts`
- **Хелперы контроля доступа**: `canManageUsers()`, `isAdmin()`, `isLeader()`, `hasPageAccess()` — все в `src/lib/supabase/types.ts`

### Система тем
- **ThemeContext** (`src/contexts/ThemeContext.tsx`): `useTheme()` отдаёт `theme` (`'light'`|`'dark'`) и `toggleTheme()`
- **Хранение**: ключ localStorage `tenderHub_theme`, по умолчанию dark
- **Цвета**: основной `#10b981` (emerald), настраивается в App.tsx через ConfigProvider
- **Ant Design**: используется `theme.darkAlgorithm` / `theme.defaultAlgorithm`

### Управление состоянием
- Ни Redux, ни Zustand — только React-контексты (Theme, Auth) и локальный state
- Серверное состояние — через хелперы Go BFF (предпочтительно) или прямые вызовы Supabase (легаси)
- Формы — на компонентах Ant Design Form

## Ключевые паттерны работы с данными

### Клиент Supabase (легаси-путь чтения)
```typescript
import { supabase } from '../lib/supabase';
import type { Tender } from '../lib/supabase/types';
```

### Слой API через Go BFF
Весь новый код чтения/записи идёт через хелперы в `src/lib/api/`, которые прозрачно маршрутизируют к Go BFF при включённом feature-флаге и откатываются на Supabase иначе. Никогда не добавляй новый `supabase.from()` в новом компоненте — добавляй хелпер.

Доменные хелперы (каждый экспортирует обычные async-функции):
- `src/lib/api/client.ts` — низкоуровневый `apiFetch<T>(path, opts)` с Supabase JWT
- `src/lib/api/featureFlags.ts` — `isGoEnabled(domain)` и `isRealtimeEnabled()`
- `src/lib/api/tenders.ts` — `fetchTenders`, `fetchTendersByIds`
- `src/lib/api/positions.ts` — `fetchPositionsWithCosts`
- `src/lib/api/boq.ts` — `bulkUpdateCommercial`
- `src/lib/api/users.ts` — `registerUser`
- `src/lib/api/timeline.ts` — `setTenderGroupQuality`, `respondTenderIteration`
- `src/lib/api/hooks/useApiReferences.ts` — 6 read-only хуков для справочников

По-доменные env-флаги по умолчанию выключены (идём прямо в Supabase). `.env.example` — каноничный список: сейчас 13 тумблеров, по одному на домен (references, tenders, positions, boq, markup, commerce, costs, fi, timeline, projects, notifications, users, realtime). Глобальный оверрайд: `VITE_API_MODE=supabase|go|hybrid`.

### Realtime (WebSocket-хаб)
Go BFF гоняет Postgres `LISTEN/NOTIFY` → WebSocket-брокер (дебаунс 200 мс на топик). Фронтовый хук: `src/lib/realtime/useRealtimeTopic(topic, handler)` возвращает `true`, когда активен нативный хаб, и `false`, когда идёт откат на `supabase.channel()`. Топики: `notifications:<user_id>`, `tender:<tender_id>`, `tenders`. Изменения в `boq_items`, `client_positions`, `cost_redistribution_results` и `construction_cost_volumes` веером расходятся в соответствующий `tender:<id>`; `tenders` рассылается наряду с per-tender-топиком при тендер-левел изменениях. Публикации неблокирующие — медленные клиенты дропаются, когда у них заполняется send-буфер (с логом). Слушатель pg авто-переподключается с экспоненциальным backoff (500 мс → 30 с).

Существующие call-site'ы `supabase.channel()` огорожены feature-флагом: при `VITE_API_REALTIME_ENABLED=true` Supabase-подписка пропускается.

### Audit-лог (BOQ Items) — легаси
Легаси-обёртки RPC живут в `src/lib/supabaseWithAudit.ts`:
- `insertBoqItemWithAudit`, `updateBoqItemWithAudit`, `deleteBoqItemWithAudit`.
Старый `executeWithAudit()` — deprecated, не использовать.

В Go BFF audit-строки пишутся в той же `pgx.Tx`, что и мутация (см. `backend/internal/repository/boq_mutate.go`). Phase 5 переведёт фронтовые пути записи на Go-эндпоинты (`POST/PATCH/DELETE /api/v1/items/*`).

### Конвенции БД
- UUID-первичные ключи через `uuid_generate_v4()`
- Timestamps `created_at`/`updated_at` с автоматическими триггерами
- `created_by` — FK на `auth.users.id`
- RLS-политики на всех таблицах

## Ключевые таблицы БД

- `users` — учётки с `role_code`, `access_status`, `allowed_pages`, `access_enabled`
- `roles` — определения ролей с `code`, `name`, `color`, `allowed_pages`
- `tenders` — основные записи тендеров с курсами валют, `housing_class`, `construction_scope`
- `tender_registry` — листинг тендеров с хронологией, статусами, архивацией
- `material_names`, `work_names` — библиотеки названий с единицами измерения
- `materials_library`, `works_library` — полные определения материалов/работ с расценками
- `client_positions` — BOQ-позиции по тендеру
- `boq_items` — детальные BOQ-элементы (материалы и работы) по позициям
- `templates`, `template_items` — переиспользуемые BOQ-шаблоны
- `cost_categories`, `detail_cost_categories` — иерархия структуры затрат
- `construction_cost_volumes` — объёмы по тендеру по детальной категории
- `markup_tactics` — стратегии ценообразования с последовательностями (JSONB)
- `markup_parameters`, `tender_markup_percentages` — конфиг наценок по тендеру
- `tender_pricing_distribution` — как затраты распределяются по столбцам материалов/работ
- `tasks` (`user_tasks`) — управление задачами, связанными с пользователями и тендерами
- `notifications` — системные уведомления с real-time подписками
- `audit_log` — журнал изменений
- **ENUM'ы**: `unit_type`, `material_type`, `boq_item_type`, `currency_type`, `housing_class_type`, `construction_scope_type`, `access_status_type`

## Система типов

Типы централизованы в `src/lib/supabase/`:
- `types.ts` — все типы сущностей, enum'ы, константы ролей, хелперы доступа к страницам, функции-мапперы
- `types/tasks.ts` — типы, связанные с задачами
- `index.ts` — бочковый реэкспорт клиента и всех типов

Конвенция именования: `FooInsert` (для создания), `Foo` (полная сущность), `FooFull` (с данными JOIN).

Ключевые маппед-типы:
- `BoqItemType` = `'мат' | 'суб-мат' | 'мат-комп.' | 'раб' | 'суб-раб' | 'раб-комп.'`
- `TabKey` ↔ `BoqItemType` — маппинги через `TAB_TO_BOQ_TYPE` и `BOQ_TYPE_TO_TAB`
- `MarkupStep` — сложная структура формул для расчётов цен (до 5 связанных операций)

## Организация файлов

Страницы следуют этой структуре:
```
src/pages/PageName/
├── PageName.tsx           # главный компонент
├── components/            # компоненты, специфичные для страницы, с index.ts-бочкой
├── hooks/                 # кастомные хуки (usePageLogic, useDataFetching и т.п.)
├── utils/                 # хелперы
└── types.ts               # типы, специфичные для страницы
```

Общий код:
- `src/components/` — переиспользуемые компоненты (Auth, Icons, Layout)
- `src/contexts/` — React-контексты (AuthContext, ThemeContext)
- `src/lib/api/` — **хелперы Go BFF (новый путь)**, один файл на домен
- `src/lib/realtime/` — низкоуровневый `ws.ts`-клиент + React-хук `useRealtimeTopic`
- `src/lib/supabase/` — Supabase-клиент, типы, бочковые реэкспорты (легаси/фолбэк)
- `src/lib/supabaseWithAudit.ts` — audited CRUD-обёртки (deprecated)
- `src/services/` — кросс-страничные сервисы (cost import, markup tactics). Логика расчётов Phase 5 всё ещё живёт здесь на TS-стороне, пока `backend/internal/calc/` не подключён к хендлерам.
- `src/utils/` — общие хелперы, разбитые по подмодулям `boq/`, `excel/`, `matching/`, `versionTransfer/`
- `scripts/` — Node dev-утилиты. `smoke/` и `dual-run/` — поддерживаемые harness'ы верификации; остальные `check-*.cjs` / `fix-*.cjs` — ad-hoc DBA-инструменты, не часть стандартного workflow.

Код бэкенда (Go BFF):
- `backend/cmd/server/main.go` — точка входа c DI-проводкой
- `backend/internal/{handlers,services,repository}/` — стандартная трёхслойка
- `backend/internal/realtime/` — pg LISTEN → брокер → WS-хаб
- `backend/internal/middleware/auth.go` — `JWTAuth` + экспортированный `VerifyToken`
- `backend/internal/calc/` — Phase 5 порт TS-ядра ценообразования (markupCalculator, smartRounding, calculateBoqAmount, calculateGrandTotal, applyPricingDistribution, calculateRedistribution). Каждое ядро покрыто юнит-тестами. **Пока не подключено к хендлерам** — пути записи по-прежнему зовут TypeScript-реализации в `src/services/` и `src/utils/boq/`.
- `backend/internal/config/` — загрузчик env / CORS / log-level
- `backend/internal/cache/` — абстракция in-memory кэша
- `backend/internal/access/` — реестр контроля доступа
- `backend/internal/domain/` — чистые доменные модели (сейчас только `user/`)
- `backend/internal/infrastructure/db/` — управление pgx-пулом
- `backend/pkg/apierr/` — RFC 7807 ProblemDetail-хелперы
- `backend/Dockerfile` — multi-stage, distroless-static runtime (CGO off, Go 1.23)
- `docker-compose.yml` — `api + redis + caddy` (Redis зарезервирован под Phase 4b)

## Ключевые доменные концепции

### Иерархия BOQ
Tenders → Client Positions → BOQ Items (материалы и работы по позициям)

### Типы элементов
- Материалы: `мат` (базовый), `суб-мат` (субподряд), `мат-комп.` (компонент)
- Работы: `раб` (базовая), `суб-раб` (субподряд), `раб-комп.` (компонент)
- `material_type`: `основн.` (основной) или `вспомогат.` (вспомогательный)

### Поток расчёта затрат
1. Детальные категории затрат задают структуру стоимости по локациям
2. Markup-тактики задают последовательности формул на тип элемента
3. Проценты наценок настраиваются по тендеру на каждый параметр
4. Pricing distribution управляет, в какой столбец (материалы/работы) падают затраты
5. Cost redistribution перебрасывает суммы между категориями

### Импорт/экспорт Excel
- `xlsx` для чтения, `xlsx-js-style` для записи с форматированием
- Используется в: тендерах (импорт BOQ), номенклатурах (bulk-импорт), библиотеке (экспорт)

## Типовые процессы

### Добавление новой страницы
1. Создать `src/pages/PageName/PageName.tsx`
2. Добавить маршрут в `src/App.tsx` под ProtectedRoute-лейаут
3. Добавить пункт меню в массив menuItems `MainLayout.tsx`
4. Добавить путь страницы в `ALL_PAGES` и `PAGE_LABELS` в `src/lib/supabase/types.ts`
5. Добавить типы в `src/lib/supabase/types.ts`, если используются новые таблицы

### Создание новой таблицы БД
1. `supabase migration new table_name`
2. Написать SQL с UUID PK, timestamps, FK `created_by`, RLS-политиками
3. Применить через MCP `apply_migration(ocauafggjrqvopxjihas, ...)` (предпочтительно) или `supabase db push`
4. `npm run gen:types` — перегенерирует `src/lib/supabase/database.types.ts`
5. `npm run gen:schema` — освежает `supabase/schemas/prod.sql`

### Добавление эндпоинта Go BFF
1. Создать repo-метод в `backend/internal/repository/<domain>.go` (row-структура + запрос).
2. Тонкий сервис в `backend/internal/services/<domain>.go` (инвалидация кэша — здесь).
3. Хендлер в `backend/internal/handlers/<domain>.go` — конверт `{data: ...}`, ETag, RFC 7807-ошибки через `pkg/apierr`.
4. Прописать repo/service/handler в `backend/cmd/server/main.go` и зарегистрировать маршрут внутри `r.Group(authMW)` (если не публичный как `/health`).
5. Добавить парный хелпер в `src/lib/api/<domain>.ts` с веткой Go/Supabase: `if (isGoEnabled('<domain>')) { return apiFetch(...) } else { return supabase... }`.
6. Добавить запись в `scripts/smoke/go-bff.mjs`, чтобы покрыть новый эндпоинт.
7. Пересобрать образ: `docker build -t hubtender-api:local ./backend`.

## Тестирование

Текущая поверхность верификации тонкая — знай, что есть, а чего нет:

- **Юнит-тесты фронта**: нет. Vitest/Jest не настроены, в `src/` нет `*.test.ts`.
- **Playwright E2E**: есть каркас в `tests/` + `playwright.config.ts` (конфиг `webServer` слушает порт **5185** — тот же, что и dev-сервер). Но `@playwright/test` **не** в `devDependencies`, и в `package.json` нет скрипта `test`, так что `npm test` сейчас падает. Инструкция `npm test` в README.md — аспирационная; до того как полагаться на неё, надо прописать скрипт + зависимость.
- **Go-бэкенд**: `go test ./...` в `backend/` проходит. Осмысленное покрытие только у `backend/internal/calc/` — пакеты repository/handler не протестированы.
- **End-to-end верификация сегодня** идёт через Node-скрипты: `node scripts/smoke/go-bff.mjs` бьёт по каждому Go read-эндпоинту; `node scripts/dual-run/positions-with-costs.mjs <tender-id>` сравнивает результат Supabase RPC и Go-реализации.
- **CI нет**: ни `.github/workflows/`, ни pre-commit-хуков, ни lint-staged. Валидация — ручная: `npm run lint`, `npm run build`, `go test ./...` и smoke-harness перед выкаткой нетривиальных изменений.

## Технологический стек

Основные зависимости — в `package.json`. Заметные библиотеки:
- **UI**: `antd` + `@ant-design/icons` + `@ant-design/charts`
- **Графики**: `chart.js` + `react-chartjs-2` + `chartjs-plugin-datalabels`
- **Excel**: `xlsx` (чтение) + `xlsx-js-style` (запись со стилями)
- **Drag & Drop**: `@dnd-kit/core` + `@dnd-kit/sortable`
- **Даты**: `dayjs`
- **Роутинг**: `react-router-dom` v7
- **TypeScript**: strict-режим выключен, target ES2020

## Адаптивность (обязательно)

Все UI компоненты адаптированы под:
- **iPhone 15 Pro Max** (430 × 932 px)
- **iPhone 12** (390 × 844 px)
- **iPad** (768 × 1024 px и больше)

CSS media queries для всех целевых устройств.

## КРАТКОСТЬ

- Отвечай максимально сжато. Без пояснений и предисловий.
- Код — только рабочие фрагменты в блоках, без текста.
- Изменения — *минимальный diff/patch* или *конкретные вставки*.
- Не перечисляй «что было сделано», если не попросили.
- Текст — не более 5 пунктов, каждый ≤ 12 слов.

## .env

- НИКОГДА не изменять `.env` файлы
- Ключи и URL добавляет только пользователь вручную

## Git

- Коммиты на русском, кратко (1-2 предложения)
- Без приписок "Generated with Claude Code" и "Co-Authored-By"
