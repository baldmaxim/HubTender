// Проверки хелперов панели готовности по разделам ВОР — run via tsx:
//   npx tsx scripts/checks/sectionsPolicy.check.mjs

import {
  summarizeSections, pricingBlockers, changedDescription,
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
  positions: 3, priced: 3, unpriced_no_reason: 0, priced_no_gp: 0, total_amount: 100,
  content_hash: 'h', open_errors: 0, open_warnings: 0,
  pricing: stage(), review: stage(),
  ...over,
});

// Сводка
const summary = summarizeSections([
  section({ pricing: stage({ status: 'marked' }), review: stage({ status: 'marked' }) }),
  section({ key: 'h:2', pricing: stage({ status: 'changed' }) }),
  section({ key: 'h:3' }),
  section({ key: 'h:4', positions: 0, priced: 0, pricing: stage({ status: 'marked' }) }),
]);
check('пустой раздел не входит в сводку', summary.total === 3 && summary.empty === 1);
check('изменённая отметка не считается расценённой', summary.priced === 1);
check('изменённые считаются отдельно', summary.changed === 1);
check('проверенные', summary.reviewed === 1);

// Что мешает отметке
check('полностью готовый раздел без препятствий', pricingBlockers(section()).length === 0);
const blockers = pricingBlockers(section({ priced: 1, unpriced_no_reason: 1, priced_no_gp: 2, open_errors: 4 }));
check('перечисляются все препятствия', blockers.length === 4 && blockers[0].includes('2'));

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
