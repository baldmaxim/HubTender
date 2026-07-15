// Этап 1.5 focused frontend checks — run via tsx:
//   npx tsx scripts/checks/changeImpactFrontendPolicy.check.mjs

import { readFileSync } from 'node:fs';
import {
  changeStatusDisplay, formatDelta, formatMoneyValue, formatDeltaPercent,
  directionDisplay, reconciliationDisplay, buildBridgeGeometry, bridgeDeltaSum,
  buildDiffItemNavigation, buildConfigNavigation, configChangeText,
  baselineOptionLabel, NO_BASELINE_TEXT, IDENTICAL_VERSIONS_TEXT,
  CALC_NOT_READY_TEXT, AMBIGUOUS_GROUP_NOTE,
} from '../../src/lib/quality/changeImpactPolicy.ts';

const failures = [];
const check = (name, cond) => { cond ? console.log('  ok — ' + name) : failures.push(name); };

const mkItem = (over = {}) => ({
  id: 'row:b>c', status: 'MODIFIED', boq_item_type: 'раб', label: 'Бетон',
  position_label: '№1 Работы', client_position_id: 'p1',
  current_item_id: 'c1', baseline_item_id: 'b1',
  direct: { baseline: 100, current: 150, delta: 50 },
  commercial: { baseline: 110, current: 165, delta: 55 },
  direction: 'increase',
  ...over,
});

// 1-5. статусы: текст + иконка
for (const [s, mustInclude] of [
  ['ADDED', 'Добавлена'], ['REMOVED', 'Удалена'], ['MODIFIED', 'Изменена'],
  ['UNCHANGED', 'Без изменений'], ['AMBIGUOUS_GROUP', 'Группа'],
]) {
  const d = changeStatusDisplay(s);
  check(`статус ${s}`, d.label.includes(mustInclude) && d.icon.length > 0);
}

// 6-8. дельты: положительная/отрицательная/нулевая
check('положительная дельта со знаком', formatDelta(1500.5).startsWith('+'));
check('отрицательная дельта со знаком', formatDelta(-1500.5).startsWith('−'));
check('нулевая дельта без знака', !formatDelta(0).startsWith('+') && !formatDelta(0).startsWith('−'));

// 9. baseline selector label
check('baseline option label',
  baselineOptionLabel({ version: 3, approved_at: '2026-06-01T10:00:00Z', cached_grand_total: 132000000 })
    .includes('v3') &&
  baselineOptionLabel({ version: 3, approved_at: '2026-06-01T10:00:00Z', cached_grand_total: 132000000 })
    .includes('2026-06-01'));

// 10-12. сортировка/фильтры/поиск — серверные параметры (страница шлёт query)
const page = readFileSync(new URL('../../src/pages/ChangeImpact/ChangeImpact.tsx', import.meta.url), 'utf-8');
check('impact sorting — server param', page.includes("useState('impact_desc')") && page.includes('sort: sortMode'));
check('filters — server params', page.includes('status,') && page.includes('position_id: positionId ?? undefined'));
check('search — server param', page.includes('search: search || undefined'));

// 13. bridge sum = сумма дельта-компонент
const bridge = [
  { code: 'BASELINE_TOTAL', label: 'Итог до', amount: 100 },
  { code: 'ADDED', label: '+', amount: 30 },
  { code: 'REMOVED', label: '-', amount: -10 },
  { code: 'MODIFIED', label: '~', amount: 15 },
  { code: 'AMBIGUOUS', label: '?', amount: 0 },
  { code: 'INSURANCE', label: 'ins', amount: 5 },
  { code: 'CURRENT_TOTAL', label: 'Итог после', amount: 140 },
];
check('bridge delta sum', bridgeDeltaSum(bridge) === 40);
const geom = buildBridgeGeometry(bridge);
check('bridge geometry без NaN и в пределах 0..100',
  geom.length === 5 && geom.every((b) => isFinite(b.offsetPercent) && isFinite(b.widthPercent) &&
    b.offsetPercent >= 0 && b.offsetPercent <= 100 && b.widthPercent > 0));

// 14-15. reconciliation
check('reconciliation success',
  reconciliationDisplay({ is_reconciled: true, reconciliation_residual: 0 }).ok === true);
const bad = reconciliationDisplay({ is_reconciled: false, reconciliation_residual: 123.45 });
check('reconciliation mismatch не скрывается',
  bad.ok === false && bad.text.includes('не удалось полностью согласовать') && bad.text.includes('123,45'));

// 16. направления для top increase/decrease
check('directions', directionDisplay('increase').label === 'Рост' &&
  directionDisplay('decrease').label === 'Снижение');

// 17. deep link к текущей строке
const nav = buildDiffItemNavigation(mkItem(), 't-1');
check('current BOQ deep link',
  nav !== null && nav.url === '/positions/p1/items?tenderId=t-1&positionId=p1&itemId=c1');

// 18. REMOVED — без ложной ссылки на текущую строку
check('removed без current link',
  buildDiffItemNavigation(mkItem({ status: 'REMOVED', current_item_id: null }), 't-1') === null);

// 19. AMBIGUOUS_GROUP — только drawer (без случайной строки)
check('ambiguous group — drawer, не ссылка',
  buildDiffItemNavigation(mkItem({ status: 'AMBIGUOUS_GROUP', current_item_ids: ['a', 'b'] }), 't-1') === null &&
  AMBIGUOUS_GROUP_NOTE.includes('группа'));

// 20. config change label + навигация
check('config change label',
  configChangeText({ label: 'Курс USD', old_value: '80', new_value: '100' }) ===
  'Одновременно изменено: Курс USD — 80 → 100');
check('config navigation',
  buildConfigNavigation({ navigation: 'tender_currency' }, 't-1').url === '/admin/tenders?tenderId=t-1&focus=rates' &&
  buildConfigNavigation({ navigation: 'insurance' }, 't-1').url === '/admin/insurance?tenderId=t-1' &&
  buildConfigNavigation({ navigation: 'unknown_target' }, 't-1').url.includes('/financial-indicators'));

// 21-23. empty states
check('no baseline state', NO_BASELINE_TEXT.includes('не найдена'));
check('calculation not ready state', CALC_NOT_READY_TEXT.includes('не актуален'));
check('identical versions state', IDENTICAL_VERSIONS_TEXT.includes('идентичны'));

// 24. no NaN/Inf
check('no NaN/Inf в форматировании',
  formatDelta(NaN) === '—' && formatDelta(Infinity) === '—' &&
  formatMoneyValue(NaN) === '—' &&
  formatDeltaPercent(0, 100) === '—' && formatDeltaPercent(100, 50) === '+50.0%');

// 25. неподтверждённая causal attribution не отображается
check('без неподтверждённой causal attribution',
  !configChangeText({ label: 'Курс USD', old_value: '80', new_value: '100' }).toLowerCase().includes('причин') &&
  !/причина изменения\s*—/i.test(page) &&
  page.includes('не как доказанная денежная причина'));

console.log('changeImpactFrontendPolicy.check:');
if (failures.length > 0) {
  console.error('\n  ✗ FAILED:\n');
  for (const f of failures) console.error('    - ' + f);
  process.exit(1);
}
console.log('\nchangeImpactFrontendPolicy.check: passed (25+ checks)');
