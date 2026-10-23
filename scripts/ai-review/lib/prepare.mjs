/**
 * Сбор данных тендера для прогона: находки, позиции, строки → группы «позиция + её находки».
 * Общий код команд run и ping --bench.
 */

import { byMoneyDesc, clipText } from './format.mjs';
import {
  adaptFinding,
  adaptPosition,
  groupRowsByPosition,
  loadFindings,
  loadPositions,
  loadRows,
  loadRules,
  resolveTender,
} from './tender.mjs';

const WHERE_NAME_LENGTH = 60;

/** Доля стоимости тендера, до которой берутся позиции для собственных замечаний ИИ. */
const REMARK_COST_SHARE = 0.8;

const maxAbsMoney = (findings) => Math.max(0, ...findings.map((f) => Math.abs(Number(f.moneyDelta ?? 0))));

/** Подпись места в позиции: «поз. 12.3 «имя строки или наименование заказчика»». */
export const describePosition = (position, rowId) => {
  const row = rowId ? position.rows.find((r) => r.id === rowId) : undefined;
  const name = row?.name || position.customerName;
  return `поз. ${position.itemNo}${name ? ` «${clipText(name.replace(/\s+/g, ' '), WHERE_NAME_LENGTH)}»` : ''}`;
};

/** Подпись места находки для review.md: «поз. 12.3 «Утеплитель»» либо тип сущности. */
const describeWhere = (finding, position) => {
  if (!position) {
    if (finding.entityType === 'tender') return 'тендер';
    if (finding.entityType === 'material_name') return 'материал справочника';
    const no = finding.itemNoApi ?? finding.positionNumber;
    return no !== null && no !== undefined ? `поз. ${no}` : 'вне позиций';
  }
  return describePosition(position, finding.itemId ?? (finding.entityType === 'boq_item' ? finding.entityId : null));
};

/** Стоимость позиции: сумма строк расчёта (total), нечисловые не учитываются. */
export const positionCost = (position) =>
  (position.rows ?? []).reduce((sum, row) => {
    const total = Number(row.total);
    return Number.isFinite(total) ? sum + total : sum;
  }, 0);

/**
 * Позиции без находок для собственных замечаний ИИ: самые дорогие, пока накопленная доля
 * стоимости тендера меньше 80 % (позиции с находками тоже копят долю, но сами не берутся).
 * С all — все позиции со строками, без порога и потолка.
 * @param {Array<{ id: string, rows?: object[] }>} positions адаптированные позиции со строками
 * @param {Set<string>} excludeIds позиции, уже идущие в прогон с находками
 * @param {{ limit?: number, all?: boolean, positionNumbers?: Map<string, number> }} [opts]
 * @returns {{ items: Array<{ position: object, findings: [] }>, coverage: number }}
 *   coverage — доля стоимости отобранных и исключённых среди накопленных (при all — 1)
 */
export const selectRemarkPositions = (positions, excludeIds, { limit = Infinity, all = false, positionNumbers = new Map() } = {}) => {
  const exclude = excludeIds ?? new Set();
  const withCost = positions
    .filter((p) => (p.rows ?? []).length > 0)
    .map((position) => ({ position, cost: positionCost(position) }))
    .filter(({ cost }) => all || cost > 0)
    .sort(
      (a, b) =>
        b.cost - a.cost ||
        (positionNumbers.get(a.position.id) ?? Infinity) - (positionNumbers.get(b.position.id) ?? Infinity) ||
        a.position.id.localeCompare(b.position.id),
    );
  const toItem = ({ position }) => ({ position, findings: [] });

  if (all) return { items: withCost.filter(({ position }) => !exclude.has(position.id)).map(toItem), coverage: 1 };

  const total = withCost.reduce((sum, { cost }) => sum + cost, 0);
  const picked = [];
  let accumulated = 0;
  for (const entry of withCost) {
    if (accumulated >= total * REMARK_COST_SHARE) break;
    picked.push(entry);
    accumulated += entry.cost;
  }
  const chosen = picked.filter(({ position }) => !exclude.has(position.id)).slice(0, limit);
  const covered = picked.filter(({ position }) => exclude.has(position.id)).reduce((sum, { cost }) => sum + cost, 0);
  const coverage = total > 0 ? (chosen.reduce((sum, { cost }) => sum + cost, covered)) / total : 0;
  return { items: chosen.map(toItem), coverage };
};

