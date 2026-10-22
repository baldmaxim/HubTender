import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError } from '../lib/env.mjs';
import {
  adaptFinding,
  adaptPosition,
  adaptRow,
  findingLink,
  groupRowsByPosition,
  loadFindings,
  loadPositions,
  resolveTender,
} from '../lib/tender.mjs';

const UUID = '11111111-2222-3333-4444-555555555555';
const BRIEF = [
  { id: UUID, tender_number: '256', title: 'Ода', client_name: 'К', version: 1 },
  { id: 'id-256-3', tender_number: '256 ', title: 'Ода', client_name: 'К', version: 3 },
  { id: 'id-256-2', tender_number: '256', title: 'Ода', client_name: 'К', version: 2 },
  { id: 'id-2560', tender_number: '2560', title: 'Другой', client_name: 'К', version: 1 },
  { id: 'id-77-a', tender_number: '77', title: 'Дубль А', client_name: 'К', version: 1 },
  { id: 'id-77-b', tender_number: '77', title: 'Дубль Б', client_name: 'К', version: 1 },
];

/** Заглушка портала: search фильтрует по вхождению в номер. */
const fakePortal = (calls = []) => ({
  baseUrl: 'https://gp.su10.ru',
  get: async (path, query) => {
    calls.push({ path, query });
    if (path === '/api/v1/tenders/brief') {
      const search = query?.search;
      return search ? BRIEF.filter((t) => t.tender_number.includes(search)) : BRIEF;
    }
    throw new Error(`неожиданный путь ${path}`);
  },
});

test('resolveTender: uuid, номер (макс. версия), номер с версией (регистр v не важен)', async () => {
  const calls = [];
  const portal = fakePortal(calls);
  assert.deepEqual(await resolveTender(portal, UUID.toUpperCase()), { id: UUID, number: '256', version: 1, title: 'Ода' });
  assert.deepEqual(calls[0].query, undefined);

  const latest = await resolveTender(portal, '256');
  assert.deepEqual(latest, { id: 'id-256-3', number: '256', version: 3, title: 'Ода' });
  assert.equal(calls.at(-1).query.search, '256');

  assert.equal((await resolveTender(portal, '256v2')).id, 'id-256-2');
  assert.equal((await resolveTender(portal, '256V1')).id, UUID);
  assert.equal(calls.at(-1).query.search, '256');
});

test('resolveTender: нет такой версии, нет тендера, неоднозначность — понятные ошибки', async () => {
  const portal = fakePortal();
  await assert.rejects(resolveTender(portal, '256v9'), (err) => err instanceof ConfigError && /нет версии 9\. Есть версии: 1, 3, 2/.test(err.message));
  await assert.rejects(resolveTender(portal, '999'), (err) => err instanceof ConfigError && /не найден/.test(err.message));
  await assert.rejects(resolveTender(portal, '11111111-2222-3333-4444-000000000000'), /не найден/);
  await assert.rejects(resolveTender(portal, '77'), (err) => /неоднозначен/.test(err.message) && /Дубль А/.test(err.message) && /Дубль Б/.test(err.message));
  await assert.rejects(resolveTender(portal, ''), ConfigError);
});

test('адаптер строки: числа → строки, округление total, имя, категория', () => {
  const row = adaptRow({
    id: 'r1', client_position_id: 'p1', sort_number: 2, boq_item_type: 'мат', unit_code: 'м3',
    quantity: 5.900075, conversion_coefficient: 0.05, consumption_coefficient: 1.15, unit_rate: 9068,
    total_amount: 53502.456, currency_type: 'RUB', description: null, parent_work_item_id: 'w1',
    work_names: null, material_names: { name: 'ТЕХНОФАС', unit: 'м3' },
    detail_cost_categories: { name: 'Утепление', location: 'Фасад', cost_categories: { name: 'Отделка' } },
  });
  assert.deepEqual(row, {
    id: 'r1', type: 'мат', name: 'ТЕХНОФАС', unit: 'м3', quantity: '5.900075', conversionCoefficient: '0.05',
    consumptionCoefficient: '1.15', unitRate: '9068', currency: 'RUB', total: '53502.46', parentWorkId: 'w1',
    costCategory: 'Отделка / Утепление / Фасад', description: '',
  });
  const work = adaptRow({ id: 'w', work_names: { name: 'Монтаж', unit: 'м2' }, material_names: null, total_amount: null, detail_cost_categories: null });
  assert.equal(work.name, 'Монтаж');
  assert.equal(work.total, '');
  assert.equal(work.costCategory, '');
  assert.equal(work.quantity, '');
  assert.equal(adaptRow({ id: 'x', total_amount: 10.005 }).total, '10.01');
  assert.equal(adaptRow({ id: 'x', total_amount: 100 }).total, '100');
});

