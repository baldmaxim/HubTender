// Проверки хелперов панели готовности по разделам ВОР — run via tsx:
//   npx tsx scripts/checks/sectionsPolicy.check.mjs

import {
  summarizeSections, pricingStatusLabel, pricingBlockers, changedDescription,
} from '../../src/lib/quality/sectionsPolicy.ts';

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
  else console.log('  ok — ' + name);
}

const stage = (over = {}) => ({
  status: 'none', marked_by: null, marked_by_name: null, marked_at: null, note: null, changes: null,
  ...over,
});
const section = (over = {}) => ({
  key: 'h:1', title: 'Раздел', header_position_id: '1', first_position_number: 1,
  positions: 3, required: 3, complete: 3, pricing_status: 'complete',
  priced: 3, unpriced_no_reason: 0, priced_no_gp: 0, total_amount: 100,
  content_hash: 'h', open_errors: 0, open_warnings: 0,
  review: stage(),
  ...over,
});

// Сводка: «расценено» берётся из вычисленного статуса, а не из отметки
const summary = summarizeSections([
  section({ review: stage({ status: 'marked' }) }),
  section({ key: 'h:2', complete: 1, pricing_status: 'in_progress', review: stage({ status: 'changed' }) }),
  section({ key: 'h:3', complete: 0, pricing_status: 'not_started' }),
  section({ key: 'h:4', positions: 1, required: 0, complete: 0, pricing_status: 'not_required' }),
]);
check('раздел без позиций к расценке не входит в сводку', summary.total === 3 && summary.empty === 1);
check('расценённым считается только полностью заполненный раздел', summary.priced === 1);
check('изменённая отметка проверки не считается проверенной', summary.reviewed === 1 && summary.changed === 1);

// Подписи статуса
check('complete → расценено', pricingStatusLabel(section()).text === 'расценено');
check('in_progress показывает прогресс',
  pricingStatusLabel(section({ complete: 1, pricing_status: 'in_progress' })).text === 'заполнено 1 из 3');
check('not_required', pricingStatusLabel(section({ pricing_status: 'not_required' })).text === 'нечего расценивать');

// Что не заполнено
check('заполненный раздел без препятствий', pricingBlockers(section()).length === 0);
const blockers = pricingBlockers(section({ unpriced_no_reason: 1, priced_no_gp: 2, open_errors: 4 }));
check('перечисляются все препятствия', blockers.length === 3 && blockers[1].includes('2'));

// Описание изменения
check('для неизменённой отметки описания нет', changedDescription(stage({ status: 'marked' })) === '');
check('правки строк с авторами', changedDescription(stage({
  status: 'changed', changes: { row_edits: 3, last_change_at: null, authors: ['Иванов'] },
})).includes('Иванов'));
check('без правок строк — изменены поля позиций', changedDescription(stage({
  status: 'changed', changes: { row_edits: 0, last_change_at: null, authors: [] },
})).includes('поля позиций'));

if (failures.length) {
  console.error('\nПровалено: ' + failures.length);
  for (const f of failures) console.error('  FAIL — ' + f);
  process.exit(1);
}
console.log('\nВсе проверки пройдены.');
