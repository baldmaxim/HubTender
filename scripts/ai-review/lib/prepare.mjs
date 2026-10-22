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

const maxAbsMoney = (findings) => Math.max(0, ...findings.map((f) => Math.abs(Number(f.moneyDelta ?? 0))));

/** Подпись места находки для review.md: «поз. 12.3 «Утеплитель»» либо тип сущности. */
const describeWhere = (finding, position) => {
  if (!position) {
    if (finding.entityType === 'tender') return 'тендер';
    if (finding.entityType === 'material_name') return 'материал справочника';
    const no = finding.itemNoApi ?? finding.positionNumber;
    return no !== null && no !== undefined ? `поз. ${no}` : 'вне позиций';
  }
  const rowId = finding.itemId ?? (finding.entityType === 'boq_item' ? finding.entityId : null);
  const row = rowId ? position.rows.find((r) => r.id === rowId) : undefined;
  const name = row?.name || position.customerName;
  return `поз. ${position.itemNo}${name ? ` «${clipText(name.replace(/\s+/g, ' '), WHERE_NAME_LENGTH)}»` : ''}`;
};

/**
 * @param {{ get: Function }} portal
 * @param {string} tenderArg
 * @param {{ rules?: string[], onlyNew?: boolean, refresh?: boolean, max?: number, log?: (line: string) => void }} [opts]
 */
export const collectData = async (portal, tenderArg, { rules: ruleCodes, onlyNew = false, refresh = false, max, log = () => {} } = {}) => {
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
  return {
    tender,
    rules,
    items,
    skippedPositions: ordered.length - items.length,
    unreviewed,
    positionNumbers,
    totalFindings: rawFindings.length,
    warnings,
  };
};
