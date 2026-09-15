// Проверки выжимки для руководства — run via tsx:
//   npx tsx scripts/checks/briefPolicy.check.mjs

import { readFileSync } from 'node:fs';
import {
  pickBriefFacts, briefTotalPerSp, formatBriefFact, normalizeSelection, AUTO_FACT_LIMIT,
} from '../../src/lib/quality/briefPolicy.ts';
import { buildBriefBlock } from '../../src/pages/FinancialIndicators/utils/briefSheetBlock.ts';

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
  else console.log('  ok — ' + name);
}

const assess = (value) => ({
  value, status: 'NO_REFERENCE', reference: null, deviation_percent: null,
  history_conflict: false, history_median: null, history_tenders: 0,
});
const cat = (id, name, total, perUnit = 100, unit = 'м3') => ({
  level: 'category', category_id: id, detail_id: '', name, location: '', unit,
  volume: 10, commercial_total: total, per_volume_unit: assess(perUnit), per_area_sp: assess(total / 1000),
});
const report = {
  tender_id: 't', housing_class: 'комфорт', construction_scope: null, area_sp: 1000, period_months: 24,
  calculation_ready: true, history_tenders: 0,
  summary: { above: 0, below: 0, within: 0, no_reference: 0, conflicts: 0 },
  rows: [
    { ...cat('', 'Итого', 1000000), level: 'total', per_volume_unit: null, per_area_sp: assess(1000) },
    cat('c1', 'Монолит', 300000, 30000),
    { ...cat('c1', 'Стены', 100000), level: 'detail', detail_id: 'd1' },
    cat('c2', 'Кладка', 500000),
    cat('c3', 'Пусто', 0),
    ...Array.from({ length: 10 }, (_, i) => cat('x' + i, 'Прочее ' + i, 1000 + i)),
  ],
};

const auto = pickBriefFacts(report, null);
check('авто: не больше лимита', auto.length === AUTO_FACT_LIMIT);
check('авто: крупнейшая первой', auto[0].category_id === 'c2' && auto[1].category_id === 'c1');
check('авто: только категории, без детализаций и нулевых',
  auto.every((f) => f.category_id !== '' && f.category_id !== 'c3'));
check('доля от итога', Math.abs(auto[0].share - 0.5) < 1e-9);

const chosen = pickBriefFacts(report, ['c3', 'gone', 'c1']);
check('выбор: порядок проверяющего, исчезнувшие пропущены', chosen.map((f) => f.category_id).join() === 'c3,c1');
check('пустой выбор = авто', pickBriefFacts(report, []).length === AUTO_FACT_LIMIT);
check('без отчёта — пусто', pickBriefFacts(null, null).length === 0 && briefTotalPerSp(null) === null);
check('итог на м² СП', briefTotalPerSp(report) === 1000);

const line = formatBriefFact(chosen[1]);
check('строка факта: ₽/ед., ₽/м² СП и доля', line.startsWith('Монолит — ') && line.includes('₽/м3') && line.includes('₽/м² СП') && line.endsWith('30%'));

check('выбор совпал с авто — сохраняем null', normalizeSelection(auto.map((f) => f.category_id), report) === null);
check('пустой выбор — null', normalizeSelection([], report) === null);
check('ручной выбор сохраняется', normalizeSelection(['c1'], report)?.[0] === 'c1');

check('пустая выжимка — без блока', buildBriefBlock({ totalPerSp: null, facts: [], summaryText: '  ' }, 10) === null);
const block = buildBriefBlock({ totalPerSp: 1000, facts: chosen, summaryText: '=SUM(A1)\n\nФасад НВФ' }, 10);
check('блок через пустую строку', block.cells[0].r === 12 && block.cells[0].cell.v === 'Выжимка для руководства');
check('формула в тексте остаётся строкой', block.cells.some((c) => c.cell.v === '=SUM(A1)' && c.cell.t === 's' && !c.cell.f));
check('каждая строка объединена B:F', block.merges.length === block.cells.length);
check('lastRow — последняя строка блока', block.lastRow === Math.max(...block.cells.map((c) => c.r)));

// Лист целиком в node не собрать (xlsx-js-style без ESM-экспорта) — проверяем проводку.
const sheetSrc = readFileSync(new URL('../../src/pages/FinancialIndicators/utils/buildFinancialSheet.ts', import.meta.url), 'utf8');
check('лист ставит ячейки блока и расширяет !ref', sheetSrc.includes('buildBriefBlock(input.brief, lastRow)') && sheetSrc.includes('lastRow = briefBlock.lastRow'));
check('объединения блока попадают в !merges', sheetSrc.includes('...(briefBlock?.merges ?? [])'));
const exportSrc = readFileSync(new URL('../../src/pages/FinancialIndicators/utils/loadBriefForExport.ts', import.meta.url), 'utf8');
check('ошибка загрузки выжимки не срывает экспорт', exportSrc.includes('catch {') && exportSrc.includes('return null'));

if (failures.length) {
  console.error('\nПровалено: ' + failures.length);
  for (const f of failures) console.error('  FAIL — ' + f);
  process.exit(1);
}
console.log('\nВсе проверки пройдены.');
