// Привязка «Разделителей» 1С (ДОП-работ) к строкам заказчика.
// Ключ из выгрузки: у ДОП pp_customer и section_no родителя, qty_gp унаследован
// от родителя. Каскад: сильный ключ → вложенный ДОП → тот же ДОП в прошлой
// версии → parent_line = имя ровно одной строки → ручное решение (dop-map.json).

import { num } from './csv.mjs';

/** Ключ ДОП для ручных решений: «тендер|версия|pp_no». */
export const dopKey = (tenderName, versionName, row) => `${tenderName}|${versionName}|${num(row.pp_no)}`;

const scoreCandidate = (dop, reg) => {
  let sc = 0;
  if (num(reg.pp_customer) === num(dop.pp_customer)) sc += 4;
  if (reg.section_no === dop.section_no) sc += 4;
  if (dop.section_no.startsWith(`${reg.section_no}.`)) sc += 2;
  const q = num(dop.qty_gp);
  if (q && num(reg.qty_gp) === q) sc += 3;
  if (dop.parent_line === reg.parent_line) sc += 1;
  if (dop.parent_line === reg.name) sc += 2;
  return sc;
};

const STRONG = 8;

/**
 * @param {{regular: object[], dops: object[], tenderName: string, versionName: string,
 *   prev: Map<string, {name: string, section: string}>, overrides: Record<string, any>}} input
 *   regular/dops — строки «Строка» версии (сырые записи CSV), в порядке файла.
 * @returns {{decisions: Map<number, {parent: number|null, asPosition: boolean, how: string,
 *   candidates: object[]}>, next: Map<string, {name: string, section: string}>}}
 *   decisions — по индексу ДОП в dops; parent — индекс в regular.
 */
export const resolveDops = ({ regular, dops, tenderName, versionName, prev, overrides }) => {
  const decisions = new Map();
  const byDopName = new Map();
  const next = new Map();

  const candidatesFor = (dop) => regular
    .map((r, i) => ({ i, score: scoreCandidate(dop, r) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ i, score }) => ({ index: i, score, section_no: regular[i].section_no, name: regular[i].name }));

  dops.forEach((dop, di) => {
    const key = dopKey(tenderName, versionName, dop);
    const manual = overrides[key];
    const cands = candidatesFor(dop);
    let parent = null;
    let how = 'не определён';
    let asPosition = false;

    if (manual === 'position' || manual?.as_position) {
      asPosition = true;
      how = 'вручную: обычная позиция';
    } else if (manual?.parent) {
      const hits = regular
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.section_no?.trim() === String(manual.parent).trim()
          && (!manual.name || r.name?.trim() === String(manual.name).trim()));
      if (hits.length !== 1) {
        throw new Error(`dop-map.json: «${key}» → родитель «${manual.parent}» найден ${hits.length} раз`);
      }
      parent = hits[0].i;
      how = 'вручную';
    } else {
      const [first, second] = cands;
      if (first && first.score >= STRONG && (!second || second.score < first.score)) {
        parent = first.index;
        how = 'ключ';
      }
      if (parent === null && byDopName.has(dop.parent_line)) {
        parent = byDopName.get(dop.parent_line);
        how = 'вложенный ДОП';
      }
      if (parent === null) {
        const p = prev.get(`${dop.name}\u0000${dop.parent_line}`);
        if (p) {
          let hits = regular.map((r, i) => ({ r, i })).filter(({ r }) => r.name === p.name && r.section_no === p.section);
          if (hits.length !== 1) hits = regular.map((r, i) => ({ r, i })).filter(({ r }) => r.name === p.name);
          if (hits.length === 1) {
            parent = hits[0].i;
            how = 'прошлая версия';
          }
        }
      }
      if (parent === null) {
        const hits = regular.map((r, i) => ({ r, i })).filter(({ r }) => r.name === dop.parent_line);
        if (hits.length === 1) {
          parent = hits[0].i;
          how = 'parent_line';
        }
      }
    }

    if (parent !== null) {
      byDopName.set(dop.name, parent);
      next.set(`${dop.name}\u0000${dop.parent_line}`, { name: regular[parent].name, section: regular[parent].section_no });
    }
    decisions.set(di, { parent, asPosition, how, candidates: cands, key });
  });

  return { decisions, next };
};
