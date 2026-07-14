// Этап 1.3 focused frontend checks — run via tsx:
//   npx tsx scripts/checks/priceSourceFrontendPolicy.check.mjs

import { readFileSync } from 'node:fs';
import {
  sourceStatusDisplay, isSourceBlockingStatus, SOURCE_STATUS_PRIORITY,
  safeSourceUrl, formatCoverage, formatAmount, formatAge,
  amountMetricsAvailable, buildSourceItemLink, validateSourceDates,
} from '../../src/lib/quality/sourcePolicy.ts';

const failures = [];
const check = (name, cond) => { cond ? console.log('  ok — ' + name) : failures.push(name); };

// 1-7. каждый статус имеет текст + иконку (не только цвет)
for (const [s, mustInclude] of [
  ['FRESH', 'актуален'], ['EXPIRING_SOON', 'скоро'], ['STALE', 'давно'],
  ['EXPIRED', 'завершён'], ['SOURCE_MISSING', 'не указан'],
  ['PRICE_DATE_MISSING', 'неизвестна'], ['INVALID_SOURCE_DATES', 'исправления'],
]) {
  const d = sourceStatusDisplay(s);
  check(`статус ${s}: текст+иконка`, d.label.includes(mustInclude) && d.icon.length > 0);
}

// 8. warning не формулируется как «подтверждённая ошибка цены»
check('stale/expired = «требует проверки», не ошибка',
  sourceStatusDisplay('STALE').label.includes('требует проверки') &&
  sourceStatusDisplay('EXPIRED').label.includes('требует проверки') &&
  !sourceStatusDisplay('STALE').label.toLowerCase().includes('ошиб') &&
  !sourceStatusDisplay('EXPIRED').label.toLowerCase().includes('ошиб'));

// 9. ни один статус не blocker
check('статусы никогда не blocker',
  ['STALE', 'EXPIRED', 'INVALID_SOURCE_DATES', 'SOURCE_MISSING']
    .every((s) => isSourceBlockingStatus(s) === false));

// 10. приоритет сортировки: invalid → expired → stale → missing source → missing date → expiring → fresh
check('приоритет статусов (§13)',
  SOURCE_STATUS_PRIORITY.INVALID_SOURCE_DATES < SOURCE_STATUS_PRIORITY.EXPIRED &&
  SOURCE_STATUS_PRIORITY.EXPIRED < SOURCE_STATUS_PRIORITY.STALE &&
  SOURCE_STATUS_PRIORITY.STALE < SOURCE_STATUS_PRIORITY.SOURCE_MISSING &&
  SOURCE_STATUS_PRIORITY.SOURCE_MISSING < SOURCE_STATUS_PRIORITY.PRICE_DATE_MISSING &&
  SOURCE_STATUS_PRIORITY.PRICE_DATE_MISSING < SOURCE_STATUS_PRIORITY.EXPIRING_SOON &&
  SOURCE_STATUS_PRIORITY.EXPIRING_SOON < SOURCE_STATUS_PRIORITY.FRESH);

// 11-12. URL safety: https/http проходят, опасные схемы и мусор — нет
check('safe URL: https/http допустимы',
  safeSourceUrl('https://supplier.kz/quote.pdf') === 'https://supplier.kz/quote.pdf' &&
  safeSourceUrl('http://old.supplier.kz/q') === 'http://old.supplier.kz/q');
check('unsafe URL блокируются',
  safeSourceUrl('javascript:alert(1)') === null &&
  safeSourceUrl('data:text/html,<b>x</b>') === null &&
  safeSourceUrl('file:///C:/секрет.pdf') === null &&
  safeSourceUrl('просто текст') === null &&
  safeSourceUrl('') === null && safeSourceUrl(null) === null);

// 13. deep link к строке (field=quote_link — механизм этапа 1.1)
check('deep link к строке BOQ',
  buildSourceItemLink({ boq_item_id: 'item-1', client_position_id: 'pos-1' }, 't-1') ===
  '/positions/pos-1/items?tenderId=t-1&positionId=pos-1&itemId=item-1&field=quote_link');

// 14. amount-метрики: gate по amount_metrics_status
check('amount-метрики: available/unavailable gate',
  amountMetricsAvailable({ amount_metrics_status: 'available' }) === true &&
  amountMetricsAvailable({ amount_metrics_status: 'unavailable' }) === false);

// 15. покрытие/суммы/возраст без NaN
check('форматирование без NaN',
  formatCoverage(NaN) === '—' && formatCoverage(null) === '—' && formatCoverage(72.94) === '72.9%' &&
  formatAmount(NaN) === '—' && formatAmount(null) === '—' &&
  formatAge(NaN) === '—' && formatAge(null) === '—' && formatAge(91) === '91 дн.');

// 16. inline-валидация: дата цены в будущем отклоняется
check('валидация: дата цены в будущем',
  validateSourceDates('2026-08-01', null, '2026-07-14') !== null &&
  validateSourceDates('2026-07-14', null, '2026-07-14') === null);

// 17. inline-валидация: valid_until < price_date отклоняется, пустые допустимы
check('валидация: диапазон дат и пустые значения',
  validateSourceDates('2026-07-01', '2026-06-30', '2026-07-14') !== null &&
  validateSourceDates('2026-07-01', '2026-07-01', '2026-07-14') === null &&
  validateSourceDates(null, null, '2026-07-14') === null &&
  validateSourceDates('мусор', null, '2026-07-14') !== null);

// 18-20. проверки исходника страницы (статический анализ)
const page = readFileSync(new URL('../../src/pages/PriceSourceQuality/PriceSourceQuality.tsx', import.meta.url), 'utf-8');

// 18. внешняя ссылка открывается только через safeSourceUrl + noopener noreferrer
check('страница: safeSourceUrl + rel="noopener noreferrer"',
  page.includes('safeSourceUrl(') && page.includes('rel="noopener noreferrer"') &&
  page.includes('target="_blank"'));

// 19. форма не подставляет сегодняшнюю дату автоматически и блокирует будущее price_date
check('страница: нет авто-даты, будущее price_date заблокировано',
  !page.match(/initialValue=\{?\s*dayjs\(\)/) && page.includes('disabledDate'));

// 20. metadata-only PATCH: страница не отправляет unit_rate/total_amount при правке источника
check('страница: правка источника не трогает ставку/сумму',
  page.includes('updateBoqQuoteSource(') &&
  !page.match(/updateBoqQuoteSource\([^)]*unit_rate/s) &&
  !page.includes('total_amount:'));

console.log('priceSourceFrontendPolicy.check:');
if (failures.length > 0) {
  console.error('\n  ✗ FAILED:\n');
  for (const f of failures) console.error('    - ' + f);
  process.exit(1);
}
console.log('\npriceSourceFrontendPolicy.check: passed (20 checks)');
