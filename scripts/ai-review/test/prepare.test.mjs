import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describePosition, positionCost, selectRemarkPositions } from '../lib/prepare.mjs';

/** Позиция со строками на заданные суммы (total — строкой, как отдаёт адаптер). */
const pos = (id, totals, extra = {}) => ({
  id, itemNo: id, customerName: `Позиция ${id}`,
  rows: totals.map((t, i) => ({ id: `${id}-r${i}`, name: `Строка ${i}`, total: t === null ? '' : String(t) })),
  ...extra,
});

const ids = (result) => result.items.map((i) => i.position.id);

test('positionCost: сумма total, нечисловые не учитываются', () => {
  assert.equal(positionCost(pos('a', [10, 5.5, null])), 15.5);
  assert.equal(positionCost({ id: 'x', rows: [{ total: 'abc' }, { total: '3' }, { total: undefined }] }), 3);
  assert.equal(positionCost({ id: 'x' }), 0);
});

test('selectRemarkPositions: дорогие позиции до 80 % стоимости, позиция, пересекающая порог, берётся', () => {
  // 50 + 30 + 10 + 5 + 5 = 100 → после 50 и 30 накоплено ровно 80 % — следующая уже не нужна.
  const positions = [pos('c', [10]), pos('a', [50]), pos('e', [5]), pos('b', [30]), pos('d', [5])];
  const result = selectRemarkPositions(positions, new Set(), { limit: 100 });
  assert.deepEqual(ids(result), ['a', 'b']);
  assert.ok(Math.abs(result.coverage - 0.8) < 1e-9);
  assert.deepEqual(result.items[0], { position: positions[1], findings: [] });
  // 50 + 25 + 25 = 100: 50 < 80 %, берём вторую (75 % < 80 %), берём третью.
  assert.deepEqual(ids(selectRemarkPositions([pos('a', [50]), pos('b', [25]), pos('c', [25])], new Set(), { limit: 10 })), ['a', 'b', 'c']);
});

test('selectRemarkPositions: исключённые участвуют в накоплении, но не берутся; coverage их учитывает', () => {
  const positions = [pos('a', [50]), pos('b', [30]), pos('c', [10]), pos('d', [10])];
  const result = selectRemarkPositions(positions, new Set(['a']), { limit: 100 });
  // накопление: a (50) → b (80) → стоп; a исключена
  assert.deepEqual(ids(result), ['b']);
  assert.ok(Math.abs(result.coverage - 0.8) < 1e-9);
  const noMore = selectRemarkPositions(positions, new Set(['a', 'b']), { limit: 100 });
  assert.deepEqual(ids(noMore), []);
  assert.ok(Math.abs(noMore.coverage - 0.8) < 1e-9);
});

test('selectRemarkPositions: limit обрезает после исключения, порядок по стоимости', () => {
  const positions = Array.from({ length: 10 }, (_, i) => pos(`p${i}`, [10]));
  const result = selectRemarkPositions(positions, new Set(['p0']), { limit: 3 });
  assert.equal(result.items.length, 3);
  assert.ok(Math.abs(result.coverage - 0.4) < 1e-9); // p0 (исключена) + три отобранных из 10
  assert.deepEqual(ids(selectRemarkPositions(positions, new Set(), { limit: 0 })), []);
});

test('selectRemarkPositions: позиции без строк и без стоимости не кандидаты; при all берутся все со строками', () => {
  const positions = [pos('a', [100]), pos('free', [0]), pos('empty', []), pos('blank', [null]), pos('b', [1])];
  assert.deepEqual(ids(selectRemarkPositions(positions, new Set(), { limit: 10 })), ['a']);
  const all = selectRemarkPositions(positions, new Set(['b']), { all: true, limit: 1 });
  assert.deepEqual(ids(all), ['a', 'blank', 'free']); // без потолка и порога, без позиций без строк и исключённых
  assert.equal(all.coverage, 1);
  assert.deepEqual(selectRemarkPositions([], new Set(), { limit: 5 }), { items: [], coverage: 0 });
});

test('selectRemarkPositions: равные стоимости — по номеру позиции, затем по id', () => {
  const positions = [pos('c', [10]), pos('b', [10]), pos('a', [10]), pos('d', [10])];
  const positionNumbers = new Map([['a', 7], ['b', 3], ['c', 3]]);
  const result = selectRemarkPositions(positions, new Set(), { all: true, positionNumbers });
  assert.deepEqual(ids(result), ['b', 'c', 'a', 'd']); // 3, 3 (b < c по id), 7, без номера
});

test('describePosition: имя строки или наименование заказчика', () => {
  const p = pos('p1', [1, 2]);
  assert.equal(describePosition(p, 'p1-r1'), 'поз. p1 «Строка 1»');
  assert.equal(describePosition(p, null), 'поз. p1 «Позиция p1»');
  assert.equal(describePosition(p, 'нет такой'), 'поз. p1 «Позиция p1»');
});
