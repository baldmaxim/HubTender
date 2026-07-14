// Этап 1.1 focused frontend checks — run via tsx:
//   npx tsx scripts/checks/qualityFrontendPolicy.check.mjs
//
// Прогоняет 12 проверок чистых helpers панели «Качество расчёта»
// (src/lib/quality/dashboardPolicy.ts) без React/DOM.

import {
  filterIssues, resolveReadyState, formatCompleteness,
  buildNavigationTarget, severityDisplay, SEVERITY_ORDER,
} from '../../src/lib/quality/dashboardPolicy.ts';

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
  else console.log('  ok — ' + name);
}

const mk = (over) => ({
  id: 'x', code: 'C', severity: 'warning', category: 'BOQ_INPUT',
  entity_type: 'boq_item', entity_id: 'item-1', client_position_id: 'pos-1',
  field: 'quantity', title: 'T', message: 'M', fix_hint: 'F', current_value: null,
  ...over,
});

const issues = [
  mk({ id: '1', severity: 'information', code: 'I1', entity_id: 'b' }),
  mk({ id: '2', severity: 'blocker', code: 'B1', category: 'CURRENCY', entity_type: 'tender', entity_id: 't', client_position_id: '' }),
  mk({ id: '3', severity: 'warning', code: 'W1', entity_id: 'a', title: 'Кирпич дубль' }),
  mk({ id: '4', severity: 'blocker', code: 'B2', category: 'RELATIONS', entity_id: 'c' }),
];

// 1. blocker всегда выше warning
const sorted = filterIssues(issues, {});
check('blocker всегда выше warning/information',
  sorted[0].severity === 'blocker' && sorted[1].severity === 'blocker' &&
  sorted[2].severity === 'warning' && sorted[3].severity === 'information');

// 2. фильтр severity
check('фильтр severity', filterIssues(issues, { severity: 'blocker' }).length === 2);

// 3. фильтр category
check('фильтр category', filterIssues(issues, { category: 'CURRENCY' }).length === 1);

// 4. фильтр position
check('фильтр position', filterIssues(issues, { clientPositionId: 'pos-1' }).length === 3);

// 5. search по title/message
check('поиск по title', filterIssues(issues, { search: 'кирпич' }).length === 1);

// 6. empty state: пустой вход → пустой выход (без ошибок)
check('empty state', filterIssues([], {}).length === 0);

// 7. deep link для BOQ item
const boqTarget = buildNavigationTarget(mk({}), 'tender-1');
check('deep link BOQ item',
  boqTarget != null &&
  boqTarget.url.startsWith('/positions/pos-1/items?') &&
  boqTarget.url.includes('itemId=item-1') &&
  boqTarget.url.includes('tenderId=tender-1') &&
  boqTarget.url.includes('field=quantity'));

// 8. deep link для FX (tender-level currency)
const fxTarget = buildNavigationTarget(
  mk({ entity_type: 'tender', entity_id: 't', category: 'CURRENCY', client_position_id: '', field: 'usd_rate' }),
  'tender-1');
check('deep link FX → курсы тендера', fxTarget != null && fxTarget.url.includes('/admin/tenders'));

// 8b. FX с affected_item_ids ведёт к первой строке
const fxRow = buildNavigationTarget(
  mk({ entity_type: 'tender', entity_id: 't', category: 'CURRENCY', client_position_id: 'pos-9', affected_item_ids: ['it-9'] }),
  'tender-1');
check('deep link FX с затронутой строкой → строка', fxRow != null && fxRow.url.includes('itemId=it-9'));

// 9. deep link для redistribution
const rdTarget = buildNavigationTarget(
  mk({ entity_type: 'tender', entity_id: 't', category: 'REDISTRIBUTION', client_position_id: '', field: '' }),
  'tender-1');
check('deep link redistribution', rdTarget != null && rdTarget.url.includes('/commerce/redistribution'));

// 10. unknown issue severity → безопасное отображение
const unk = severityDisplay('mystery');
check('unknown severity безопасен', unk.label.length > 0 && unk.icon.length > 0 &&
  (SEVERITY_ORDER['mystery'] === undefined));

// 11. blockers > 0 → не green-ready
check('blockers>0 не даёт ready',
  resolveReadyState({ summary: { blockers: 1, warnings: 0 } }) === 'blocked' &&
  resolveReadyState({ summary: { blockers: 0, warnings: 3 } }) === 'warnings' &&
  resolveReadyState({ summary: { blockers: 0, warnings: 0 } }) === 'ready');

// 12. completeness не NaN
check('completeness без NaN',
  formatCompleteness(NaN) === '—' && formatCompleteness(Infinity) === '—' &&
  formatCompleteness(96.44) === '96.4%' && formatCompleteness(null) === '—');

console.log('qualityFrontendPolicy.check:');
if (failures.length > 0) {
  console.error('\n  ✗ FAILED:\n');
  for (const f of failures) console.error('    - ' + f);
  process.exit(1);
}
console.log('\nqualityFrontendPolicy.check: passed (12 checks)');
