// Проверки хелперов панели эталонов — run via tsx:
//   npx tsx scripts/checks/costBenchmarkPolicy.check.mjs

import {
  canEditBenchmarkRanges, statusDisplay, referenceRangeText, isDeviation, buildBenchmarkTree,
} from '../../src/lib/quality/costBenchmarkPolicy.ts';

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
  else console.log('  ok — ' + name);
}

const assess = (over = {}) => ({
  value: 100, status: 'WITHIN_RANGE', reference: null, deviation_percent: null,
  history_conflict: false, history_median: null, history_tenders: 0, ...over,
});
const row = (over = {}) => ({
  level: 'category', category_id: 'c1', detail_id: '', name: 'Монолит', location: '', unit: 'м3',
  volume: 10, commercial_total: 1000, per_volume_unit: assess(), per_area_sp: assess(), ...over,
});

check('инженер не правит справочник', !canEditBenchmarkRanges('engineer'));
check('ведущий инженер правит', canEditBenchmarkRanges('veduschiy_inzhener'));
check('без роли — нет', !canEditBenchmarkRanges(undefined));

check('выше эталона — красный', statusDisplay('ABOVE_RANGE').color === 'red');
check('диапазон с двумя границами', referenceRangeText({ source: 'manual_any', min: 18000, max: 25000 }).includes('–'));
check('только верхняя граница', referenceRangeText({ source: 'manual_any', min: null, max: 25000 }).startsWith('до'));

check('конфликт с историей — тоже отклонение', isDeviation(assess({ history_conflict: true })));
check('в эталоне — не отклонение', !isDeviation(assess()));
check('null — не отклонение', !isDeviation(null));

const rows = [
  row({ level: 'total', category_id: '', name: 'Итого', per_volume_unit: null }),
  row(),
  row({ level: 'detail', detail_id: 'd1', name: 'Стены', per_area_sp: assess({ status: 'ABOVE_RANGE' }) }),
  row({ level: 'detail', detail_id: 'd2', name: 'Плиты' }),
  row({ category_id: 'c2', name: 'Кладка' }),
];
const tree = buildBenchmarkTree(rows, false);
check('итог и категории — верхний уровень', tree.length === 3 && tree[0].level === 'total');
check('детализации под своей категорией', tree[1].children?.length === 2);

const dev = buildBenchmarkTree(rows, true);
check('в режиме отклонений остаётся категория с отклонением в детализации',
  dev.length === 1 && dev[0].category_id === 'c1' && dev[0].children?.length === 1);

if (failures.length) {
  console.error('\nПровалено: ' + failures.length);
  for (const f of failures) console.error('  FAIL — ' + f);
  process.exit(1);
}
console.log('\nВсе проверки пройдены.');
