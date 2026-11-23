// Антисимметрия коммерческого расчёта по знаку базы — run:
//   node scripts/checks/negativeCommercialAntisymmetry.check.mjs
//
// Отрицательная цена строки BOQ допустима → отрицательная база. Коммерция линейна
// (commercial = base × coef), поэтому для каждого типа строки × основн./вспомогат. ×
// с НДС/без × варианты распределения КП должно выполняться:
//   материал(−base) = −материал(base), работа(−base) = −работа(base),
//   коэффициент наценки одинаков и ≥ 0.
// Проверяется FRONTEND preview-движок (calculateBoqItemCost); боевой расчёт — backend/internal/calc.

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// calculation.ts единственным рантайм-импортом тянет lib/api/markup (сеть + граф
// приложения) — в чистом расчёте он не нужен, подменяем заглушкой при сборке esbuild.
const entry = fileURLToPath(new URL('../../src/services/markupTactic/calculation.ts', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'neg-commercial-'));
const outfile = join(tmp, 'calculation.mjs');
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'silent',
  plugins: [
    {
      name: 'stub-markup-api',
      setup(b) {
        b.onResolve({ filter: /lib\/api\/markup$/ }, () => ({ path: 'markup-api-stub', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export const getTenderPricingDistribution = async () => null; export const listSubcontractGrowthExclusionsForTender = async () => [];',
          loader: 'js',
        }));
      },
    },
  ],
});
const {
  calculateBoqItemCost,
  resetTypeCoefficientsCache,
  DEFAULT_PRICING_DISTRIBUTION,
} = await import(pathToFileURL(outfile).href);
rmSync(tmp, { recursive: true, force: true });

const EPS = 1e-9;
const near = (a, b) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));

const BOQ_TYPES = ['раб', 'суб-раб', 'раб-комп.', 'мат', 'суб-мат', 'мат-комп.'];
const MATERIAL_TYPES = ['основн.', 'вспомогат.'];
const BASES = [1234.56, 0.01, 987654321.12];

// Цепочка: рост 10 % → накладные 7 % (от результата) → прибыль 5 % (от базы шага 1);
// НДС 22 % — отдельным последним шагом (движок выносит его из цепочки).
const buildTactic = () => {
  const sequence = [
    { name: 'Рост', baseIndex: -1, action1: 'multiply', operand1Type: 'markup', operand1Key: 'growth', operand1MultiplyFormat: 'addOne' },
    { name: 'Накладные', baseIndex: 0, action1: 'multiply', operand1Type: 'markup', operand1Key: 'overhead', operand1MultiplyFormat: 'addOne' },
    { name: 'Прибыль', baseIndex: 1, action1: 'multiply', operand1Type: 'markup', operand1Key: 'profit', operand1MultiplyFormat: 'addOne' },
    { name: 'НДС', baseIndex: 2, action1: 'multiply', operand1Type: 'markup', operand1Key: 'nds_22', operand1MultiplyFormat: 'addOne' },
  ];
  return { sequences: Object.fromEntries(BOQ_TYPES.map((t) => [t, sequence])) };
};

// Второе распределение — зеркальное дефолту (проверяет и «базу», и «наценку» в обоих столбцах).
const SWAPPED_DISTRIBUTION = Object.fromEntries(
  Object.entries(DEFAULT_PRICING_DISTRIBUTION).map(([k, v]) => [k, v === 'work' ? 'material' : 'work']),
);
const DISTRIBUTIONS = [
  ['default', null],
  ['swapped', SWAPPED_DISTRIBUTION],
];

const failures = [];
let cases = 0;

for (const [withVat, vat] of [['с НДС', 22], ['без НДС', 0]]) {
  const params = new Map([['growth', 10], ['overhead', 7], ['profit', 5], ['nds_22', vat]]);
  const tactic = buildTactic();

  for (const [distName, dist] of DISTRIBUTIONS) {
    for (const type of BOQ_TYPES) {
      for (const materialType of MATERIAL_TYPES) {
        for (const base of BASES) {
          const label = `${type}/${materialType}/${withVat}/${distName}/base=${base}`;
          const calc = (amount) => {
            // Кэш коэффициентов ключуется без параметров — сбрасываем на каждый расчёт.
            resetTypeCoefficientsCache();
            return calculateBoqItemCost(
              { id: 'x', boq_item_type: type, material_type: materialType, detail_cost_category_id: null, total_amount: amount },
              tactic, params, dist,
            );
          };
          const pos = calc(base);
          const neg = calc(-base);
          cases++;
          if (!pos || !neg) {
            failures.push(`${label}: calculateBoqItemCost вернул null`);
            continue;
          }
          if (!near(neg.materialCost, -pos.materialCost)) {
            failures.push(`${label}: материал(−base)=${neg.materialCost}, want ${-pos.materialCost}`);
          }
          if (!near(neg.workCost, -pos.workCost)) {
            failures.push(`${label}: работа(−base)=${neg.workCost}, want ${-pos.workCost}`);
          }
          if (!near(neg.markupCoefficient, pos.markupCoefficient)) {
            failures.push(`${label}: коэф. −base=${neg.markupCoefficient} ≠ +base=${pos.markupCoefficient}`);
          }
          if (!(neg.markupCoefficient >= 0) || !(pos.markupCoefficient >= 0)) {
            failures.push(`${label}: коэф. отрицательный (${neg.markupCoefficient} / ${pos.markupCoefficient})`);
          }
          if (!near(pos.materialCost + pos.workCost, base * pos.markupCoefficient)) {
            failures.push(`${label}: итог ≠ base × коэф.`);
          }
        }
      }
    }
  }
}

// Нулевая база: коэффициент 1, суммы 0 (без деления на ноль).
resetTypeCoefficientsCache();
const zero = calculateBoqItemCost(
  { id: 'z', boq_item_type: 'раб', material_type: null, detail_cost_category_id: null, total_amount: 0 },
  buildTactic(), new Map([['growth', 10], ['overhead', 7], ['profit', 5], ['nds_22', 22]]), null,
);
if (!zero || zero.markupCoefficient !== 1 || zero.materialCost !== 0 || zero.workCost !== 0) {
  failures.push(`нулевая база: ${JSON.stringify(zero)}, want коэф. 1 и нули`);
}

console.log('negativeCommercialAntisymmetry.check:');
if (failures.length > 0) {
  console.error(`\n  ✗ Антисимметрия нарушена (${failures.length}).\n`);
  for (const f of failures.slice(0, 40)) console.error('    - ' + f);
  console.error('');
  process.exit(1);
}
console.log(`  ok — ${cases} комбинаций: материал/работа/коэффициент антисимметричны по знаку базы (eps 1e-9)`);
console.log('\nnegativeCommercialAntisymmetry.check: passed');
