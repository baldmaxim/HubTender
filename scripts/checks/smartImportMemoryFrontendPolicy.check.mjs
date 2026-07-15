// Этап 2.3 focused frontend checks — run via tsx:
//   npx tsx scripts/checks/smartImportMemoryFrontendPolicy.check.mjs

import { readFileSync } from 'node:fs';
import {
  ALIAS_BADGE_TEXT, MEMORY_SAVE_FAILED_TEXT, PROFILE_CHANGED_BADGE,
  PROFILE_REQUIRES_REVIEW_TEXT, REMEMBER_DEFAULT, aliasBadge, aliasIssueState,
  bulkConfirmRemembers, deactivateConfirmText, importSucceededDespiteMemoryFailure,
  mappingDiffersFromProfile, matchSourceLabel, memorySummaryText,
  profileChoiceState, profileSaveEligibility, profileSourcedFields,
  profileStatusDisplay,
} from '../../src/lib/quality/smartImportMemoryPolicy.ts';
import { selectionsForExecute } from '../../src/lib/quality/aiNomenclaturePolicy.ts';

const failures = [];
const check = (name, cond) => { cond ? console.log('  ok — ' + name) : failures.push(name); };

const profile = (over = {}) => ({
  id: 'p-1', name: 'Смета X', status: 'usable', use_count: 3, last_used_at: '2026-07-01', ...over,
});
const memory = (over = {}) => ({
  header_signature: 'sig', profile_match: 'one', profiles: [profile()], ...over,
});

// 1. Один профиль → предложение (не применение).
check('one profile suggested', profileChoiceState(memory()).mode === 'one'
  && profileChoiceState(memory()).profiles.length === 1);

// 2. Несколько профилей → обязательный выбор.
check('multiple profiles require choice',
  profileChoiceState(memory({ profile_match: 'multiple', profiles: [profile(), profile({ id: 'p-2' })] })).mode === 'multiple'
  && profileChoiceState(undefined).mode === 'none');

// 3-4. Применение/отказ — только явные кнопки в баннере.
const banner = readFileSync(new URL('../../src/pages/ClientPositions/components/MappingProfileBanner.tsx', import.meta.url), 'utf-8');
check('apply profile — явная кнопка', banner.includes('Применить') && banner.includes('onApply(choice.profiles[0].id)'));
check('reject profile — «Не использовать»', banner.includes('Не использовать') && banner.includes('onReject'));

// 5. Изменение mapping относительно профиля.
check('mapping differs from profile',
  mappingDiffersFromProfile(memory({ applied_profile_status: 'applied', applied_fields: ['quantity'] }), { unit_rate: 'F' }) === true
  && mappingDiffersFromProfile(memory({ applied_profile_status: 'applied', applied_fields: ['quantity'] }), {}) === false
  && PROFILE_CHANGED_BADGE.includes('Изменено'));

// 6-7. Save new / update existing — только явно.
check('save/update eligibility',
  profileSaveEligibility(memory({ applied_profile_status: 'applied' })).canUpdateApplied === true
  && profileSaveEligibility(undefined).canUpdateApplied === false
  && banner.includes('Обновить профиль после успешного импорта')
  && banner.includes('Сохранить это сопоставление как профиль'));

// 8. Старый профиль → requires review.
check('old profile requires review',
  profileStatusDisplay('requires_review').label === 'требует проверки'
  && PROFILE_REQUIRES_REVIEW_TEXT.includes('пересохраните')
  && banner.includes('PROFILE_REQUIRES_REVIEW_TEXT'));

// 9. Alias badge.
const previewRow = {
  excel_row: 5, status: 'ready',
  alias_provenance: { match_method: 'user_approved_alias', alias_id: 'a-1', catalog_id: 'm-1', use_count: 4, source_label: 'Подтверждено вами ранее' },
};
check('alias badge', aliasBadge(previewRow)?.aliasId === 'a-1'
  && aliasBadge({ excel_row: 1, status: 'ready' }) === null
  && ALIAS_BADGE_TEXT === 'Подтверждено вами ранее');

// 10-11. Alias можно изменить и забыть.
const aliasActions = readFileSync(new URL('../../src/pages/ClientPositions/components/AliasRowActions.tsx', import.meta.url), 'utf-8');
check('alias can be changed', aliasActions.includes('Изменить') && aliasActions.includes('onManualPick'));
check('alias can be forgotten', aliasActions.includes('Забыть соответствие')
  && aliasActions.includes('deactivateNomenclatureAlias') && aliasActions.includes('Modal.confirm'));

