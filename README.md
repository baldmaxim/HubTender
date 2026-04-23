# HUBTender

Портал управления тендерами в строительстве (BOQ + биржа работ).
Фронт — React + Vite + Ant Design. Бэк — Go BFF (chi + pgx) перед Supabase
(Postgres 17 + Auth + Realtime). Подробнее о конвенциях, ENV и рабочем
процессе — в [CLAUDE.md](CLAUDE.md).

> **Первый раз поднимаете проект локально?** → [ЗАПУСК.md](ЗАПУСК.md) — пошаговая инструкция от чистой системы до работающего портала в браузере.

## Что где лежит

```
HUBTender/
│
├── src/                     ─┐
├── public/                   │
├── index.html                ├─ FRONTEND  React 18 + Vite + TS + Ant Design
├── vite.config.ts            │             (entry: index.html → src/main.tsx)
├── tsconfig*.json            │
├── vercel.json               │
├── .eslintrc.cjs            ─┘
│
├── backend/                 ─┐ BACKEND   Go BFF (chi + pgx + WebSocket hub)
│   ├── cmd/server/           │           entry: backend/cmd/server/main.go
│   ├── internal/             │           layers: handlers / services / repository
│   │   ├── handlers/         │                    + realtime / calc / middleware
│   │   ├── services/         │
│   │   ├── repository/       │
│   │   ├── realtime/         │
│   │   ├── calc/             │
│   │   └── middleware/       │
│   ├── pkg/apierr/           │
│   ├── go.mod                │
│   └── Dockerfile           ─┘
│
├── supabase/                ─┐ DATABASE  Postgres 17 @ Supabase
│   ├── migrations/           │           SQL-миграции
│   ├── schemas/prod.sql      │           каноничный снимок схемы
│   ├── exports/              │           DDL-дампы
│   └── ai_context/          ─┘
│
├── tests/                   ─┐ QA        Playwright E2E
├── playwright.config.ts     ─┘           (webServer на порту 3001)
│
├── scripts/                 ─┐ DEV/OPS   Node.js утилиты
│   ├── smoke/                │           smoke-тесты Go BFF
│   └── dual-run/            ─┘           RPC-vs-Go diff harness
│
├── docs/                    ─┐ DOCS      архитектура и домен
│   └── archive/             ─┘           устаревшие заметки
│
├── docker-compose.yml       ─┐ INFRA     api + redis + caddy
├── Caddyfile                ─┘           reverse proxy
│
├── CLAUDE.md                   правила проекта и AI-агента
├── BRANDING.md                 дизайн-система
├── .env.example                шаблон переменных окружения
└── package.json                зависимости и npm-скрипты фронта
```

## Быстрый старт

Первым делом — `cp .env.example .env` и заполнить креды Supabase.

### Frontend (React + Vite)

```bash
npm install
npm run dev        # http://localhost:5185 (auto-open)
npm run build      # TS-check + Vite production build
npm run lint       # ESLint (max-warnings: 0)
```

### Backend (Go BFF)

Go локально не нужен — собирается в Docker:

```bash
docker build -t hubtender-api:local ./backend
docker run --rm --env-file .env -p 3005:3005 hubtender-api:local
curl http://localhost:3005/health      # liveness
curl http://localhost:3005/health/db   # readiness + DB ping
```

Полный стек локально (`api + redis + caddy`):

```bash
docker compose up --build
```

### База данных

Работа через Supabase MCP — см. [CLAUDE.md](CLAUDE.md#критические-правила).
`supabase/schemas/prod.sql` — единый источник истины по схеме.

```bash
npm run gen:types     # регенерит src/lib/supabase/database.types.ts
npm run gen:schema    # обновляет supabase/schemas/prod.sql
```

### E2E-тесты

```bash
npm test               # Playwright (поднимает dev-сервер на 3001)
```

### Smoke-тесты Go BFF

```bash
node scripts/smoke/go-bff.mjs                                      # все Go read-эндпоинты
node scripts/dual-run/positions-with-costs.mjs <tender-id>         # diff RPC vs Go
```

## Конвенции

- **Язык**: русский UI, английский код, русские commit-сообщения в императиве
- **Ветки**: `feature/`, `fix/`, `refactor/`
- **Размер файла**: ≤ 600 строк (строго)
- **Секреты**: `VITE_*` инлайнится в клиент — не класть туда приватные ключи
- Полный свод правил: [CLAUDE.md](CLAUDE.md)

## Стек

React 18 · Vite · TypeScript · Ant Design · Go 1.23 · chi · pgx/v5 ·
coder/websocket · Supabase (Postgres 17) · Playwright · Docker · Caddy
