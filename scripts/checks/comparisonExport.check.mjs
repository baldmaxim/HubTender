// Геометрия листа «Сравнение объектов» — run via tsx:
//   npx tsx scripts/checks/comparisonExport.check.mjs
//
// Проверяет, что все строки листа одной ширины и что показатели стоят в тех
// столбцах, где их ждут объединения и раскраска. Разъезд на один столбец даёт
// внешне правдоподобный файл с числами не под теми заголовками.

import { buildExportData } from '../../src/pages/Analytics/ObjectComparison/utils/exportComparisonToExcel.ts';

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
  else console.log('  ok — ' + name);
}

const costs = (over = {}) => ({
  materials: 100, works: 200, total: 300,
  mat_per_unit: 1, work_per_unit: 2, total_per_unit: 3,
  volume: 10, total_per_sp: 7,
  ...over,
});

const row = (key, category, tenders, extra = {}) => ({ key, category, tenders, ...extra });

const makeData = (numTenders) => [
  row('main__Монолит', 'Монолит', Array.from({ length: numTenders }, () => costs()), {
    is_main_category: true,
    children: [
      row('d1', 'Стены', Array.from({ length: numTenders }, () => costs({ total_per_sp: 4 }))),
    ],
  }),
];

// Ширина блока одного тендера. Меняется вместе с COLS_PER_TENDER — тест обязан
// падать, если состав столбцов поменяли, а геометрию не пересчитали.
const COLS_PER_TENDER = 7;

for (const numTenders of [2, 3]) {
  const labels = Array.from({ length: numTenders }, (_, i) => `Объект ${i + 1}`);
  const { data, rowTypes, levels } = buildExportData({
    comparisonData: makeData(numTenders),
    costType: 'commercial',
    tenderLabels: labels,
  });

  const hasDiff = numTenders === 2;
  const expectedWidth = 1 + numTenders * COLS_PER_TENDER + (hasDiff ? COLS_PER_TENDER : 0) + 1;

  check(`${numTenders} тендера: все строки одной ширины`,
    data.every((r) => r.length === expectedWidth));
  check(`${numTenders} тендера: rowTypes и levels совпадают с числом строк`,
    rowTypes.length === data.length && levels.length === data.length);

  const [header, sub] = data;
  check(`${numTenders} тендера: заголовок тендера в начале своего блока`,
    labels.every((label, i) => header[1 + i * COLS_PER_TENDER] === label));
  check(`${numTenders} тендера: подзаголовки повторяются поблочно`,
    sub[1] === 'Материалы' && sub[1 + COLS_PER_TENDER] === 'Материалы');
  check(`${numTenders} тендера: «Итого/м² СП» замыкает блок`,
    sub[COLS_PER_TENDER] === 'Итого/м² СП');
  check(`${numTenders} тендера: колонка примечания последняя`,
    header[expectedWidth - 1] === 'Примечание');

  // Строка данных: значения показателей стоят под своими подзаголовками.
  const dataRow = data[2];
  const base = 1;
  check(`${numTenders} тендера: значения под своими заголовками`,
    dataRow[base] === 100 && dataRow[base + 1] === 200 && dataRow[base + 2] === 300 &&
    dataRow[base + 5] === 3 && dataRow[base + 6] === 7);

  // Итоговая строка: деньги есть, удельные пустые.
  const totalRow = data[data.length - 1];
  check(`${numTenders} тендера: строка ИТОГО помечена`,
    rowTypes[rowTypes.length - 1] === 'total' && totalRow[0] === 'ИТОГО');
  check(`${numTenders} тендера: удельные в ИТОГО не выводятся`,
    totalRow[base + 3] === '' && totalRow[base + 6] === '');

  if (hasDiff) {
    const diffStart = 1 + numTenders * COLS_PER_TENDER;
    check('2 тендера: блок «Разница» стоит после блоков тендеров',
      header[diffStart] === 'Разница');
    check('2 тендера: «Разница» имеет тот же состав столбцов',
      sub[diffStart] === 'Материалы' && sub[diffStart + COLS_PER_TENDER - 1] === 'Итого/м² СП');
  }
}

// Три тендера — блока «Разница» быть не должно.
{
  const { data } = buildExportData({
    comparisonData: makeData(3),
    costType: 'base',
    tenderLabels: ['A', 'B', 'C'],
  });
  check('3 тендера: блока «Разница» нет', !data[0].includes('Разница'));
}

// Пустые данные не роняют сборку.
{
  const { data } = buildExportData({ comparisonData: [], costType: 'base', tenderLabels: ['A', 'B'] });
  check('пустые данные дают только шапку и ИТОГО', data.length === 3);
}

if (failures.length) {
  console.error('\nПровалено: ' + failures.length);
  for (const f of failures) console.error('  FAIL — ' + f);
  process.exit(1);
}
console.log('\nВсе проверки пройдены.');
