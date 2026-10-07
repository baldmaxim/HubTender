#!/usr/bin/env node
// Откат загрузки 1С по out/manifest.json: удаляет созданные версии тендеров,
// по --restore возвращает переименованным «<номер>-old» исходный номер.
//
//   node scripts/import-1c/rollback.mjs [--only 299.2] [--restore] --yes
//
// Без --yes только показывает, что будет сделано. Наименования и единицы,
// заведённые загрузкой, не удаляются (на них могут ссылаться другие тендеры).

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { HubApi } from './api.mjs';

const { values: args } = parseArgs({
  options: {
    out: { type: 'string', default: 'scripts/import-1c/out' },
    only: { type: 'string' },
    restore: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
});

const main = async () => {
  const file = path.join(args.out, 'manifest.json');
  if (!fs.existsSync(file)) throw new Error(`нет ${file}`);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const only = args.only ? args.only.split(',').map((s) => s.trim()) : null;

  const targets = [];
  for (const [number, t] of Object.entries(manifest.tenders)) {
    if (only && !only.includes(number)) continue;
    for (const [version, v] of Object.entries(t.versions)) {
      if (v.id && !['deleted', 'failed-deleted'].includes(v.status)) targets.push({ number, version, ...v });
    }
  }
  const restores = args.restore ? manifest.renamed.filter((r) => !r.restored && (!only || only.includes(r.from))) : [];

  for (const t of targets) console.log(`удалить ${t.number} v${t.version} (${t.status}) ${t.id}`);
  for (const r of restores) console.log(`вернуть номер «${r.from}» версии v${r.version} ${r.id}`);
  if (!args.yes) {
    console.log('Это предпросмотр. Добавьте --yes для выполнения.');
    return;
  }

  const api = new HubApi({
    baseUrl: process.env.TENDERHUB_API_URL ?? 'https://tender.su10.ru',
    email: process.env.TENDERHUB_EMAIL,
    password: process.env.TENDERHUB_PASSWORD,
  });
  for (const t of targets) {
    try {
      await api.deleteTender(t.id);
      manifest.tenders[t.number].versions[t.version].status = 'deleted';
      console.log(`удалено ${t.number} v${t.version}`);
    } catch (err) {
      console.error(`не удалось ${t.number} v${t.version}: ${err.message}`);
    }
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  for (const r of restores) {
    await api.adminPatchTender(r.id, { tender_number: r.from });
    r.restored = new Date().toISOString();
    console.log(`номер «${r.from}» возвращён (${r.id})`);
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  // Строки «Перечня», созданные триггером для новых номеров: API удаления нет —
  // архивируем, чтобы не висели «В работе».
  const before = new Set(manifest.registryBefore ?? []);
  const rolledBack = new Set(targets.map((t) => t.number));
  for (const row of (await api.listRegistry())) {
    if (row.tender_number && rolledBack.has(row.tender_number) && !before.has(row.tender_number) && !row.is_archived) {
      await api.patchRegistry(row.id, { is_archived: true });
      (manifest.registryArchived ??= []).push({ id: row.id, tender_number: row.tender_number, rollback: true });
      console.log(`«Перечень»: строка ${row.tender_number} архивирована`);
    }
  }
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
};

main().catch((err) => {
  console.error(`ОШИБКА: ${err.message}`);
  process.exitCode = 1;
});
