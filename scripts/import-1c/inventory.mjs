// Первый проход по выгрузке: что грузим, какие тексты единиц и статьи затрат
// встречаются, какие единицы у наименований (для строк 1С без единицы).
// Плюс сборка карт сопоставления с учётом ручных решений из out/*.json.

import fs from 'node:fs';
import path from 'node:path';
import { readVersions, str } from './csv.mjs';
import { assignTenderNumbers, assignVersionNumbers, skipReason, parenthetical } from './tenders.mjs';
import { buildUnitMap } from './units.mjs';
import { parseCostArticle, matchArticle } from './costs.mjs';

const inc = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const normName = (s) => String(s ?? '').split(/\s+/).join(' ').trim().toLowerCase();

/** Единицы, которые точно есть в справочнике (офлайн-режим без API). */
export const DEFAULT_UNIT_CODES = ['шт', 'м', 'м2', 'м3', 'кг', 'т', 'л', 'компл', 'м.п.'];

export const inventory = async (csvPath) => {
  const order = [];
  const versions = new Map();
  const skipped = new Map();
  const itemUnits = new Map();
  const customerUnits = new Map();
  const articles = new Map();
  const groups = new Set();
  const subgroups = new Set();
  const nameUoms = new Map();
  const clientHint = new Map();

  for await (const batch of readVersions(csvPath)) {
    const reason = skipReason(batch.tenderName);
    if (reason) {
      skipped.set(batch.tenderName, reason);
      continue;
    }
    if (!versions.has(batch.tenderName)) {
      order.push(batch.tenderName);
      versions.set(batch.tenderName, []);
    }
    versions.get(batch.tenderName).push(batch.versionName);
    for (const r of batch.rows) {
      const cn = str(r.client_name);
      if (cn && !clientHint.has(batch.tenderName)) clientHint.set(batch.tenderName, cn);
      if (r.row_type === 'Строка') {
        if (str(r.uom_customer)) inc(customerUnits, str(r.uom_customer));
        if (str(r.cost_group)) groups.add(str(r.cost_group));
        if (str(r.cost_subgroup)) subgroups.add(str(r.cost_subgroup));
        continue;
      }
      const uom = str(r.uom);
      if (uom) inc(itemUnits, uom);
      if (str(r.cost_category)) inc(articles, str(r.cost_category));
      if (str(r.cost_group)) groups.add(str(r.cost_group));
      if (str(r.cost_subgroup)) subgroups.add(str(r.cost_subgroup));
      const kind = r.row_type === 'Работа' ? 'work' : 'material';
      const key = `${kind}\u0000${normName(r.name)}`;
      if (uom) {
        if (!nameUoms.has(key)) nameUoms.set(key, new Map());
        inc(nameUoms.get(key), uom);
      }
    }
  }

  const numbers = assignTenderNumbers(order);
  const tenders = order.map((name) => {
    const meta = numbers.get(name);
    return {
      name,
      number: meta.number,
      baseNumber: meta.baseNumber,
      title: meta.title,
      clientHint: clientHint.get(name) ?? parenthetical(meta.title),
      versions: assignVersionNumbers(versions.get(name)),
    };
  });
  return { tenders, skipped, itemUnits, customerUnits, articles, groups: [...groups], subgroups: [...subgroups], nameUoms };
};

/** Чтение файла ручных решений (если его нет — пустой объект). */
export const readOverrides = (outDir, file) => {
  const p = path.join(outDir, file);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};

/**
 * Карты сопоставления на основе инвентаризации и справочников HUBTender.
 * @param {Awaited<ReturnType<typeof inventory>>} inv
 * @param {{unitCodes: string[], details: object[]|null, outDir: string}} refs
 */
export const buildMaps = (inv, { unitCodes, details, outDir }) => {
  const known = new Set(unitCodes);
  const unitOverrides = readOverrides(outDir, 'units-map.json');
  const itemUnitMap = buildUnitMap(inv.itemUnits, known, unitOverrides.items ?? {}, { proposeNew: true });
  const customerUnitMap = buildUnitMap(inv.customerUnits, known, unitOverrides.customer ?? {});
  const itemUnitOf = (raw) => (raw ? itemUnitMap.map.get(raw) ?? null : null);
  const customerUnitOf = (raw) => (raw ? customerUnitMap.map.get(raw) ?? null : null);

  const nameUnit = (kind, name) => {
    const uoms = inv.nameUoms.get(`${kind}\u0000${normName(name)}`);
    if (!uoms) return null;
    const best = [...uoms.entries()].sort((a, b) => b[1] - a[1]).find(([t]) => itemUnitOf(t));
    return best ? itemUnitOf(best[0]) : null;
  };

  const costOverrides = readOverrides(outDir, 'cost-map.json');
  const costs = [];
  const costByRaw = new Map();
  for (const [raw, rows] of inv.articles) {
    const art = parseCostArticle(raw, inv.groups, inv.subgroups);
    const hasOverride = art.code && Object.prototype.hasOwnProperty.call(costOverrides, art.code);
    const auto = details ? matchArticle(art, details) : { id: null, how: 'нет справочника (офлайн)', candidates: [] };
    const id = hasOverride ? costOverrides[art.code] : auto.id;
    costByRaw.set(raw, id);
    costs.push({ code: art.code, article: art.text, rows, group: art.group, subgroup: art.subgroup, location: art.location,
      detail_cost_category_id: id, how: hasOverride ? 'файл' : auto.how, candidates: auto.candidates });
  }
  costs.sort((a, b) => b.rows - a.rows);
  const costOf = (raw) => (raw ? costByRaw.get(raw) ?? null : null);

  return {
    itemUnitOf,
    customerUnitOf,
    nameUnit,
    costOf,
    unitReport: { items: itemUnitMap.report, customer: customerUnitMap.report },
    costReport: costs,
    knownUnits: known,
  };
};
