// Сборка версии тендера из строк 1С в полезную нагрузку API HUBTender:
// позиции (/positions/bulk), ДОП и строки BOQ (/imports/boq).
// Правила согласованы с пользователем (план replicated-foraging-naur.md):
//  1) материал привязан, если volume = V_работы × перевод × расход (>0);
//     непривязанному перевод зашивается в расход, quantity = volume / расход;
//  4) расход < 1 запрещён: привязанному — в перевод, непривязанному — в количество;
//  5) курсы — обратным счётом по версии.

import { num, str, date, yes } from './csv.mjs';
import { resolveDops } from './dop.mjs';

const DOP_ROW = 'Разделитель';
const DEFAULT_UNIT = 'шт';
const round10 = (x) => (x === null ? null : Math.round(x * 1e10) / 1e10);
const close = (a, b) => Math.abs(a - b) <= Math.max(1e-4, Math.abs(b) * 1e-6);
const joinNotes = (...parts) => parts.map(str).filter(Boolean).join('\n') || null;
const posNum = (v) => (v !== null && v > 0 ? v : null);

/** Делит строки версии на блоки «Строка + её работы/материалы». */
export const splitBlocks = (rows) => {
  const blocks = [];
  for (const row of rows) {
    if (row.row_type === 'Строка') {
      blocks.push({ head: row, items: [] });
    } else if (blocks.length) {
      blocks[blocks.length - 1].items.push(row);
    } else {
      throw new Error(`строка ${row._line}: «${row.row_type}» раньше первой «Строки» версии`);
    }
  }
  return blocks;
};

/** Уровень иерархии позиции = число точек в номере раздела (0..10). */
export const hierarchyLevel = (sectionNo) => {
  const s = str(sectionNo);
  if (!s || !/^\d+(\.\d+)*$/.test(s)) return 0;
  return Math.min(10, s.split('.').length - 1);
};

const DELIVERY = { 'в цене': 'в цене', 'не в цене': 'не в цене', 'суммой': 'суммой' };

/** Цена материала за единицу без доставки (в валюте строки). */
const materialUnitRate = (r, dw) => {
  const pc = num(r.price_currency);
  if (pc !== null) return pc;
  const price = num(r.price) ?? 0;
  if (dw === 'не в цене') return round10(price / 1.03);
  if (dw === 'суммой') return round10(price - (num(r.delivery_amount) ?? 0));
  return price;
};

/** Тип строки BOQ: «Комплект» приоритетнее «Субподряда» (решение пользователя). */
export const boqItemType = (row) => {
  const work = row.row_type === 'Работа';
  if (yes(row.kit)) return work ? 'раб-комп.' : 'мат-комп.';
  if (yes(row.subcontract)) return work ? 'суб-раб' : 'суб-мат';
  return work ? 'раб' : 'мат';
};

/**
 * Количества и коэффициенты материала по правилам 1 и 4.
 * @param {number|null} volume объём материала 1С (уже с переводом и расходом)
 * @param {number|null} workVolume объём работы из parent_work_pp_no (если есть)
 */
export const materialQuantities = (volume, workVolume, convRaw, consRaw) => {
  const conv = convRaw ? convRaw : 1; // 0/NULL в 1С = 1
  const cons = consRaw ? consRaw : 1;
  const v = volume ?? 0;
  const linked = v > 0 && workVolume !== null && workVolume > 0 && close(v, workVolume * conv * cons);
  if (linked) {
    const folded = cons < 1;
    return {
      linked: true,
      folded,
      quantity: v,
      base_quantity: null,
      conversion_coefficient: round10(folded ? conv * cons : conv),
      consumption_coefficient: round10(folded ? 1 : cons),
    };
  }
  const k = conv * cons;
  if (v <= 0) {
    return { linked: false, folded: false, quantity: null, base_quantity: null, conversion_coefficient: null, consumption_coefficient: round10(Math.max(1, k)) };
  }
  const folded = k < 1;
  const consumption = folded ? 1 : k;
  const quantity = round10(v / consumption);
  return { linked: false, folded, quantity, base_quantity: quantity, conversion_coefficient: null, consumption_coefficient: round10(consumption) };
};

