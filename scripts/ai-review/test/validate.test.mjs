// Тесты проверки ответа модели: node --test scripts/ai-review/test/validate.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBatch } from '../lib/payload.mjs';
import {
  validateAnswer, validateRemarks, sameValue, InvalidResponseError,
  LABEL_LIKELY_ERROR, LABEL_LIKELY_OK, LABEL_UNSURE, MAX_EVIDENCE, MAX_REMARKS_PER_POSITION,
} from '../lib/validate.mjs';

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
    { id: 'find-1', ruleCode: 'GA', ruleTitle: 'Дубль материала', detail: 'ТЕХНОФАС ОПТИМА заведён 2 раза', entityType: 'boq_item', entityId: 'm1' },
    { id: 'find-2', ruleCode: 'QA', ruleTitle: 'Нулевая цена', detail: 'без цены', entityType: 'client_position', entityId: 'pos-1' },
  ],
});

test('validateAnswer: подтверждённые факты, дубли, чужие ссылки, пропущенные', () => {
  const p = prepareBatch([insulation()]);
  const answer = JSON.stringify({
    assessments: [
      { finding: 'f1', label: 'likely_ok', reason: 'Два слоя 50 + 100 мм = 150 мм',
        evidence: [
          { ref: 'r2.conversion_coefficient', value: '0.050' },
          { ref: 'r3.conversion_coefficient', value: '0.1' },
          { ref: 'p1.customer_name', value: 'Утепление стен минплитой, толщина 150 мм' },
          { ref: 'r9.quantity', value: '1' },
          { ref: 'r2.unit_rate', value: '1' },
        ] },
      { finding: 'f1', label: 'likely_error', reason: 'дубль', evidence: [] },
      { finding: 'f7', label: 'likely_error', reason: 'чужая', evidence: [] },
    ],
  });
  const { assessments, missing } = validateAnswer(answer, p);
  assert.equal(assessments.length, 1);
  assert.deepEqual(missing, ['find-2']);
  const a = assessments[0];
  assert.equal(a.findingId, 'find-1');
  assert.equal(a.label, LABEL_LIKELY_OK);
  assert.equal(a.evidence.length, 3);
  assert.equal(a.downgraded, false);
  assert.equal(a.basis, null);
  assert.equal(a.evidence[0].value, '0.05', 'сохраняется отправленное значение');
});

test('вывод с неверным значением понижается до «не уверен»; неизвестная метка — unsure', () => {
  const p = prepareBatch([insulation()]);
  const { assessments } = validateAnswer({
    assessments: [
      { finding: 'f1', label: 'likely_ok', reason: 'норма', evidence: [{ ref: 'r2.conversion_coefficient', value: '0.07' }] },
      { finding: 'f2', label: 'garbage', reason: 'x', evidence: [] },
    ],
  }, p);
  assert.equal(assessments[0].label, LABEL_UNSURE);
  assert.equal(assessments[0].downgraded, true);
  assert.equal(assessments[1].label, LABEL_UNSURE);
  assert.equal(assessments[1].downgraded, false);
});

test('не JSON, не объект и ответ без assessments — InvalidResponseError', () => {
  const p = prepareBatch([insulation()]);
  for (const bad of ['Вот ответ: норма', '[]', '"x"', 'null', '{}', '{"assessments":{}}', {}, null, []]) {
    assert.throws(() => validateAnswer(bad, p), InvalidResponseError, String(bad));
  }
  // JSON, обёрнутый в текст, не вырезается
  assert.throws(() => validateAnswer('Ответ: {"assessments":[]}', p), InvalidResponseError);
});

