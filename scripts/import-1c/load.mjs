#!/usr/bin/env node
// Загрузка выгрузки 1С («Результаты.csv») в HUBTender через API Go BFF.
//
//   node scripts/import-1c/load.mjs                      офлайн: разбор + отчёт, без сети
//   node scripts/import-1c/load.mjs --api                пробный прогон: справочники и
//                                                        конфликты с портала (только GET)
//   node scripts/import-1c/load.mjs --api --commit       загрузка (запись!)
//       [--only 299.2,263] [--replace 269] [--create-units]
//   node scripts/import-1c/load.mjs --api --purge-old 269 --yes   удалить «269-old»
//
// Окружение: TENDERHUB_API_URL (по умолчанию https://tender.su10.ru),
// TENDERHUB_EMAIL, TENDERHUB_PASSWORD. Файлы решений и отчёты — в --out
// (по умолчанию scripts/import-1c/out): units-map.json, cost-map.json, dop-map.json.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { HubApi } from './api.mjs';
import { inventory, buildMaps, readOverrides, DEFAULT_UNIT_CODES } from './inventory.mjs';
import { prepareAll, nameKey } from './prepare.mjs';
import { renderReport, writeAutoMaps, writeJson } from './report.mjs';
import { detailLabel } from './costs.mjs';
import { commitLoad, purgeOld, replacePreflight } from './commit.mjs';
import { readDopReview, writeDopReview, DOP_REVIEW_FILE } from './dopreview.mjs';

const MAX_DOP_PER_PARENT = 54;

const { values: args } = parseArgs({
  options: {
    csv: { type: 'string', default: 'Результаты.csv' },
    out: { type: 'string', default: 'scripts/import-1c/out' },
    api: { type: 'boolean', default: false },
    commit: { type: 'boolean', default: false },
    only: { type: 'string' },
    replace: { type: 'string' },
    'create-units': { type: 'boolean', default: false },
    'purge-old': { type: 'string' },
    yes: { type: 'boolean', default: false },
  },
});

const log = (...a) => console.log(...a);
const list = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);

