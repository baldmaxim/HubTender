// P0 frontend guard check (no test framework in repo — run via tsx):
//   npx tsx scripts/checks/fxGuard.check.mjs
//
// Проверяет, что при отсутствующем валютном курсе frontend-хелперы НЕ возвращают
// 0: calculateBoqItemTotalAmount кидает MissingFXRateError, safeTotalAmount даёт
// null, getMissingFXRates видит валюту. RUB считается без курса.

import assert from 'node:assert/strict';
import {
  calculateBoqItemTotalAmount,
  MissingFXRateError,
} from '../../src/utils/boq/calculateBoqAmount.ts';
import {
  safeTotalAmount,
  getMissingFXRates,
} from '../../src/utils/boq/currencyGuard.ts';

const usdItem = { boq_item_type: 'раб', quantity: 2, unit_rate: 100, currency_type: 'USD' };
const eurItem = { boq_item_type: 'раб', quantity: 1, unit_rate: 50, currency_type: 'EUR' };
const rubItem = { boq_item_type: 'раб', quantity: 10, unit_rate: 5, currency_type: 'RUB' };

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('  ok —', name); };

console.log('fxGuard.check:');

check('USD без курса → throw MissingFXRateError (не 0)', () => {
  assert.throws(() => calculateBoqItemTotalAmount(usdItem, {}), MissingFXRateError);
});

check('safeTotalAmount(USD без курса) === null (не 0)', () => {
  const v = safeTotalAmount(usdItem, {});
  assert.equal(v, null);
  assert.notEqual(v, 0);
});

check('safeTotalAmount(USD, курс 90) === 18000', () => {
  assert.equal(safeTotalAmount(usdItem, { usd_rate: 90 }), 18000);
});

check('RUB считается без курса → 50', () => {
  assert.equal(calculateBoqItemTotalAmount(rubItem, {}), 50);
});

check('нулевой курс USD трактуется как отсутствующий → null', () => {
  assert.equal(safeTotalAmount(usdItem, { usd_rate: 0 }), null);
});

check('getMissingFXRates видит USD и EUR', () => {
  const missing = getMissingFXRates([usdItem, eurItem, rubItem], {});
  assert.deepEqual([...missing].sort(), ['EUR', 'USD']);
});

check('getMissingFXRates пусто, когда курсы заданы', () => {
  const missing = getMissingFXRates([usdItem, eurItem], { usd_rate: 90, eur_rate: 100 });
  assert.equal(missing.length, 0);
});

console.log(`\nfxGuard.check: ${passed} assertions passed`);
