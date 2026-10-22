// Тесты проверки ответа модели: node --test scripts/ai-review/test/validate.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBatch } from '../lib/payload.mjs';
import {
  validateAnswer, sameValue, InvalidResponseError,
  LABEL_LIKELY_ERROR, LABEL_LIKELY_OK, LABEL_UNSURE, MAX_EVIDENCE,
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