test('порядок строк: sort_number по возрастанию, null в конце, затем created_at и id', () => {
  const mk = (id, sort, created) => ({ id, client_position_id: 'p1', sort_number: sort, created_at: created });
  const rows = groupRowsByPosition([
    mk('e', null, '2026-01-02'),
    mk('d', null, '2026-01-01'),
    mk('c', 2, '2026-05-01'),
    mk('a', 1, '2026-05-02'),
    mk('b', 1, '2026-05-02'),
    { ...mk('z', 1, '2026-05-02'), client_position_id: 'p2' },
  ]);
  assert.deepEqual(rows.get('p1').map((r) => r.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(rows.get('p2').map((r) => r.id), ['z']);
});

test('адаптер позиции: номер из position_number, если нет item_no', () => {
  const pos = adaptPosition(
    { id: 'p1', position_number: 12, work_name: 'Утепление', unit_code: 'м2', volume: 102.61, item_no: null, manual_volume: 100, manual_note: 'прим', client_note: null },
    [],
  );
  assert.deepEqual(pos, {
    id: 'p1', itemNo: '12', customerName: 'Утепление', unit: 'м2', customerVolume: '102.61', gpVolume: '100',
    gpNote: 'прим', clientNote: '', rows: [],
  });
  assert.equal(adaptPosition({ id: 'p2', position_number: 3, item_no: '3.1' }).itemNo, '3.1');
});

const RAW = {
  rule_code: 'P', rule_title: 'Цена далека от медианы', severity: 'high', summary: 'краткое', tender_id: 't1',
  position_number: 12, item_no: '12.3', entity_type: 'material_name', entity_id: 'mat-1', position_id: null,
  item_id: 'row-9', fingerprint: 'fp', detail: 'цена 125', money_delta: 1200, verdict: null, finding_id: 'fnd-1',
};

test('адаптер находки: id, сводка из каталога, позиция по строке item_id', () => {
  const rules = new Map([['P', { summary: 'Из каталога' }]]);
  const rowPositionById = new Map([['row-9', 'pos-9']]);
  const f = adaptFinding(RAW, { rules, rowPositionById });
  assert.equal(f.id, 'fnd-1');
  assert.equal(f.ruleSummary, 'Из каталога');
  assert.equal(f.positionId, 'pos-9');
  assert.equal(f.itemId, 'row-9');
  assert.equal(f.moneyDelta, 1200);
  assert.equal(f.positionNumber, 12);
  assert.equal(f.itemNoApi, '12.3');

  const noId = adaptFinding({ ...RAW, finding_id: null, position_id: 'pos-1', item_id: null }, {});
  assert.equal(noId.id, 'P|mat-1');
  assert.equal(noId.ruleSummary, 'краткое'); // нет каталога — сводка находки
  assert.equal(noId.positionId, 'pos-1');

  const onPosition = adaptFinding({ ...RAW, entity_type: 'client_position', entity_id: 'pos-5', item_id: null }, {});
  assert.equal(onPosition.positionId, 'pos-5');
  const tender = adaptFinding({ ...RAW, entity_type: 'tender', entity_id: 't1', item_id: null }, {});
  assert.equal(tender.positionId, undefined);
});

test('findingLink: позиция и строка, как в веб-интерфейсе', () => {
  const base = 'https://gp.su10.ru';
  assert.equal(
    findingLink(base, 't1', { entityType: 'boq_item', entityId: 'row-1', positionId: 'pos-1' }),
    'https://gp.su10.ru/positions/pos-1/items?tenderId=t1&positionId=pos-1&itemId=row-1',
  );
  assert.equal(
    findingLink(base, 't1', { entityType: 'client_position', entityId: 'pos-2' }),
    'https://gp.su10.ru/positions/pos-2/items?tenderId=t1&positionId=pos-2',
  );
  assert.equal(
    findingLink(base, 't1', { entityType: 'material_name', entityId: 'm', positionId: 'pos-3', itemId: 'row-3' }),
    'https://gp.su10.ru/positions/pos-3/items?tenderId=t1&positionId=pos-3&itemId=row-3',
  );
  assert.equal(findingLink(base, 't1', { entityType: 'tender', entityId: 't1' }), null);
  assert.equal(findingLink(base, 't1', { entityType: 'material_name', entityId: 'm' }), null);
});

test('loadFindings: open_only всегда, остальные параметры по флагам; loadPositions: все страницы', async () => {
  const calls = [];
  const portal = {
    get: async (path, query, opts) => {
      calls.push({ path, query, opts });
      if (path.endsWith('/quality')) return { findings: [{ rule_code: 'U' }], errors: [{ rule_code: 'V', message: 'сбой' }], generated_at: 'x' };
      if (!query.cursor) return { data: [{ id: 'a' }, { id: 'b' }], next_cursor: 'c1' };
      if (query.cursor === 'c1') return { data: [{ id: 'c' }], next_cursor: 'c2' };
      return { data: [{ id: 'd' }] };
    },
  };
  const report = await loadFindings(portal, 't1', { rules: ['U', 'V'], onlyNew: true, refresh: true });
  assert.deepEqual(calls[0].query, { open_only: 1, only_new: 1, rule: 'U,V', refresh: 1 });
  assert.equal(report.findings.length, 1);
  assert.deepEqual(report.errors, [{ rule_code: 'V', message: 'сбой' }]);

  await loadFindings(portal, 't1');
  assert.deepEqual(calls[1].query, { open_only: 1, only_new: undefined, rule: undefined, refresh: undefined });

  const positions = await loadPositions(portal, 't1');
  assert.deepEqual(positions.map((p) => p.id), ['a', 'b', 'c', 'd']);
  assert.equal(calls.at(-1).opts.raw, true);
  assert.equal(calls.at(-1).query.limit, 200);
});