/** Курсы валют версии: Σ(amount − доставка×V) / Σ(V × цена в валюте). */
export const versionRates = (rows) => {
  const acc = {};
  for (const r of rows) {
    if (r.row_type !== 'Материал') continue;
    const cur = str(r.currency);
    const pc = num(r.price_currency);
    const v = num(r.volume);
    const a = num(r.amount);
    // строки с нулевой/отрицательной суммой курса не несут (цена 0 при цене в валюте)
    if (!cur || cur === 'RUB' || !pc || !v || a === null || a <= 0) continue;
    acc[cur] ??= { num: 0, den: 0, rows: 0 };
    acc[cur].num += a - (num(r.delivery_amount) ?? 0) * v;
    acc[cur].den += v * pc;
    acc[cur].rows += 1;
  }
  const out = {};
  for (const [cur, x] of Object.entries(acc)) {
    const rate = Math.round((x.num / x.den) * 1e4) / 1e4;
    if (rate > 0) out[cur] = { rate, rows: x.rows };
  }
  return out;
};

/**
 * @param {{tenderName: string, versionName: string, rows: object[]}} batch
 * @param {{itemUnitOf: (raw: string|null) => string|null, customerUnitOf: (raw: string|null) => string|null, nameUnit: (kind: string, name: string) => string|null,
 *   costOf: (raw: string|null) => string|null, dopOverrides: object, prevDop: Map}} ctx
 */