test('результат в числовом порядке f2, f10, f1 → f1, f2, f10', () => {
  const b = insulation();
  b.findings = Array.from({ length: 11 }, (_, i) => ({
    id: `id-${i + 1}`, ruleCode: 'QA', ruleTitle: 'Нулевая цена', detail: `д${i + 1}`, entityType: 'client_position', entityId: 'pos-1',
  }));
  const p = prepareBatch([b]);
  const mk = (n) => ({ finding: `f${n}`, label: 'unsure', reason: '', evidence: [] });
  const { assessments, missing } = validateAnswer({ assessments: [mk(2), mk(10), mk(1)] }, p);
  assert.deepEqual(assessments.map((a) => a.findingId), ['id-1', 'id-2', 'id-10']);
  assert.deepEqual(missing, ['id-3', 'id-4', 'id-5', 'id-6', 'id-7', 'id-8', 'id-9', 'id-11']);
});

test('basis: строка, ограничение длины, knownBasis', () => {
  const p = prepareBatch([insulation()]);
  const mk = (basis) => ({
    assessments: [{ finding: 'f1', label: 'unsure', reason: '', evidence: [], ...(basis === undefined ? {} : { basis }) }],
  });
  const basisOf = (basis, opts) => validateAnswer(mk(basis), p, opts).assessments[0].basis;
  assert.equal(basisOf('S1'), 'S1');
  assert.equal(basisOf('  S1 '), 'S1');
  assert.equal(basisOf(undefined), null);
  assert.equal(basisOf(5), null);
  assert.equal(basisOf(''), null);
  assert.equal(basisOf('x'.repeat(33)), null);
  assert.equal(basisOf('x'.repeat(32)), 'x'.repeat(32));
  assert.equal(basisOf('S1', { knownBasis: new Set(['S1', 'S2']) }), 'S1');
  assert.equal(basisOf('S9', { knownBasis: new Set(['S1', 'S2']) }), null);
});

test('reason режется до 500 символов по символам Unicode; evidence — не больше MAX_EVIDENCE', () => {
  const b = insulation();
  const p = prepareBatch([b]);
  const evidence = Object.keys(p.facts).map((ref) => ({ ref, value: p.facts[ref] }));
  assert.ok(evidence.length > MAX_EVIDENCE);
  const { assessments } = validateAnswer({
    assessments: [{ finding: ' f1 ', label: LABEL_LIKELY_ERROR, reason: `  ${'😀'.repeat(600)}`, evidence }],
  }, p);
  const a = assessments[0];
  assert.equal(Array.from(a.reason).length, 501);
  assert.ok(a.reason.endsWith('…'));
  assert.equal(a.evidence.length, MAX_EVIDENCE);
  assert.equal(a.label, LABEL_LIKELY_ERROR);
});

test('модель цитирует очищенное значение — ссылка подтверждается', () => {
  const b = insulation();
  b.position.rows[0].name = 'Монтаж | утеплителя\nв два слоя';
  const p = prepareBatch([b]);
  const { assessments } = validateAnswer({
    assessments: [{ finding: 'f1', label: LABEL_LIKELY_OK, reason: 'ok',
      evidence: [{ ref: 'r1.name', value: 'Монтаж / утеплителя в два слоя' }] }],
  }, p);
  assert.equal(assessments[0].label, LABEL_LIKELY_OK);
  assert.equal(assessments[0].evidence[0].value, 'Монтаж / утеплителя в два слоя');
});

test('ссылки на прототипные ключи не проходят', () => {
  const p = prepareBatch([insulation()]);
  const { assessments } = validateAnswer({
    assessments: [{ finding: 'constructor', label: LABEL_LIKELY_OK, reason: '', evidence: [{ ref: 'toString', value: 'x' }] }],
  }, p);
  assert.equal(assessments.length, 0);
});

