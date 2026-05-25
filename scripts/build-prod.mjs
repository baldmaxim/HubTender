#!/usr/bin/env node
// Production frontend build with auto-derived Sentry release.
// Подставляет VITE_SENTRY_RELEASE = hubtender-web@<git-short-sha> в окружение,
// затем зовёт `vite build --mode production.yandex`. Кросс-платформенно — не
// использует bash-substitution `$(...)`, поэтому работает в PowerShell.
//
// vite.config.ts отдаёт приоритет process.env над .env, поэтому это значение
// перебивает то, что лежит в .env.production.yandex.

import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const ENV_FILE = '.env.production.yandex'
if (!existsSync(ENV_FILE)) {
  console.error(`[build-prod] ${ENV_FILE} not found — Vite не подхватит VITE_* для mode=production.yandex.`)
  process.exit(1)
}

const sha = execSync('git rev-parse --short HEAD').toString().trim()
const release = `hubtender-web@${sha}`
console.log(`[build-prod] VITE_SENTRY_RELEASE=${release}`)

const child = spawn('npx', ['vite', 'build', '--mode', 'production.yandex'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, VITE_SENTRY_RELEASE: release },
})

child.on('exit', (code) => process.exit(code ?? 1))
