import { defineConfig } from '@playwright/test';

// Этап 2.4 (§14): критический browser smoke ПРОТИВ production bundle.
// Стек (postgres + Go backend + static dist server) поднимает
// scripts/readiness/run-browser-smoke.sh и передаёт E2E_BASE_URL.
export default defineConfig({
  testDir: './tests/readiness',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // общий БД-стейт: строго последовательный smoke
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8010',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'ru-RU',
    viewport: { width: 1720, height: 950 }, // sidebar не коллапсится → без popup-перекрытий
  },
});