test('sameValue: числа, разделители, запятая, текст', () => {
  assert.equal(sameValue('0.050', '0.05'), true);
  assert.equal(sameValue('0.05', '0.050'), true);
  assert.equal(sameValue('0,1', '0.1'), true);
  assert.equal(sameValue('92 349', '92349'), true);
  assert.equal(sameValue('92 349', '92349'), true);
  assert.equal(sameValue('92 349', '92349'), true);
  assert.equal(sameValue('92349', '92 349'), true);
  assert.equal(sameValue('0.05', 0.05), true);
  assert.equal(sameValue(' 0.05 ', '0.05'), true);
  assert.equal(sameValue('Утепление  стен', 'Утепление стен'), true);
  assert.equal(sameValue('Утепление стен', 'Утепление  стен'), true);
  assert.equal(sameValue('abc', 'abd'), false);
  assert.equal(sameValue('', '0'), false);
  assert.equal(sameValue('0', ''), false);
  assert.equal(sameValue('0.07', '0.05'), false);
  assert.equal(sameValue('', ''), true);
  assert.equal(sameValue('1e', '1'), false);
});

// --- validateRemarks ---------------------------------------------------------

const CODES = { remarkCodes: new Set(['AI-001', 'AI-002']), ruleCodes: new Set(['GA', 'QA']) };

/** Две позиции: p1 (утепление, строки r1–r3) и p2 (одна строка r4), без находок у p2. */
const twoPositions = () => {
  const other = { position: { id: 'pos-2', itemNo: '17', customerName: 'Штукатурка', rows: [{ id: 'z1', type: 'мат', name: 'Смесь', unit: 'кг' }] }, findings: [] };
  return prepareBatch([insulation(), other]);
};

const remark = (over = {}) => ({
  position: 'p1', row: 'r2', type: 'AI-001', title: '', detail: 'Толщина 150 мм, а в строке коэффициент 0.05',
  evidence: [{ ref: 'r2.conversion_coefficient', value: '0.050' }], ...over,
});

test('validateRemarks: верное замечание по типу навыка — title игнорируется, значение факта берётся отправленное', () => {
  const p = twoPositions();
  const { remarks, dropped } = validateRemarks([remark({ type: ' ai-001 ', title: 'не нужно' })], p, CODES);
  assert.equal(dropped, 0);
  assert.deepEqual(remarks, [{
    type: 'AI-001', title: '', positionId: 'pos-1', rowId: 'm1',
    detail: 'Толщина 150 мм, а в строке коэффициент 0.05', evidence: [{ ref: 'r2.conversion_coefficient', value: '0.05' }],
  }]);
  // row "" — замечание по позиции в целом
  const whole = validateRemarks([remark({ row: '', evidence: [{ ref: 'p1.customer_name', value: 'Утепление стен минплитой, толщина 150 мм' }] })], p, CODES);
  assert.equal(whole.remarks[0].rowId, null);
});

test('validateRemarks: не массив — не ошибка, замечаний нет', () => {
  const p = twoPositions();
  for (const bad of [undefined, null, 'x', {}, 5]) assert.deepEqual(validateRemarks(bad, p, CODES), { remarks: [], dropped: 0 });
  assert.deepEqual(validateRemarks([], p, CODES), { remarks: [], dropped: 0 });
  // и validateAnswer ответ без remarks по-прежнему принимает
  assert.equal(validateAnswer({ assessments: [] }, p).assessments.length, 0);
});

test('validateRemarks: чужая позиция, чужая строка, мусор — отбрасываются', () => {
  const p = twoPositions();
  const { remarks, dropped } = validateRemarks([
    remark({ position: 'p9' }),
    remark({ row: 'r4' }), // строка p2 в замечании по p1
    remark({ row: 'r99' }),
    remark({ position: 'constructor' }),
    'строка',
    null,
    remark({ position: 'p2', row: 'r4', evidence: [{ ref: 'r4.name', value: 'Смесь' }] }), // верное
  ], p, CODES);
  assert.equal(remarks.length, 1);
  assert.equal(remarks[0].positionId, 'pos-2');
  assert.equal(remarks[0].rowId, 'z1');
  assert.equal(dropped, 6);
});