/**
 * @param {{ get: Function }} portal
 * @param {string} tenderArg
 * @param {{ rules?: string[], onlyNew?: boolean, refresh?: boolean, max?: number, remarks?: number, all?: boolean,
 *   log?: (line: string) => void }} [opts] remarks — сколько позиций без находок отобрать для замечаний ИИ (0 — не отбирать),
 *   all — все позиции со строками
 */
export const collectData = async (
  portal,
  tenderArg,
  { rules: ruleCodes, onlyNew = false, refresh = false, max, remarks = 0, all = false, log = () => {} } = {},
) => {
  const tender = await resolveTender(portal, tenderArg);
  log(`Тендер: ${tender.number}${tender.version ? ` v${tender.version}` : ''} «${tender.title}»`);

  const rules = await loadRules(portal);
  const report = await loadFindings(portal, tender.id, { rules: ruleCodes, onlyNew, refresh });
  const warnings = report.errors.map((e) => `правило ${e.rule_code} не отработало: ${e.message}`);
  const rawFindings = report.findings.filter((f) => f.verdict === null || f.verdict === undefined);
  log(`Открытых находок: ${rawFindings.length}`);

  const rawPositions = await loadPositions(portal, tender.id);
  const rawRows = await loadRows(portal, tender.id);
  const rowsByPosition = groupRowsByPosition(rawRows);
  const rowPositionById = new Map(rawRows.map((r) => [r.id, r.client_position_id]));
  const positionNumbers = new Map(rawPositions.map((p) => [p.id, p.position_number]));
  const positionById = new Map(rawPositions.map((p) => [p.id, adaptPosition(p, rowsByPosition.get(p.id) ?? [])]));

  const groups = new Map();
  const unreviewed = [];
  for (const raw of rawFindings) {
    const finding = adaptFinding(raw, { rules, rowPositionById });
    const position = finding.positionId ? positionById.get(finding.positionId) : undefined;
    const where = describeWhere(finding, position);
    const entry = { ...finding, where };
    if (!position) {
      unreviewed.push(entry);
      continue;
    }
    const group = groups.get(position.id) ?? { position, findings: [] };
    group.findings.push(entry);
    groups.set(position.id, group);
  }

  const ordered = [...groups.values()].sort(
    (a, b) =>
      byMoneyDesc(maxAbsMoney(a.findings), maxAbsMoney(b.findings)) ||
      (positionNumbers.get(a.position.id) ?? Infinity) - (positionNumbers.get(b.position.id) ?? Infinity) ||
      a.position.id.localeCompare(b.position.id),
  );
  const items = max ? ordered.slice(0, max) : ordered;

  let remarkItems = [];
  let remarkCoverage = 0;
  if (all || remarks > 0) {
    const picked = selectRemarkPositions([...positionById.values()], new Set(items.map((g) => g.position.id)), {
      limit: remarks,
      all,
      positionNumbers,
    });
    remarkItems = picked.items;
    remarkCoverage = picked.coverage;
    log(`Позиций без находок для замечаний ИИ: ${remarkItems.length} (покрытие ${Math.round(remarkCoverage * 100)} % стоимости)`);
  }
  const positionTotals = new Map([...positionById.values()].map((p) => [p.id, positionCost(p)]));

  return {
    tender,
    rules,
    items,
    remarkItems,
    remarkCoverage,
    positionTotals,
    skippedPositions: ordered.length - items.length,
    unreviewed,
    positionNumbers,
    totalFindings: rawFindings.length,
    warnings,
  };
};
