// Тесты сборки данных для модели: node --test scripts/ai-review/test/payload.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBatch, packBatches, selectRows, clip, estimateTokens, MAX_ROWS_PER_POSITION } from '../lib/payload.mjs';

// Пример из разбора «Большой Татарской»: утеплитель двумя слоями.
const insulation = () => ({
  position: {
    id: 'pos-1', itemNo: '16.3', customerName: 'Утепление стен минплитой, толщина 150 мм',
    unit: 'м2', customerVolume: '102.61', gpVolume: '102.61',
    rows: [
      { id: 'w1', type: 'раб', name: 'Монтаж утеплителя', unit: 'м2', quantity: '102.61', unitRate: '900', total: '92349' },
      { id: 'm1', type: 'мат', name: 'ТЕХНОФАС ОПТИМА', unit: 'м3', quantity: '5.900075',
        conversionCoefficient: '0.05', consumptionCoefficient: '1.15', unitRate: '9068', total: '53502', parentWorkId: 'w1' },
      { id: 'm2', type: 'мат', name: 'ТЕХНОФАС ОПТИМА', unit: 'м3', quantity: '11.80015',
        conversionCoefficient: '0.1', consumptionCoefficient: '1.15', unitRate: '9068', total: '107004', parentWorkId: 'w1' },
    ],
  },
  findings: [
    { id: 'find-1', ruleCode: 'GA', ruleTitle: 'Дубль материала', detail: 'ТЕХНОФАС ОПТИМА заведён 2 раза',
      entityType: 'boq_item', entityId: 'm1', fingerprint: 'fp1' },
    { id: 'find-2', ruleCode: 'QA', ruleTitle: 'Нулевая цена', detail: 'без цены',
      entityType: 'client_position', entityId: 'pos-1', fingerprint: 'fp2' },
  ],
});

test('псевдонимы, факты и скрытие внутренних id', () => {
  const p = prepareBatch([insulation()]);
  const lines = p.text.split('\n');
  assert.ok(lines.includes('f1 | GA | r2 | ТЕХНОФАС ОПТИМА заведён 2 раза'));
  assert.ok(lines.includes('f2 | QA | | без цены'));
  assert.ok(lines.includes('r2 | мат | ТЕХНОФАС ОПТИМА | м3 | 5.900075 | 0.05 | 1.15 | 9068 | 53502 | r1'));
  assert.equal(p.facts['r2.bound_to_work'], 'r1');
  assert.equal(p.facts['r3.conversion_coefficient'], '0.1');
  assert.ok(p.facts['p1.customer_name']);
  assert.equal(p.facts['f1.detail'], 'ТЕХНОФАС ОПТИМА заведён 2 раза');
  for (const id of ['pos-1', 'find-1', 'find-2', 'w1', 'm1', 'm2']) {
    assert.ok(!p.text.includes(id), `внутренний id ${id} в тексте`);
  }
  assert.deepEqual(p.findingRefs, { f1: 'find-1', f2: 'find-2' });
  assert.deepEqual(p.positionRefs, { p1: 'pos-1' });
  assert.deepEqual(p.rowRefs, { r1: 'w1', r2: 'm1', r3: 'm2' });
  assert.equal(p.estimatedTokens, estimateTokens(p.text));
});

test('формат text: правила один раз, шапка колонок, пустые колонки скрыты', () => {
  const b = insulation();
  b.findings[0].ruleSummary = 'Один материал заведён несколько раз.';
  const { text } = prepareBatch([b]);
  assert.equal(text, [
    'Правила:',
    'GA — Дубль материала. Один материал заведён несколько раз.',
    'QA — Нулевая цена.',
    '',
    '## p1',
    'item_no: 16.3',
    'customer_name: Утепление стен минплитой, толщина 150 мм',
    'unit: м2',
    'customer_volume: 102.61',
    'gp_volume: 102.61',
    'rows: ref | type | name | unit | quantity | conversion_coefficient | consumption_coefficient | unit_rate | total | bound_to_work',
    'r1 | раб | Монтаж утеплителя | м2 | 102.61 | | | 900 | 92349 |',
    'r2 | мат | ТЕХНОФАС ОПТИМА | м3 | 5.900075 | 0.05 | 1.15 | 9068 | 53502 | r1',
    'r3 | мат | ТЕХНОФАС ОПТИМА | м3 | 11.80015 | 0.1 | 1.15 | 9068 | 107004 | r1',
    'findings: ref | rule | row | detail',
    'f1 | GA | r2 | ТЕХНОФАС ОПТИМА заведён 2 раза',
    'f2 | QA | | без цены',
  ].join('\n'));
});

test('пустой пакет и позиция без находок — ошибка', () => {
  assert.throws(() => prepareBatch([]), /пустой пакет/);
  assert.throws(() => prepareBatch([{ ...insulation(), findings: [] }]), /пустой пакет/);
});

