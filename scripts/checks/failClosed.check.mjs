// P0 0.1.1 fail-closed frontend checks (no test framework in repo — run via tsx):
//   npx tsx scripts/checks/failClosed.check.mjs
//
// Проверяет, что при отсутствующем курсе агрегаторы возвращают «не рассчитано»
// (value=null + missingCurrencies), а НЕ частичную сумму / 0 / устаревшее.
// Плюс — обязательность multiplyFormat для multiply+markup на фронте.

import assert from 'node:assert/strict';
import {
  totalAmountFX,
  combineFX,
  dedupeCurrencies,
  getMissingFXRates,
  formatFXUnavailable,
} from '../../src/utils/boq/currencyGuard.ts';
import { validateMarkupSequence } from '../../src/utils/markupCalculator.ts';

const rub = { boq_item_type: 'раб', quantity: 10, unit_rate: 5, currency_type: 'RUB' };
const usdNoRate = { boq_item_type: 'раб', quantity: 1, unit_rate: 100, currency_type: 'USD' };
const eurNoRate = { boq_item_type: 'раб', quantity: 1, unit_rate: 50, currency_type: 'EUR' };

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('  ok —', name); };

console.log('failClosed.check:');

check('1. одна USD-строка без курса → unavailable (value=null), не 0', () => {
  const r = totalAmountFX(usdNoRate, {});
  assert.equal(r.value, null);
  assert.deepEqual(r.missingCurrencies, ['USD']);
});

check('2. агрегат RUB100 + USD-без-курса → unavailable, НЕ 100', () => {
  const r = combineFX([totalAmountFX(rub, {}), totalAmountFX(usdNoRate, {})]);
  assert.equal(r.value, null);
  assert.notEqual(r.value, 100);
  assert.deepEqual(r.missingCurrencies, ['USD']);
});

check('3. позиция с одной ошибочной строкой → нет частичного итога', () => {
  const position = combineFX([totalAmountFX(rub, {}), totalAmountFX(rub, {}), totalAmountFX(usdNoRate, {})]);
  assert.equal(position.value, null);
});

check('4. тендер с одной ошибочной позицией → нет частичного итога', () => {
  const posOk = combineFX([totalAmountFX(rub, {})]);           // 50
  const posBad = combineFX([totalAmountFX(usdNoRate, {})]);    // null
  const tender = combineFX([posOk, posBad]);
  assert.equal(tender.value, null);
});

check('5. missingCurrencies дедуплицируется', () => {
  const r = combineFX([totalAmountFX(usdNoRate, {}), totalAmountFX(usdNoRate, {}), totalAmountFX(eurNoRate, {})]);
  assert.deepEqual(r.missingCurrencies, ['USD', 'EUR']);
  assert.deepEqual(dedupeCurrencies(['EUR', 'USD', 'USD', 'CNY']), ['USD', 'EUR', 'CNY']);
});

check('6. сохранённый total_amount НЕ используется как live при отсутствующем курсе', () => {
  // totalAmountFX не имеет доступа к сохранённому total_amount и не подставляет его.
  const withStored = { ...usdNoRate, total_amount: 999999 };
  const r = totalAmountFX(withStored, {});
  assert.equal(r.value, null);
  assert.notEqual(r.value, 999999);
});

check('7. пред-скан экспорта видит отсутствующие курсы (экспорт не стартует)', () => {
  const missing = getMissingFXRates([rub, usdNoRate, eurNoRate], {});
  assert.deepEqual([...missing].sort(), ['EUR', 'USD']);
  assert.equal(formatFXUnavailable(missing), 'Расчёт недоступен: не задан курс USD и EUR');
});

check('8. RUB-строки считаются без курса', () => {
  const r = combineFX([totalAmountFX(rub, {}), totalAmountFX(rub, {})]);
  assert.equal(r.value, 100);
  assert.deepEqual(r.missingCurrencies, []);
});

// ── Markup validation (frontend, parity с backend) ──
const mkStep = (action, type, fmt, slot = 1) => {
  const s = { baseIndex: -1, action1: 'add', operand1Type: 'number', operand1Key: 1 };
  s[`action${slot}`] = action;
  s[`operand${slot}Type`] = type;
  s[`operand${slot}Key`] = 'm';
  if (fmt !== undefined) s[`operand${slot}MultiplyFormat`] = fmt;
  return s;
};

check('markup: operand1 multiply+markup без формата → ошибка', () => {
  assert.ok(validateMarkupSequence([{ baseIndex: -1, action1: 'multiply', operand1Type: 'markup', operand1Key: 'm' }]).length >= 1);
});

check('markup: operand2..5 multiply+markup без формата → ошибка', () => {
  for (const slot of [2, 3, 4, 5]) {
    assert.ok(validateMarkupSequence([mkStep('multiply', 'markup', undefined, slot)]).length >= 1, `operand${slot}`);
  }
});

check('markup: addOne / direct проходят', () => {
  assert.equal(validateMarkupSequence([{ baseIndex: -1, action1: 'multiply', operand1Type: 'markup', operand1Key: 'm', operand1MultiplyFormat: 'addOne' }]).length, 0);
  assert.equal(validateMarkupSequence([{ baseIndex: -1, action1: 'multiply', operand1Type: 'markup', operand1Key: 'm', operand1MultiplyFormat: 'direct' }]).length, 0);
});

check('markup: multiply+number без формата проходит', () => {
  assert.equal(validateMarkupSequence([{ baseIndex: -1, action1: 'multiply', operand1Type: 'number', operand1Key: 2 }]).length, 0);
});

check('markup: add+markup без формата проходит', () => {
  assert.equal(validateMarkupSequence([{ baseIndex: -1, action1: 'add', operand1Type: 'markup', operand1Key: 'm' }]).length, 0);
});

// ── Rounding parity with Go (audit §4). Same rule (half-away for positive) in
// both languages — mirrors backend rounding_parity_test.go. ──
check('rounding: Math.round — арифметическое (не банковское), паритет с Go', () => {
  for (const [inp, want] of [[0.5, 1], [1.5, 2], [2.5, 3], [3.5, 4]]) {
    assert.equal(Math.round(inp), want, `Math.round(${inp})`);
  }
  const roundTo5 = (v) => Math.round(v / 5) * 5; // зеркало calc.RoundTo5
  for (const [inp, want] of [[100.555, 100], [102.5, 105], [7.5, 10], [0.0049, 0]]) {
    assert.equal(roundTo5(inp), want, `roundTo5(${inp})`);
  }
});

// Parity anchor identical to backend TestParity_CanonicalFixtures (USD → 18000).
check('parity: FX совпадает с backend calc (18000)', () => {
  assert.equal(totalAmountFX({ boq_item_type: 'суб-раб', quantity: 2, unit_rate: 100, currency_type: 'USD' }, { usd_rate: 90 }).value, 18000);
});

console.log(`\nfailClosed.check: ${passed} assertions passed`);