export const buildVersion = (batch, ctx) => {
  const { tenderName, versionName } = batch;
  const blocks = splitBlocks(batch.rows);
  const regular = blocks.filter((b) => b.head.row_name !== DOP_ROW);
  const dopBlocks = blocks.filter((b) => b.head.row_name === DOP_ROW);
  const { decisions, next } = resolveDops({
    regular: regular.map((b) => b.head),
    dops: dopBlocks.map((b) => b.head),
    tenderName,
    versionName,
    prev: ctx.prevDop,
    overrides: ctx.dopOverrides,
  });

  const stats = {
    positions: 0, dops: 0, dopHow: {}, unresolved: [], items: 0, works: 0, materials: 0,
    linked: 0, unlinked: 0, foldedLinked: 0, foldedUnlinked: 0, zeroQty: 0,
    unitFallback: 0, unitDefault: 0, noCost: 0, negative: 0, anomalies: [], amount1c: 0, types: {}, delivery: {}, maxDopPerParent: 0,
  };

  const positions = regular.map((b, i) => ({
    position_number: i + 1,
    item_no: str(b.head.section_no),
    work_name: str(b.head.name) ?? str(b.head.customer_line) ?? '(без наименования)',
    unit_code: ctx.customerUnitOf(str(b.head.uom_customer)),
    volume: num(b.head.qty_customer),
    client_note: joinNotes(b.head.note_customer, b.head.comment_customer),
    hierarchy_level: hierarchyLevel(b.head.section_no),
    manual_volume: num(b.head.qty_gp),
    manual_note: str(b.head.note_gp),
  }));
  regular.forEach((b, i) => { b.target = { kind: 'pos', index: i }; });

  const dops = [];
  const namesByParent = new Map();
  dopBlocks.forEach((b, di) => {
    const d = decisions.get(di);
    stats.dopHow[d.how] = (stats.dopHow[d.how] ?? 0) + 1;
    if (d.asPosition) {
      positions.push({
        position_number: positions.length + 1,
        item_no: str(b.head.section_no),
        work_name: str(b.head.name) ?? '(ДОП без наименования)',
        unit_code: ctx.customerUnitOf(str(b.head.uom_customer)),
        volume: null,
        client_note: joinNotes('ДОП из 1С без привязки', b.head.note_customer),
        hierarchy_level: 0,
        manual_volume: num(b.head.qty_customer),
        manual_note: str(b.head.note_gp),
      });
      b.target = { kind: 'pos', index: positions.length - 1 };
      return;
    }
    if (d.parent === null) {
      stats.unresolved.push({ key: d.key, name: str(b.head.name), section_no: str(b.head.section_no), pp_customer: num(b.head.pp_customer), parent_line: str(b.head.parent_line), candidates: d.candidates });
      b.target = null;
      return;
    }
    const taken = namesByParent.get(d.parent) ?? new Set();
    const base = (str(b.head.name) ?? 'ДОП').split(/\s+/).join(' ');
    let name = base;
    for (let k = 2; taken.has(name.toLowerCase()); k += 1) name = `${base} (${k})`;
    taken.add(name.toLowerCase());
    namesByParent.set(d.parent, taken);
    stats.maxDopPerParent = Math.max(stats.maxDopPerParent, taken.size);
    dops.push({
      temp_id: `dop_${num(b.head.pp_no)}`,
      parent_index: d.parent,
      work_name: name,
      unit_code: ctx.customerUnitOf(str(b.head.uom_customer)),
      manual_volume: num(b.head.qty_customer),
      manual_note: str(b.head.note_gp),
      how: d.how,
      key: d.key,
      section_no: str(b.head.section_no),
      parent_line: str(b.head.parent_line),
      candidates: d.candidates,
    });
    b.target = { kind: 'dop', index: dops.length - 1 };
  });
  stats.positions = positions.length;
  stats.dops = dops.length;

  const units = [];
  for (const b of blocks) {
    if (!b.target) continue;
    const blockUnit = b.target.kind === 'pos' ? positions[b.target.index].unit_code : dops[b.target.index].unit_code;
    const workVol = new Map();
    const items = [];
    for (const r of b.items) {
      const kind = r.row_type === 'Работа' ? 'work' : 'material';
      const name = (str(r.name) ?? '(без наименования)').split(/\s+/).join(' ');
      let unit = ctx.itemUnitOf(str(r.uom));
      if (!unit) {
        unit = ctx.nameUnit(kind, name) ?? blockUnit ?? null;
        stats.unitFallback += 1;
      }
      if (!unit) {
        unit = DEFAULT_UNIT; // наименованию единица обязательна (FK units)
        stats.unitDefault += 1;
      }
      const type = boqItemType(r);
      stats.types[type] = (stats.types[type] ?? 0) + 1;
      const amount = num(r.amount) ?? 0;
      stats.amount1c += amount;
      const price1c = num(r.price) ?? 0;
      if (Math.abs((num(r.volume) ?? 0) * price1c - amount) > 0.01) {
        stats.anomalies.push({ row: r._line, name, volume: num(r.volume), price: price1c, amount, reason: 'сумма ≠ объём × цена' });
      } else if (str(r.currency) && str(r.currency) !== 'RUB' && (num(r.price_currency) ?? 0) > 0 && price1c === 0 && (num(r.volume) ?? 0) > 0) {
        stats.anomalies.push({ row: r._line, name, volume: num(r.volume), price: price1c, amount, reason: `цена в ${str(r.currency)} есть, а в рублях 0 — в 1С курс версии был 0` });
      }
      const cost = ctx.costOf(str(r.cost_category));
      if (!cost) stats.noCost += 1;
      const common = {
        boq_item_type: type,
        kind,
        name,
        unit_code: unit,
        currency_type: str(r.currency) ?? 'RUB',
        quote_link: str(r.kp_source),
        quote_price_date: date(r.price_date),
        detail_cost_category_id: cost,
        total_amount: amount,
        row_index: r._line,
      };
      // Отрицательный объём (возврат, напр. «сдача металла»): количество в БД
      // обязано быть > 0 — знак переносим в цену, итог сохраняет знак 1С.
      const rawVolume = num(r.volume);
      const sign = rawVolume !== null && rawVolume < 0 ? -1 : 1;
      if (sign < 0) stats.negative += 1;
      const volume = rawVolume === null ? null : Math.abs(rawVolume);
      if (kind === 'work') {
        workVol.set(num(r.pp_no), volume);
        const q = posNum(volume);
        if (q === null) stats.zeroQty += 1;
        items.push({
          ...common,
          temp_id: `w_${num(r.pp_no)}`,
          quantity: q,
          base_quantity: q,
          unit_rate: sign * (num(r.price_currency) ?? num(r.price) ?? 0),
          description: joinNotes(r.note_work, r.note_su10),
        });
        stats.works += 1;
      } else {
        const parentPp = num(r.parent_work_pp_no);
        const wv = parentPp !== null && workVol.has(parentPp) ? workVol.get(parentPp) : null;
        const q = materialQuantities(volume, wv, num(r.coef_convert), num(r.coef_consume));
        if (q.linked) stats.linked += 1; else stats.unlinked += 1;
        if (q.folded) { if (q.linked) stats.foldedLinked += 1; else stats.foldedUnlinked += 1; }
        if (q.quantity === null) stats.zeroQty += 1;
        const dw = DELIVERY[str(r.delivery_where)?.toLowerCase()] ?? 'в цене';
        stats.delivery[dw] = (stats.delivery[dw] ?? 0) + 1;
        items.push({
          ...common,
          parent_work_temp_id: q.linked ? `w_${parentPp}` : null,
          quantity: q.quantity,
          base_quantity: q.base_quantity,
          conversion_coefficient: q.conversion_coefficient,
          consumption_coefficient: q.consumption_coefficient,
          unit_rate: sign * materialUnitRate(r, dw),
          delivery_price_type: dw,
          delivery_amount: dw === 'суммой' ? sign * (num(r.delivery_amount) ?? 0) : null,
          material_type: str(r.material_kind) === 'Вспомогательный' ? 'вспомогат.' : 'основн.',
        });
        stats.materials += 1;
      }
    }
    stats.items += items.length;
    units.push({ target: b.target, items });
  }

  return { positions, dops, units, rates: versionRates(batch.rows), stats, nextDop: next };
};