test('усечение > 60 строк сохраняет строку находки и её работу', () => {
  const b = insulation();
  const rows = [];
  for (let i = 0; i < 100; i += 1) rows.push({ id: `x${i}`, type: 'мат', name: `Прочее ${i}` });
  rows.push({ id: 'w1', type: 'раб', name: 'Монтаж' }, { id: 'm1', type: 'мат', name: 'Плита', parentWorkId: 'w1' });
  b.position.rows = rows;
  const p = prepareBatch([b]);
  assert.equal(Object.keys(p.rowRefs).length, MAX_ROWS_PER_POSITION);
  assert.match(p.text, /rows_omitted: 42\n/);
  const f1 = p.text.split('\n').find((l) => l.startsWith('f1 |'));
  assert.match(f1, /^f1 \| GA \| r\d+ \|/);
  assert.ok(Object.values(p.rowRefs).includes('w1'), 'работа выпала');
  assert.ok(Object.values(p.rowRefs).includes('m1'), 'строка находки выпала');
  // исходный порядок сохранён: x0… идут перед w1, m1
  assert.equal(p.rowRefs.r1, 'x0');
  assert.equal(p.rowRefs.r59, 'w1');
  assert.equal(p.rowRefs.r60, 'm1');
});

test('selectRows: до 60 строк — все как есть', () => {
  const b = insulation();
  assert.equal(selectRows(b.position, b.findings).length, 3);
});

test('две позиции в одном запросе: сквозные псевдонимы', () => {
  const second = {
    position: {
      id: 'pos-2', itemNo: '17', customerName: 'Штукатурка',
      rows: [
        { id: 'w1', type: 'раб', name: 'Штукатурка стен', unit: 'м2', quantity: '10' },
        { id: 'z1', type: 'мат', name: 'Смесь', unit: 'кг', quantity: '5', parentWorkId: 'w1' },
        { id: 'zz', type: 'мат', name: 'Другая', parentWorkId: 'w-other' },
      ],
    },
    findings: [{ id: 'find-3', ruleCode: 'GA', ruleTitle: 'Дубль материала', detail: 'дубль', entityType: 'boq_item', entityId: 'z1' }],
  };
  const p = prepareBatch([insulation(), second]);
  assert.deepEqual(p.positionRefs, { p1: 'pos-1', p2: 'pos-2' });
  assert.deepEqual(p.rowRefs, { r1: 'w1', r2: 'm1', r3: 'm2', r4: 'w1', r5: 'z1', r6: 'zz' });
  assert.deepEqual(p.findingRefs, { f1: 'find-1', f2: 'find-2', f3: 'find-3' });
  assert.equal(p.facts['p2.customer_name'], 'Штукатурка');
  assert.equal(p.facts['r5.name'], 'Смесь');
  assert.equal(p.facts['r5.bound_to_work'], 'r4');
  assert.equal(p.facts['r6.bound_to_work'], undefined, 'работа не из выборки');
  assert.equal(p.facts['f3.detail'], 'дубль');
  assert.equal(p.text.split('## p').length - 1, 2);
  assert.equal(p.text.split('\n\n## p2')[1].startsWith('\nitem_no: 17'), true);
  // правило GA описано один раз
  assert.equal(p.text.split('\n').filter((l) => l.startsWith('GA —')).length, 1);
  assert.ok(p.text.includes('f3 | GA | r5 | дубль'));
});

test('находка P по материалу справочника: строка берётся из itemId', () => {
  const b = insulation();
  b.findings = [{ id: 'find-p', ruleCode: 'P', ruleTitle: 'Цена выбивается', detail: 'цена далеко от медианы',
    entityType: 'material_name', entityId: 'ТЕХНОФАС ОПТИМА', itemId: 'm2' }];
  assert.ok(prepareBatch([b]).text.includes('f1 | P | r3 | цена далеко от медианы'));

  const rows = [];
  for (let i = 0; i < 100; i += 1) rows.push({ id: `x${i}`, type: 'мат', name: `Прочее ${i}` });
  rows.push({ id: 'm2', type: 'мат', name: 'Плита' });
  b.position.rows = rows;
  const p = prepareBatch([b]);
  assert.equal(Object.keys(p.rowRefs).length, MAX_ROWS_PER_POSITION);
  assert.ok(Object.values(p.rowRefs).includes('m2'));
  const ref = Object.keys(p.rowRefs).find((k) => p.rowRefs[k] === 'm2');
  assert.ok(p.text.includes(`f1 | P | ${ref} | цена далеко от медианы`));
});

test('общая колонка выносится в rows_common, пустая не выводится', () => {
  const b = insulation();
  for (const r of b.position.rows) r.currency = 'RUB';
  const p = prepareBatch([b]);
  assert.ok(p.text.includes('rows_common: currency = RUB'));
  const header = p.text.split('\n').find((l) => l.startsWith('rows:'));
  assert.ok(!header.includes('currency'));
  assert.ok(!header.includes('cost_category'));
  assert.ok(!header.includes('description'));
  assert.equal(p.facts['r2.currency'], 'RUB');
  assert.equal(p.facts['r1.currency'], 'RUB');
});

