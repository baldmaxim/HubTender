// Этап 2.2 focused frontend checks — run via tsx:
//   npx tsx scripts/checks/aiNomenclatureFrontendPolicy.check.mjs

import { readFileSync } from 'node:fs';
import {
  ABSTAIN_TEXT, AI_DISCLOSURE_TEXT, DATA_MINIMIZATION_TEXT,
  bulkConfirmDialogText, bulkConfirmableRows, candidateById, isAcceptable,
  isBulkConfirmEligible, providerStatusDisplay, rowReferenceOf,
  selectionSummary, selectionsForExecute, suggestionConfidenceDisplay,
  suggestionStatusText, suggestionsStale, unresolvedNomenclatureRefs,
} from '../../src/lib/quality/aiNomenclaturePolicy.ts';

const failures = [];
const check = (name, cond) => { cond ? console.log('  ok — ' + name) : failures.push(name); };

const cand = (over = {}) => ({
  id: 'c-1', label: 'Бетон М150', type: 'material', unit: 'м3',
  deterministic_score: 0.9, unit_compatibility: 'exact', category_compatibility: 'unknown',
  ...over,
});
const row = (over = {}) => ({
  row_reference: 'Смета|5', excel_row: 5, source_description: 'Бетон М150',
  source_type: 'мат', source_unit: 'м3', status: 'suggested', confidence: 'high',
  selected_candidate_id: 'c-1', candidates: [cand()], ...over,
});

// 1-4. Отображение уверенности (§16).
check('confidence high → «высокая»', suggestionConfidenceDisplay('high').label === 'высокая');
check('confidence medium → «средняя»', suggestionConfidenceDisplay('medium').label === 'средняя');
check('confidence low → «низкая»', suggestionConfidenceDisplay('low').label === 'низкая');
check('confidence abstain → «выбор не определён»',
  suggestionConfidenceDisplay('abstain').label === 'выбор не определён'
  && suggestionConfidenceDisplay('').label === 'выбор не определён');

// 5. Abstain-текст (§16).
check('abstain text', ABSTAIN_TEXT.includes('Подходящий вариант не определён')
  && suggestionStatusText(row({ status: 'abstain' })) === ABSTAIN_TEXT);

// 6-8. Статусы провайдера (§11): деградация без блокировки импорта.
check('provider available → без алерта', providerStatusDisplay('available') === null);
check('provider disabled → info', providerStatusDisplay('disabled')?.tone === 'info'
  && providerStatusDisplay('disabled').text.includes('детерминированные'));
check('provider timeout/unavailable → warning, ручной путь не заблокирован',
  providerStatusDisplay('timeout')?.tone === 'warning'
  && providerStatusDisplay('unavailable').text.includes('не заблокирован'));

// 9-10. Раскрытие информации (§16).
check('disclosure: предложение требует подтверждения',
  AI_DISCLOSURE_TEXT.includes('автоматически') && AI_DISCLOSURE_TEXT.includes('подтверждения'));
check('data minimization: деньги не передаются',
  DATA_MINIMIZATION_TEXT.includes('НЕ передаются') && DATA_MINIMIZATION_TEXT.includes('цены'));

// 11-12. Принятие предложения (§16).
check('isAcceptable требует suggested + candidate',
  isAcceptable(row()) === true
  && isAcceptable(row({ selected_candidate_id: null })) === false
  && isAcceptable(row({ status: 'abstain' })) === false
  && isAcceptable(row({ selected_candidate_id: 'ghost' })) === false);
check('candidateById ищет только в серверном списке',
  candidateById(row(), 'c-1')?.label === 'Бетон М150' && candidateById(row(), 'other') === null);

// 13-16. Bulk-подтверждение (§16): только high и без конфликтов.
check('bulk: high без конфликтов допустим', isBulkConfirmEligible(row()) === true);
check('bulk: medium исключён', isBulkConfirmEligible(row({ confidence: 'medium' })) === false);
check('bulk: unit conflict исключён',
  isBulkConfirmEligible(row({ candidates: [cand({ unit_compatibility: 'conflict' })] })) === false);
check('bulk: significant token / feature conflict исключён',
  isBulkConfirmEligible(row({ candidates: [cand({ significant_token_conflict: true })] })) === false
  && isBulkConfirmEligible(row({ conflicting_features: ['марка'] })) === false);