const loadRefs = async (api) => {
  log('Справочники портала…');
  const [units, cats, details, registry, tenders, works, materials] = await Promise.all([
    api.listUnits(), api.listCostCategories(), api.listDetailCostCategories(), api.listRegistry(),
    api.listTenders(), api.listNames('work'), api.listNames('material'),
  ]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const joined = details.map((d) => ({ id: d.id, name: d.name, location: d.location ?? null, categoryName: catName.get(d.cost_category_id) ?? '' }));
  const nameIds = new Map();
  for (const n of works) if (!nameIds.has(nameKey('work', n.name, n.unit))) nameIds.set(nameKey('work', n.name, n.unit), n.id);
  for (const n of materials) if (!nameIds.has(nameKey('material', n.name, n.unit))) nameIds.set(nameKey('material', n.name, n.unit), n.id);
  return {
    unitCodes: units.map((u) => u.code),
    details: joined,
    detailLabels: joined.map((d) => ({ id: d.id, label: detailLabel(d) })),
    registry,
    tenders,
    nameIds,
    namesTotal: works.length + materials.length,
  };
};

const main = async () => {
  const outDir = args.out;
  fs.mkdirSync(outDir, { recursive: true });
  const api = args.api
    ? new HubApi({
      baseUrl: process.env.TENDERHUB_API_URL ?? 'https://tender.su10.ru',
      email: process.env.TENDERHUB_EMAIL,
      password: process.env.TENDERHUB_PASSWORD,
    })
    : null;

  if (args['purge-old']) {
    if (!api) throw new Error('--purge-old требует --api');
    await purgeOld({ api, number: args['purge-old'], yes: args.yes, outDir, log });
    return;
  }
  if (args.commit && !api) throw new Error('--commit требует --api');

  log(`Читаю ${args.csv}…`);
  const inv = await inventory(args.csv);
  const only = list(args.only);
  const replace = list(args.replace);
  const selected = new Set(inv.tenders.map((t) => t.number).filter((n) => !only.length || only.includes(n)));
  for (const n of only) if (!selected.has(n)) throw new Error(`--only: номера ${n} нет в выгрузке`);

  const refs = api ? await loadRefs(api) : null;
  const maps = buildMaps(inv, { unitCodes: refs?.unitCodes ?? DEFAULT_UNIT_CODES, details: refs?.details ?? null, outDir });
  // Решения по ДОП: Excel out/dop-review.xlsx, точечные правки — out/dop-map.json.
  const dopOverrides = { ...readDopReview(outDir), ...readOverrides(outDir, 'dop-map.json') };
  if (Object.keys(dopOverrides).length) log(`Ручных решений по ДОП: ${Object.keys(dopOverrides).length}`);
  log('Собираю версии…');
  const prepared = await prepareAll({ csvPath: args.csv, inv, maps, selected, dopOverrides });

  const blockers = [];
  if (prepared.unresolved.length) blockers.push(`${prepared.unresolved.length} ДОП без родителя — заполните «Решение» в out/${DOP_REVIEW_FILE}`);
  if (prepared.noUnitItems.length) blockers.push(`${prepared.noUnitItems.length} строк без единицы — задайте её в out/units-map.json`);
  const maxDop = Math.max(0, ...prepared.versions.map((v) => v.stats.maxDopPerParent));
  if (maxDop > MAX_DOP_PER_PARENT) blockers.push(`у одной позиции ${maxDop} ДОП — сервер нумерует не больше ${MAX_DOP_PER_PARENT}`);
  for (const v of prepared.versions) {
    for (const cur of v.currencies) if (!(v.rates[cur]?.rate > 0)) blockers.push(`${v.tender} v${v.version}: нет курса ${cur}`);
  }

  if (refs) {
    const missingUnits = [...prepared.usedUnits.keys()].filter((c) => !refs.unitCodes.includes(c));
    if (missingUnits.length && !args['create-units']) {
      blockers.push(`единиц нет в справочнике: ${missingUnits.join(', ')} — запуск с --create-units заведёт их`);
    }
    refs.missingUnits = missingUnits;
    refs.namesExisting = [...prepared.names.keys()].filter((k) => refs.nameIds.has(k)).length;
    refs.conflicts = refs.tenders
      .filter((t) => selected.has(t.tender_number) && !replace.includes(t.tender_number))
      .map((t) => ({ number: t.tender_number, version: t.version, title: t.title, id: t.id }));
    if (refs.conflicts.length) blockers.push(`${refs.conflicts.length} версий с такими номерами уже есть на портале (см. отчёт)`);
    for (const n of replace) {
      if (refs.tenders.some((t) => t.tender_number === `${n}-old`)) blockers.push(`на портале уже есть «${n}-old» — сначала --purge-old ${n}`);
    }
    const pre = await replacePreflight({ api, refs, replace });
    blockers.push(...pre.problems);
    refs.replaceOld = pre.old;
    for (const t of pre.old) log(`Будет заменено: ${t.number} v${t.version} «${t.title}» (хронология: ${t.timelineGroups} групп)`);
  }

  writeAutoMaps(outDir, { maps, prepared });
  const review = writeDopReview(outDir, prepared);
  if (review) log(`Разбор ДОП: ${review}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const mode = args.commit ? 'загрузка' : api ? 'пробный прогон (портал)' : 'офлайн-разбор';
  const report = renderReport({ inv, maps, prepared, refs, blockers, mode });
  const reportPath = path.join(outDir, `report-${stamp}.md`);
  fs.writeFileSync(reportPath, report, 'utf8');
  writeJson(outDir, 'plan.json', prepared.versions.map(({ stats, ...rest }) => ({ ...rest, stats: { ...stats, unresolved: stats.unresolved.length, anomalies: stats.anomalies.length } })));
  log(`Отчёт: ${reportPath}`);
  log(blockers.length ? `Блокеры:\n- ${blockers.join('\n- ')}` : 'Блокеров нет.');

  if (!args.commit) return;
  if (blockers.length) throw new Error('загрузка остановлена: есть блокеры');
  await commitLoad({ api, csvPath: args.csv, inv, maps, prepared, refs, selected, replace, dopOverrides, outDir, log });
};

main().catch((err) => {
  console.error(`ОШИБКА: ${err.message}`);
  process.exitCode = 1;
});
