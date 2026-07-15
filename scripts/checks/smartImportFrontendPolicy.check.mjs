// Этап 2.1 focused frontend checks — run via tsx:
//   npx tsx scripts/checks/smartImportFrontendPolicy.check.mjs

import { readFileSync } from 'node:fs';
import {
  WIZARD_STEPS, confidenceDisplay, rowStatusDisplay, unresolvedRequired,
  isExecuteReady, filterIssues, filterPreviewRows, candidateOptions,
  resultSummaryText, sheetNeedsConfirmation, FINGERPRINT_MISMATCH_TEXT,
} from '../../src/lib/quality/smartImportPolicy.ts';

const failures = [];
const check = (name, cond) => { cond ? console.log('  ok — ' + name) : failures.push(name); };

const baseAnalysis = (over = {}) => ({
  summary: {
    rows_total: 10, rows_ready: 8, rows_with_warnings: 1, rows_blocked: 0,
    rows_skipped: 1, required_mappings_missing: 0, formula_confirmations_required: 0,
    ...(over.summary ?? {}),
  },
  mapping: over.mapping ?? [
    { target_field: 'quantity', label: 'Количество', required: true, source_column: 'E', confidence: 'high', confidence_percent: 95 },
  ],
  sheets: over.sheets ?? [{ name: 'Смета', suggested: true }],
  sheet_confidence: over.sheet_confidence ?? 'high',
});

// 1. Wizard step order.
check('wizard step order',
  WIZARD_STEPS.length === 6 && WIZARD_STEPS[0] === 'Файл' && WIZARD_STEPS[2] === 'Сопоставление колонок' &&
  WIZARD_STEPS[4] === 'Импорт' && WIZARD_STEPS[5] === 'Результат');

// 2-5. confidence display.
check('high confidence', confidenceDisplay('high').label === 'Высокая');
check('medium confidence', confidenceDisplay('medium').label === 'Средняя');
check('low confidence', confidenceDisplay('low').label === 'Низкая');
check('unresolved mapping', confidenceDisplay('unresolved').label === 'Не определено');

// 6. required mapping blocks execute.
check('required mapping blocks execute',
  isExecuteReady(baseAnalysis({
    mapping: [{ target_field: 'quantity', label: 'Количество', required: true, confidence: 'unresolved' }],
  }), true, true) === false &&
  unresolvedRequired([{ target_field: 'q', label: 'Q', required: true }]).length === 1);

// 7. row blocker blocks execute.
check('row blocker blocks execute',
  isExecuteReady(baseAnalysis({ summary: { rows_blocked: 3 } }), true, true) === false);

// 8. warning does not block.
check('warning does not block',
  isExecuteReady(baseAnalysis({ summary: { rows_with_warnings: 5 } }), true, true) === true);

// 9. formula confirmation.
check('formula confirmation required',
  isExecuteReady(baseAnalysis({ summary: { formula_confirmations_required: 2 } }), false, true) === false &&
  isExecuteReady(baseAnalysis({ summary: { formula_confirmations_required: 2 } }), true, true) === true);

// 10. fingerprint mismatch.
check('fingerprint mismatch blocks',
  isExecuteReady(baseAnalysis(), true, false) === false &&
  FINGERPRINT_MISMATCH_TEXT.includes('заново'));

// 11. mapping override — страница шлёт overrides на сервер и пересчитывает.
const wizard = readFileSync(new URL('../../src/pages/ClientPositions/components/SmartImportWizard.tsx', import.meta.url), 'utf-8');
check('mapping override → server reanalyze',
  wizard.includes('setOverrides') && wizard.includes('mapping: overrides') && wizard.includes('reanalyze'));

// 12. raw/normalized display: transformations показываются.
check('raw/normalized display', wizard.includes('transformations') && wizard.includes('→'));

// 13. issue filter.
const issues = [
  { id: '1', severity: 'blocker' }, { id: '2', severity: 'warning' }, { id: '3', severity: 'information' },
];
check('issue filter',
  filterIssues(issues, 'blocker').length === 1 && filterIssues(issues, 'all').length === 3);

// 14. skipped rows.
const rows = [
  { excel_row: 2, status: 'ready' }, { excel_row: 3, status: 'skipped', skip_code: 'SKIPPED_FOOTER' },
  { excel_row: 4, status: 'blocked' },
];
check('skipped rows filter',
  filterPreviewRows(rows, 'skipped').length === 1 &&
  filterPreviewRows(rows, 'skipped')[0].skip_code === 'SKIPPED_FOOTER');

// 15. result mismatch count.
check('result mismatch count',
  resultSummaryText(100, 3, 5).includes('100') &&
  resultSummaryText(100, 3, 5).includes('расхождений') &&
  resultSummaryText(100, 3, 5).includes('3'));

// 16-17. import success/backend failure: результат только после ответа сервера.
check('import success only after server response',
  wizard.includes('await executeBoqImport') && wizard.includes('setStep(5)') &&
  wizard.indexOf('await executeBoqImport') < wizard.indexOf('setStep(5)'));
check('backend failure keeps wizard on execute step',
  wizard.includes('setError(getErrorMessage(e))') && !wizard.includes("setStep(5);\n      setError"));

// 18. file replacement clears analysis.
check('file replacement clears analysis',
  wizard.includes('const onFile = async (f: File) => {') && wizard.includes('reset();\n    setFile(f);'));

// 19. ambiguous sheet requires confirmation.
check('ambiguous sheet requires confirmation',
  sheetNeedsConfirmation({ sheet_confidence: 'medium', sheets: [{}, {}] }) === true &&
  sheetNeedsConfirmation({ sheet_confidence: 'high', sheets: [{}, {}] }) === false);

// 20. client total не используется как authoritative.
const api = readFileSync(new URL('../../src/lib/api/boqSmartImport.ts', import.meta.url), 'utf-8');
check('no client total authority',
  !api.includes('total_amount') && !wizard.includes('total_amount') &&
  api.includes('не считает деньги'));

// 21. preview не помечается импортированным до ответа сервера.
check('no preview marked imported before server response',
  !wizard.includes('Импортировано (preview)') &&
  wizard.includes('Импорт выполнен сервером'));

// бонус: candidates сортировку не пересчитываем.
check('candidates keep server order',
  candidateOptions({ candidates: [{ source_column: 'B', source_header: 'x', score: 0.9 }, { source_column: 'A', source_header: 'y', score: 0.5 }] })[0].value === 'B');

console.log('smartImportFrontendPolicy.check:');
if (failures.length > 0) {
  console.error('\n  ✗ FAILED:\n');
  for (const f of failures) console.error('    - ' + f);
  process.exit(1);
}
console.log('\nsmartImportFrontendPolicy.check: passed (22 checks)');