test('validateRemarks: код скриптового правила — дубль, отбрасывается; NEW без title — тоже', () => {
  const p = twoPositions();
  const { remarks, dropped } = validateRemarks([
    remark({ type: 'GA' }),
    remark({ type: 'qa' }),
    remark({ type: 'NEW', title: '' }),
    remark({ type: 'AI-777', title: '   ' }), // неизвестный код = NEW, названия нет
    remark({ type: '', title: '' }),
  ], p, CODES);
  assert.deepEqual(remarks, []);
  assert.equal(dropped, 5);
});

test('validateRemarks: NEW с названием — тип NEW, title обрезается до 120 символов; неизвестный код тоже NEW', () => {
  const p = twoPositions();
  const { remarks } = validateRemarks([
    remark({ type: 'NEW', title: `  ${'я'.repeat(130)}` }),
    remark({ type: 'AI-777', title: 'Другой тип', row: '' }),
  ], p, CODES);
  assert.equal(remarks.length, 2);
  assert.equal(remarks[0].type, 'NEW');
  assert.equal(Array.from(remarks[0].title).length, 121);
  assert.ok(remarks[0].title.endsWith('…'));
  assert.equal(remarks[1].type, 'NEW');
  assert.equal(remarks[1].title, 'Другой тип');
});

test('validateRemarks: без подтверждённых фактов или без detail — отбрасывается; факты фильтруются', () => {
  const p = twoPositions();
  const { remarks, dropped } = validateRemarks([
    remark({ evidence: [] }),
    remark({ evidence: [{ ref: 'r2.conversion_coefficient', value: '0.07' }] }), // значение не то
    remark({ evidence: [{ ref: 'r2.nonexistent', value: '1' }] }),
    remark({ evidence: 'нет' }),
    remark({ detail: '   ' }),
    remark({ detail: undefined }),
    remark({ evidence: [{ ref: 'r2.conversion_coefficient', value: '0.07' }, { ref: 'r3.conversion_coefficient', value: '0.1' }, { ref: 'r3.conversion_coefficient', value: '0.1' }], row: 'r3' }),
  ], p, CODES);
  assert.equal(dropped, 6);
  assert.deepEqual(remarks[0].evidence, [{ ref: 'r3.conversion_coefficient', value: '0.1' }]);
});

test('validateRemarks: detail режется до 500 символов, evidence — до MAX_EVIDENCE', () => {
  const p = twoPositions();
  const evidence = Object.keys(p.facts).map((ref) => ({ ref, value: p.facts[ref] }));
  assert.ok(evidence.length > MAX_EVIDENCE);
  const { remarks } = validateRemarks([remark({ detail: '😀'.repeat(600), evidence })], p, CODES);
  assert.equal(Array.from(remarks[0].detail).length, 501);
  assert.equal(remarks[0].evidence.length, MAX_EVIDENCE);
});

test('validateRemarks: не больше 3 на позицию (первые по порядку), дубли отбрасываются', () => {
  const p = twoPositions();
  assert.equal(MAX_REMARKS_PER_POSITION, 3);
  const list = [
    remark({ type: 'AI-001' }),
    remark({ type: 'AI-001' }), // дубль: та же позиция, строка, тип и title
    remark({ type: 'AI-002' }),
    remark({ type: 'NEW', title: 'Один' }),
    remark({ type: 'NEW', title: 'Два' }), // четвёртое по позиции p1
    remark({ position: 'p2', row: 'r4', type: 'AI-001', evidence: [{ ref: 'r4.name', value: 'Смесь' }] }),
  ];
  const { remarks, dropped } = validateRemarks(list, p, CODES);
  assert.deepEqual(remarks.map((r) => `${r.positionId}:${r.type}${r.title ? `:${r.title}` : ''}`), ['pos-1:AI-001', 'pos-1:AI-002', 'pos-1:NEW:Один', 'pos-2:AI-001']);
  assert.equal(dropped, 2);
  // тот же тип в другой строке — не дубль
  const rows = validateRemarks([remark({ row: 'r2' }), remark({ row: 'r3', evidence: [{ ref: 'r3.conversion_coefficient', value: '0.1' }] })], p, CODES);
  assert.equal(rows.remarks.length, 2);
});