// 17. Bulk не трогает уже подтверждённые строки.
check('bulk пропускает подтверждённые',
  bulkConfirmableRows([row()], { 'Смета|5': { catalogId: 'c-1', label: 'x', source: 'manual' } }).length === 0
  && bulkConfirmableRows([row()], {}).length === 1);

// 18. Диалог bulk-подтверждения обязателен.
check('bulk dialog text', bulkConfirmDialogText(3).includes('3')
  && bulkConfirmDialogText(3).includes('Продолжить'));

// 19. Payload execute: только допустимые источники, формат row_reference.
const payload = selectionsForExecute({
  'Смета|5': { catalogId: 'c-1', label: 'Бетон', source: 'ai_confirmed' },
  'Смета|7': { catalogId: 'c-9', label: 'Кирпич', source: 'manual' },
});
check('selectionsForExecute формат и источники',
  payload.length === 2
  && payload.every((p) => ['exact', 'ai_confirmed', 'manual'].includes(p.selection_source))
  && payload.some((p) => p.row_reference === 'Смета|5' && p.catalog_id === 'c-1')
  && rowReferenceOf('Смета', 5) === 'Смета|5');

// 20. Сводка подтверждений.
const sum = selectionSummary({
  a: { catalogId: '1', label: '', source: 'ai_confirmed' },
  b: { catalogId: '2', label: '', source: 'manual' },
  c: { catalogId: '3', label: '', source: 'manual' },
});
check('selectionSummary счётчики', sum.total === 3 && sum.ai === 1 && sum.manual === 2);

// 21. Смена fingerprint аннулирует предложения (§15).
check('suggestionsStale по fingerprint',
  suggestionsStale('aaa', 'bbb') === true && suggestionsStale('aaa', 'aaa') === false);

// 22. Unresolved-строки: только nomenclature-блокеры, без дублей.
const refs = unresolvedNomenclatureRefs([
  { id: '1', code: 'NOMENCLATURE_NOT_FOUND', severity: 'blocker', sheet: 'Смета', excel_row: 5, message: '' },
  { id: '2', code: 'NOMENCLATURE_NOT_FOUND', severity: 'blocker', sheet: 'Смета', excel_row: 5, message: '' },
  { id: '3', code: 'NOMENCLATURE_AMBIGUOUS', severity: 'blocker', sheet: 'Смета', excel_row: 7, message: '' },
  { id: '4', code: 'CURRENCY_UNKNOWN', severity: 'blocker', sheet: 'Смета', excel_row: 8, message: '' },
], 'Смета');
check('unresolvedNomenclatureRefs фильтр и дедуп',
  refs.length === 2 && refs[0] === 'Смета|5' && refs[1] === 'Смета|7');

// 23. Панель: явное действие пользователя, авто-подбор запрещён (§12/§16).
const panel = readFileSync(new URL('../../src/pages/ClientPositions/components/NomenclatureSuggestPanel.tsx', import.meta.url), 'utf-8');
check('suggest только по кнопке, без auto-select',
  panel.includes('Подобрать номенклатуру') && panel.includes('onClick={runSuggest}')
  && !panel.match(/useEffect\([^)]*runSuggest/s)
  && panel.includes('Modal.confirm'));

// 24. Ручной fallback (§17): существующий справочный API + клиентский фильтр.
check('manual fallback через существующий API',
  panel.includes('listWorkNames') && panel.includes('listMaterialNames')
  && panel.includes('filterOption') && panel.includes('Очистить'));

// 25. Wizard: selections уходят на сервер и сбрасываются при новом файле.
const wizard = readFileSync(new URL('../../src/pages/ClientPositions/components/SmartImportWizard.tsx', import.meta.url), 'utf-8');
const api = readFileSync(new URL('../../src/lib/api/boqSmartImport.ts', import.meta.url), 'utf-8');
check('wizard передаёт selections и сбрасывает при reset',
  wizard.includes('selectionsForExecute(selections)') && wizard.includes('setSelections({})')
  && api.includes("form.append('nomenclature_selections'")
  && !api.match(/suggestNomenclature[\s\S]{0,400}quantity/)); // suggest payload без количеств

console.log('aiNomenclatureFrontendPolicy.check:');
if (failures.length > 0) {
  console.error('\n  ✗ FAILED:\n');
  for (const f of failures) console.error('    - ' + f);
  process.exit(1);
}
console.log('\naiNomenclatureFrontendPolicy.check: passed (25 checks)');
