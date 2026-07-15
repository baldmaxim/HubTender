// Этап 1.4 focused frontend checks — run via tsx:
//   npx tsx scripts/checks/actionPlanFrontendPolicy.check.mjs

import { readFileSync } from 'node:fs';
import {
  PRIORITY_ORDER, priorityDisplay, componentStatusDisplay, nextAction,
  buildPrimaryNavigation, buildSourceNavigation, formatImpact,
  formatAmountValue, summaryAmount, sourceLabel, EMPTY_PLAN_TEXT, PLAN_AUTO_HINT,
} from '../../src/lib/quality/actionPlanPolicy.ts';

const failures = [];
const check = (name, cond) => { cond ? console.log('  ok — ' + name) : failures.push(name); };

const mkAction = (over = {}) => ({
  id: 'a1', rank: 1, priority: 'high', source: 'quality', sources: ['quality'],
  code: 'QUANTITY_ZERO', category: 'BOQ_INPUT', entity_type: 'boq_item', entity_id: 'i1',
  client_position_id: 'p1', boq_item_ids: ['i1'], field: 'quantity',
  title: 'T', reason: 'R', recommended_action: 'A', priority_reason: 'PR',
  affected_items_count: 1, impact_amount: 100, impact_amount_status: 'available',
  navigation: { type: 'boq_item', position_id: 'p1', item_id: 'i1', field: 'quantity' },
  source_navigation: { analytics_page: 'quality' },
  ...over,
});

// 1-3. порядок band'ов
check('blocking выше high', PRIORITY_ORDER.blocking < PRIORITY_ORDER.high);
check('high выше normal', PRIORITY_ORDER.high < PRIORITY_ORDER.normal);
check('normal выше low', PRIORITY_ORDER.normal < PRIORITY_ORDER.low);

// 4. next action = server rank 1 (никакого клиентского пересчёта)
const acts = [mkAction({ id: 'a3', rank: 3 }), mkAction({ id: 'a1', rank: 1 }), mkAction({ id: 'a2', rank: 2 })];
check('next action = rank 1', nextAction(acts)?.id === 'a1');

// 5-9. фильтры/поиск выполняются сервером — фронт передаёт параметры;
// проверяем, что страница шлёт их в query, а не фильтрует локально.
const page = readFileSync(new URL('../../src/pages/ActionPlan/ActionPlan.tsx', import.meta.url), 'utf-8');
check('priority filter → server param', /priority,\s*source,/.test(page) && page.includes('fetchActionPlan(id, {'));
check('source filter → server param', page.includes('source,') || page.includes('source: '));
check('category filter → server param', page.includes('category: category ?? undefined'));
check('position filter → server param', page.includes('position_id: positionId ?? undefined'));
check('search → server param', page.includes('search: search || undefined'));

// 10-11. sort — тоже серверный параметр
check('recommended sort — server param', page.includes("useState('recommended')") && page.includes('sort: sortMode'));
check('amount sort — опция выбора', page.includes("'amount_desc'"));

// 12. impact unavailable → '—'
check('impact unavailable → —',
  formatImpact({ impact_amount: null, impact_amount_status: 'unavailable' }) === '—' &&
  formatImpact({ impact_amount: 500, impact_amount_status: 'unavailable' }) === '—' &&
  formatImpact({ impact_amount: 500, impact_amount_status: 'available' }) !== '—');

// 13. empty state — нейтральный, не «ошибок нет»
check('empty state текст', EMPTY_PLAN_TEXT.includes('Обязательных действий не обнаружено') &&
  !EMPTY_PLAN_TEXT.toLowerCase().includes('ошибок нет'));

// 14. component benchmark unavailable/not ready отображается
check('component statuses',
  componentStatusDisplay({ status: 'calculation_not_ready' }).label.includes('не актуален') &&
  componentStatusDisplay({ status: 'unavailable' }).label === 'Недоступно' &&
  componentStatusDisplay({ status: 'available' }).label === 'Доступно');

// 15-19. навигация из typed contract
check('BOQ navigation',
  buildPrimaryNavigation(mkAction(), 't-1').url ===
  '/positions/p1/items?tenderId=t-1&positionId=p1&itemId=i1&field=quantity');
check('currency navigation',
  buildPrimaryNavigation(mkAction({ navigation: { type: 'tender_currency', position_id: null, item_id: null, field: 'usd_rate' } }), 't-1')
    .url === '/admin/tenders?tenderId=t-1&focus=rates');
check('redistribution navigation',
  buildPrimaryNavigation(mkAction({ navigation: { type: 'redistribution', position_id: null, item_id: null } }), 't-1')
    .url === '/commerce/redistribution?tenderId=t-1');
check('benchmark detail navigation (secondary)',
  buildSourceNavigation(mkAction({ source_navigation: { analytics_page: 'price_benchmark', item_id: 'i1' } }), 't-1')
    .url === '/analytics/price-benchmark?tenderId=t-1');
check('source navigation (secondary)',
  buildSourceNavigation(mkAction({ source_navigation: { analytics_page: 'price_source' } }), 't-1')
    .url === '/analytics/price-sources?tenderId=t-1');

// 20. unknown navigation type → безопасный fallback (не падает)
const unknown = buildPrimaryNavigation(
  mkAction({ navigation: { type: 'teleport_2077', position_id: null, item_id: null }, source_navigation: { analytics_page: 'quality' } }), 't-1');
check('unknown navigation fallback', unknown.url === '/analytics/quality?tenderId=t-1');

// 21. никакого completion checkbox / статуса выполнения
check('нет completion checkbox',
  !page.includes('Checkbox') && !/выполнено/i.test(page) && !/completed:\s/.test(page));

// 22. price anomaly не показана как blocker
check('outlier не blocker в отображении',
  priorityDisplay('high').label !== priorityDisplay('blocking').label &&
  priorityDisplay('blocking').label === 'Блокирует' && priorityDisplay('high').label === 'Высокий');

// 23. amount не NaN
check('amount без NaN',
  formatAmountValue(NaN) === '—' && formatAmountValue(null) === '—' &&
  summaryAmount({ summary: { amount_metrics_status: 'unavailable', amount_requiring_review: null } }) === '—' &&
  summaryAmount({ summary: { amount_metrics_status: 'available', amount_requiring_review: 1500 } }).includes('500'));

// 24. summary amount не пересчитывается фронтом (нет суммирования actions)
check('summary amount не пересчитывается frontend',
  !/actions\.(reduce|map)\([^)]*impact_amount/s.test(page) &&
  page.includes('summaryAmount(report)'));

// 25. server rank используется как есть (нет собственного score)
check('server rank без клиентского score',
  page.includes("dataIndex: 'rank'") && !/score/i.test(page) &&
  !/\.sort\(\s*\(/.test(page));

// бонус-проверка ярлыков источников
check('source labels', sourceLabel('price_benchmark') === 'Ценовые отклонения' &&
  sourceLabel('price_source') === 'Источники цен' && sourceLabel('quality') === 'Качество расчёта');

console.log('actionPlanFrontendPolicy.check:');
if (failures.length > 0) {
  console.error('\n  ✗ FAILED:\n');
  for (const f of failures) console.error('    - ' + f);
  process.exit(1);
}
console.log(`\nactionPlanFrontendPolicy.check: passed (26 checks); hint: ${PLAN_AUTO_HINT.length > 0 ? 'set' : 'missing'}`);
