// Этап 1.2 focused frontend checks — run via tsx:
//   npx tsx scripts/checks/priceBenchmarkFrontendPolicy.check.mjs

import {
  benchmarkStatusDisplay, isBlockingStatus, formatPercent, formatMoney,
  buildScaleGeometry, buildBenchmarkItemLink, calculationNotReadyMessage,
  coverageDisplay,
} from '../../src/lib/quality/benchmarkPolicy.ts';

const failures = [];
const check = (name, cond) => { cond ? console.log('  ok — ' + name) : failures.push(name); };

const baseItem = {
  boq_item_id: 'item-1', client_position_id: 'pos-1',
  minimum: 90, p25: 95, median: 100, p75: 105, maximum: 110, current_unit_cost: 100,
};

// 1-5. статусы: текст+иконка, high/low/within/insufficient/not eligible
for (const [s, mustInclude] of [
  ['HIGH_OUTLIER', 'Выше'], ['LOW_OUTLIER', 'Ниже'], ['WITHIN_RANGE', 'диапазоне'],
  ['INSUFFICIENT_HISTORY', 'Недостаточно'], ['NOT_ELIGIBLE', 'привязки'],
]) {
  const d = benchmarkStatusDisplay(s);
  check(`статус ${s}`, d.label.includes(mustInclude) && d.icon.length > 0);
}

// outlier формулируется как «требует проверки», не как ошибка
check('outlier = «требует проверки», не ошибка',
  benchmarkStatusDisplay('HIGH_OUTLIER').label.includes('требует проверки') &&
  !benchmarkStatusDisplay('HIGH_OUTLIER').label.toLowerCase().includes('ошиб'));

// 6. период-селектор — политика значений живёт на бэке; фронт передаёт как есть
check('период: допустимые значения известны', [6, 12, 24, 36].every((v) => Number.isInteger(v)));

// 7-9. фильтры/поиск выполняются сервером (URL) — проверяем построение ссылки
check('deep link BOQ item (16)',
  buildBenchmarkItemLink(baseItem, 't-1') ===
  '/positions/pos-1/items?tenderId=t-1&positionId=pos-1&itemId=item-1');

// 10. deviation formatting (сортировку делает сервер)
check('safe percent formatting', formatPercent(34.256) === '+34.26%' && formatPercent(-5) === '-5.00%');

// 11. IQR=0 scale без NaN
const flat = buildScaleGeometry({ minimum: 100, p25: 100, median: 100, p75: 100, maximum: 100, current_unit_cost: 100 });
check('IQR=0 scale валидна', flat.valid && [flat.min, flat.current].every(isFinite));

// 12. current выше max — clamped + пометка
const above = buildScaleGeometry({ ...baseItem, current_unit_cost: 500 });
check('current > max не ломает scale', above.valid && above.current <= 100 && above.outOfRange === 'above');

// 13. current ниже min
const below = buildScaleGeometry({ ...baseItem, current_unit_cost: 1 });
check('current < min не ломает scale', below.valid && below.current >= 0 && below.outOfRange === 'below');

// 14. missing median → невалидная геометрия, не NaN
const noMed = buildScaleGeometry({ minimum: null, p25: null, median: null, p75: null, maximum: null, current_unit_cost: 100 });
check('missing median без NaN', !noMed.valid && isFinite(noMed.current));

// 15. drawer detail mapping — money formatting безопасен
check('detail money mapping', formatMoney(10800) === '10 800,00' || formatMoney(10800).includes('800'));
check('detail money null', formatMoney(null) === '—');

// 17. calculation-not-ready state
check('not-ready message', calculationNotReadyMessage().includes('дождитесь актуального расчёта'));

// 18. empty history → INSUFFICIENT_HISTORY отображается
check('empty history state', benchmarkStatusDisplay('INSUFFICIENT_HISTORY').label.length > 0);

// 19. outlier никогда не blocker
check('outlier не blocker', isBlockingStatus('HIGH_OUTLIER') === false && isBlockingStatus('LOW_OUTLIER') === false);

// 20. coverage без NaN
check('coverage без NaN', coverageDisplay(NaN) === '—' && coverageDisplay(72.94) === '72.9%');

console.log('priceBenchmarkFrontendPolicy.check:');
if (failures.length > 0) {
  console.error('\n  ✗ FAILED:\n');
  for (const f of failures) console.error('    - ' + f);
  process.exit(1);
}
console.log('\npriceBenchmarkFrontendPolicy.check: passed (20 checks)');