test('одна строка: общие колонки не выделяются', () => {
  const b = insulation();
  b.position.rows = [{ id: 'w1', type: 'раб', name: 'Монтаж', currency: 'RUB' }];
  const p = prepareBatch([b]);
  assert.ok(!p.text.includes('rows_common'));
  assert.ok(p.text.includes('r1 | раб | Монтаж | RUB'));
});

test('«|» и перевод строки в наименовании очищены в тексте и в факте', () => {
  const b = insulation();
  b.position.rows[0].name = 'Монтаж | утеплителя\nв  два\tслоя';
  const p = prepareBatch([b]);
  assert.equal(p.facts['r1.name'], 'Монтаж / утеплителя в два слоя');
  assert.ok(p.text.includes('r1 | раб | Монтаж / утеплителя в два слоя | м2'));
});

test('длинное наименование с эмодзи режется по символам, а не по UTF-16', () => {
  const b = insulation();
  b.position.rows[0].name = '😀'.repeat(450);
  const p = prepareBatch([b]);
  const name = p.facts['r1.name'];
  assert.equal(Array.from(name).length, 401);
  assert.ok(name.endsWith('…'));
  assert.equal(Array.from(name).slice(0, 400).join(''), '😀'.repeat(400));
  assert.equal(clip('  ab  '), 'ab');
});

test('числа вместо строк: String(v), null → пусто', () => {
  const b = insulation();
  b.position.rows[0].quantity = 102.61;
  b.position.rows[0].total = null;
  const p = prepareBatch([b]);
  assert.equal(p.facts['r1.quantity'], '102.61');
  assert.equal(p.facts['r1.total'], undefined);
});

test('packBatches: бюджет, maxFindings, крупная позиция отдельно, порядок сохранён', () => {
  const small = (n) => ({
    position: { id: `s${n}`, customerName: `Позиция ${n}`, rows: [{ id: `r${n}`, type: 'мат', name: 'Материал' }] },
    findings: [{ id: `f${n}`, ruleCode: 'QA', ruleTitle: 'Нулевая цена', detail: 'без цены', entityType: 'boq_item', entityId: `r${n}` }],
  });
  const big = () => {
    const b = small(99);
    b.position.rows = Array.from({ length: 50 }, (_, i) => ({ id: `b${i}`, type: 'мат', name: `Длинное наименование материала номер ${i}`, quantity: '123.456' }));
    return b;
  };
  const items = [small(1), small(2), small(3), small(4)];
  const one = prepareBatch([items[0]]).estimatedTokens;

  assert.deepEqual(packBatches(items).map((g) => g.length), [4]);
  assert.deepEqual(packBatches(items, { maxFindings: 3 }).map((g) => g.length), [3, 1]);
  assert.deepEqual(packBatches(items, { budgetTokens: one * 2 + 1 }).map((g) => g.length), [2, 2]);

  const mixed = [small(1), big(), small(2), small(3)];
  const bigTokens = prepareBatch([mixed[1]]).estimatedTokens;
  assert.ok(bigTokens > one * 3);
  const groups = packBatches(mixed, { budgetTokens: bigTokens - 1 });
  assert.deepEqual(groups.map((g) => g.map((i) => i.position.id)), [['s1'], ['s99'], ['s2', 's3']]);
  assert.deepEqual(packBatches([]), []);
});

test('estimateTokens: цифры по одной, остальное по 3 символа', () => {
  assert.equal(estimateTokens('12345'), 5);
  assert.equal(estimateTokens('abcd'), 2);
  assert.equal(estimateTokens('a1'), 2);
});

test('packBatches: perFindingTokens добавляется к оценке позиции за каждую находку', () => {
  const mk = (n, findings) => ({
    position: { id: `s${n}`, customerName: `Позиция ${n}`, rows: [{ id: `r${n}`, type: 'мат', name: 'Материал' }] },
    findings: Array.from({ length: findings }, (_, i) => ({ id: `f${n}-${i}`, ruleCode: 'QA', detail: 'без цены', entityType: 'boq_item', entityId: `r${n}` })),
  });
  const items = [mk(1, 1), mk(2, 1), mk(3, 1)];
  const one = prepareBatch([items[0]]).estimatedTokens;
  const budget = one * 2 + 1;
  assert.deepEqual(packBatches(items, { budgetTokens: budget }).map((g) => g.length), [2, 1]);
  // С резервом 200 на находку две позиции уже не помещаются в тот же бюджет.
  assert.deepEqual(packBatches(items, { budgetTokens: budget, perFindingTokens: 200 }).map((g) => g.length), [1, 1, 1]);
  // Позиция с тремя находками стоит втрое больше резерва.
  const heavy = [mk(1, 3), mk(2, 1)];
  const est = prepareBatch([heavy[0]]).estimatedTokens;
  assert.deepEqual(packBatches(heavy, { budgetTokens: est + 600, perFindingTokens: 200 }).map((g) => g.length), [1, 1]);
});
