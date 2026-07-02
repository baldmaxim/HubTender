# HUBTender

Портал управления тендерами в строительстве (BOQ + биржа работ).
Фронт — React + Vite + Ant Design. Бэк — Go BFF (chi + pgx) перед Yandex
Managed PostgreSQL 17. Аутентификация полностью app-auth (Go BFF выдаёт
RS256 JWT через `/api/v1/auth/*`). Realtime — native WebSocket hub Go BFF.
Подробнее о конвенциях, ENV и рабочем процессе — в [CLAUDE.md](CLAUDE.md).

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
│   ├── cmd/server/           │           entry: main.go + wire.go (DI) + routes.go
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

Yandex Managed PostgreSQL (Supabase удалён). Схема и миграции — в `db/yandex/`.
`supabase/schemas/prod.sql` — исторический снимок канонической схемы.

## Конвенции

- **Язык**: русский UI, английский код, русские commit-сообщения в императиве
- **Ветки**: `feature/`, `fix/`, `refactor/`
- **Размер файла**: ≤ 600 строк (строго)
- **Секреты**: `VITE_*` инлайнится в клиент — не класть туда приватные ключи
- Полный свод правил: [CLAUDE.md](CLAUDE.md)

## Стек

React 18 · Vite · TypeScript · Ant Design · Go 1.23 · chi · pgx/v5 ·
coder/websocket · Yandex Managed PostgreSQL 17 · Docker · nginx
