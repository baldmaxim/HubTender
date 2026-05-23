#!/usr/bin/env node
// Production frontend build with auto-derived Sentry release.
// Подставляет VITE_SENTRY_RELEASE = hubtender-web@<git-short-sha> в окружение,
// затем зовёт `vite build --mode production.yandex`. Кросс-платформенно — не
// использует bash-substitution `$(...)`, поэтому работает в PowerShell.
//
// vite.config.ts отдаёт приоритет process.env над .env, поэтому это значение
// перебивает то, что лежит в .env.production.yandex.

import { execSync, spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

// Guard: не дать собрать прод с плейсхолдерным/пустым ключом Supabase.
// Без этой проверки бандл уходит на tender.su10.ru с
// `<anon / publishable key from Supabase Dashboard>` или undefined в
// import.meta.env, и фронт падает на bootstrap с
// "Supabase configuration is missing" (src/lib/supabase/client.ts).
const ENV_FILE = '.env.production.yandex'
const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']
if (!existsSync(ENV_FILE)) {
  console.error(`[build-prod] ${ENV_FILE} not found — Vite не подхватит VITE_* для mode=production.yandex.`)
  process.exit(1)
}
const envText = readFileSync(ENV_FILE, 'utf8')
const parsed = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const eq = line.indexOf('=')
      return eq === -1 ? [line, ''] : [line.slice(0, eq).trim(), line.slice(eq + 1).trim()]
    }),
)
const bad = REQUIRED.filter((k) => {
  const v = parsed[k]
  return !v || v.includes('<') || v.includes('>')
})
if (bad.length > 0) {
  console.error(`[build-prod] ${ENV_FILE}: пустые или плейсхолдерные значения у ${bad.join(', ')}. Заполни реальными значениями перед сборкой.`)
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
