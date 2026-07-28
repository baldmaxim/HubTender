// Release regression guard (этап 3.1, RC1): порядок применения инкрементальных
// миграций — лексикографический glob (rehearsal + deploy).
//
// Upgrade-сценарий (production path): применяется ТОЛЬКО incremental-цепочка
// поверх старой схемы; текущий baseline (db/yandex/sql, синхронизирован с
// финальной схемой) в этот момент недоступен. Поэтому таблица, создаваемая
// каким-либо incremental-файлом («chain-owned»), НЕ существует для файлов,
// сортирующихся раньше создающего, — даже если она есть в текущем baseline.
//
// Регрессия, которую фиксирует guard: 2026_07_ai_controlled_rollout.sql
// (ALTER TABLE ai_feature_settings) сортировался РАНЬШЕ
// 2026_07_ai_feature_settings.sql (CREATE TABLE) → upgrade rehearsal падал:
//   ERROR: relation "public.ai_feature_settings" does not exist
// Fresh-сценарий маскировал дефект (таблица приходила из baseline).
// Исправлено переименованием в 2026_07_ai_rollout_controlled.sql.
//
//   node scripts/checks/migrationOrder.check.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');
const INC_DIR = join(ROOT, 'db/yandex/incremental');

const stripComments = (sql) =>
  sql.replace(/\r\n/g, '\n').replace(/--[^\n]*/g, '');

const tableRe = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi;
const refRes = [
  /\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi,
  /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[a-z0-9_]+\s+ON\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
  /\bINSERT\s+INTO\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
  /\bREFERENCES\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
];

const collect = (re, sql) => {
  const out = new Set();
  for (const m of sql.matchAll(re)) out.add(m[1].toLowerCase());
  return out;
};

const incFiles = readdirSync(INC_DIR).filter((f) => f.endsWith('.sql')).sort();
const dupNames = incFiles.filter((f, i) => incFiles.indexOf(f) !== i);
const bodies = new Map(
  incFiles.map((f) => [f, stripComments(readFileSync(join(INC_DIR, f), 'utf8'))]),
);

// Первый создающий файл для каждой chain-owned таблицы.
const creatorOf = new Map();
for (const f of incFiles) {
  for (const t of collect(tableRe, bodies.get(f))) {
    if (!creatorOf.has(t)) creatorOf.set(t, f);
  }
}

const errors = [];
for (const f of incFiles) {
  const sql = bodies.get(f);
  const createsHere = collect(tableRe, sql);
  const refs = new Set();
  for (const re of refRes) for (const t of collect(re, sql)) refs.add(t);
  for (const t of refs) {
    const creator = creatorOf.get(t);
    // Таблицы вне цепочки (tenders, boq_items, …) существуют в любой
    // pre-upgrade схеме — их порядок не проверяем.
    if (creator && creator > f && !createsHere.has(t)) {
      errors.push(`${f}: ссылается на chain-owned "${t}", создаваемую позже (${creator})`);
    }
  }
}

console.log('migrationOrder.check:');
if (dupNames.length) errors.push(`duplicate migration names: ${dupNames.join(', ')}`);
if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log(
  `  ok — ${incFiles.length} incremental-файлов, ${creatorOf.size} chain-owned таблиц, порядок ссылок корректен, дублей имён нет`,
);