// 12-14. Remember default false; отдельный checkbox.
const panel = readFileSync(new URL('../../src/pages/ClientPositions/components/NomenclatureSuggestPanel.tsx', import.meta.url), 'utf-8');
check('AI suggestion not remembered by default', REMEMBER_DEFAULT === false
  && selectionsForExecute({ 'Смета|3': { catalogId: 'm-1', label: 'x', source: 'ai_confirmed' } })[0].remember_selection === false);
check('manual selection not remembered by default',
  selectionsForExecute({ 'Смета|3': { catalogId: 'm-1', label: 'x', source: 'manual' } })[0].remember_selection === false);
check('remember checkbox явный',
  panel.includes('REMEMBER_LABEL') && panel.includes('sel.remember === true')
  && !panel.includes('remember: true,')); // никакого хардкода remember=true

// 15. Bulk-подтверждение НЕ подразумевает запоминание.
check('bulk does not imply remember',
  bulkConfirmRemembers(false) === false && bulkConfirmRemembers(true) === true
  && panel.includes('let rememberAll = false')
  && panel.includes('defaultChecked={false}'));

// 16-17. Конфликт/недоступная цель — блокирующие состояния от сервера.
check('alias conflict state', aliasIssueState([{ code: 'NOMENCLATURE_ALIAS_CONFLICT' }]).hasConflict === true);
check('unavailable target state',
  aliasIssueState([{ code: 'NOMENCLATURE_ALIAS_TARGET_UNAVAILABLE' }]).hasUnavailableTarget === true
  && aliasIssueState([{ code: 'NOMENCLATURE_ALIAS_REQUIRES_REVIEW' }]).hasStale === true);

// 18. Сбой памяти не меняет успех импорта в UI.
const wizard = readFileSync(new URL('../../src/pages/ClientPositions/components/SmartImportWizard.tsx', import.meta.url), 'utf-8');
check('memory save failure does not change import success UI',
  importSucceededDespiteMemoryFailure({ memory_saved: false, warnings: ['IMPORT_MEMORY_SAVE_FAILED'] }) === true
  && importSucceededDespiteMemoryFailure({ memory_saved: true, warnings: [] }) === false
  && MEMORY_SAVE_FAILED_TEXT.includes('Импорт выполнен успешно')
  && wizard.includes('memoryFailed') && wizard.includes('Импорт выполнен'));

// 19. Замена файла сбрасывает profile/alias-состояние.
check('file replacement resets memory state',
  wizard.includes('setProfileId(undefined); // §19.19')
  && wizard.includes('setSelections({});'));

// 20. Управление памятью без финансовых полей.
const drawer = readFileSync(new URL('../../src/pages/ClientPositions/components/ImportMemoryDrawer.tsx', import.meta.url), 'utf-8');
const memApi = readFileSync(new URL('../../src/lib/api/importMemory.ts', import.meta.url), 'utf-8');
check('management has no financial fields',
  !/unit_rate|total_amount|quantity|price/.test(drawer)
  && !/unit_rate|total_amount|quantity|price/.test(memApi));

// 21. Управление не запускает импорт.
check('management does not trigger import',
  !drawer.includes('executeBoqImport') && !drawer.includes('analyzeBoqImport')
  && drawer.includes('не изменяют импортированные данные'));

// 22. Источники решений различимы.
check('source labels distinct',
  new Set([matchSourceLabel('exact'), matchSourceLabel('alias'), matchSourceLabel('ai'), matchSourceLabel('manual')]).size === 4);

// 23. Server response — единственный authority (summary строится из ответа).
check('server response is authority',
  memorySummaryText({
    mapping_profile: { applied: true, profile_name: 'X', saved: false, updated: true },
    nomenclature: { approved_alias_matches: 3, aliases_saved: 2 },
  }).includes('профиль «X»')
  && memorySummaryText(undefined) === ''
  && wizard.includes('memorySummaryText(res.memory)')
  && !wizard.match(/memory_saved\s*=\s*true/)); // клиент не выдумывает результат

// 24. user_id не передаётся с фронта (§15): нет ни параметра, ни поля.
const sendsUserID = (code) => /user_id["']?\s*[:=]|[?&]user_id=|append\(['"]user_id/.test(code);
check('frontend does not send user_id', !sendsUserID(memApi) && !sendsUserID(wizard));

console.log('smartImportMemoryFrontendPolicy.check:');
if (failures.length > 0) {
  console.error('\n  ✗ FAILED:\n');
  for (const f of failures) console.error('    - ' + f);
  process.exit(1);
}
console.log('\nsmartImportMemoryFrontendPolicy.check: passed (24 checks)');
