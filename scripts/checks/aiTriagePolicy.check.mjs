// Проверки хелперов ИИ-разбора находок — run via tsx:
//   npx tsx scripts/checks/aiTriagePolicy.check.mjs

import {
  canEditAISettings, currentAssessments, aiOkToAccept, arrangeFindings, countLabels,
  agreementRate, evidenceLabel, labelDisplay, availabilityText,
} from '../../src/lib/quality/aiTriagePolicy.ts';

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
  else console.log('  ok — ' + name);
}

const f = (id, over = {}) => ({ finding_id: id, verdict: null, rule_code: 'GA', entity_id: 'e' + id, ...over });
const a = (id, label, current = true) => ({
  finding_id: id, rule_code: 'GA', label, reason: 'r', evidence: [], current, model_id: 'm', created_at: '',
});

check('настройки — только администратор и разработчик',
  canEditAISettings('administrator') && canEditAISettings('developer') && !canEditAISettings('engineer') && !canEditAISettings(null));

const byId = currentAssessments([a('1', 'likely_ok'), a('2', 'likely_error'), a('3', 'unsure'), a('4', 'likely_ok', false)]);
check('устаревшая оценка не показывается', byId.size === 3 && !byId.has('4'));

const findings = [f('0'), f('1'), f('2'), f('3'), f('4'), f('5', { verdict: 'accepted' })];
byId.set('5', a('5', 'likely_ok'));
const accept = aiOkToAccept(findings, byId);
check('принять по ИИ — только «норма» без вердикта', accept.length === 1 && accept[0].finding_id === '1');
check('без finding_id в пачку не попадает', aiOkToAccept([f(null)], byId).length === 0);

const ordered = arrangeFindings(findings, byId, false).map((x) => x.finding_id).join();
check('сначала «ошибка», потом «не уверен», без оценки, «норма» в конце', ordered === '2,3,0,4,1,5');
const hidden = arrangeFindings(findings, byId, true).map((x) => x.finding_id).join();
check('скрыть «норму» — только без вердикта инженера', hidden === '2,3,0,4,5');

const c = countLabels(findings, byId);
check('подсчёт меток', c.assessed === 4 && c.error === 1 && c.ok === 2 && c.unsure === 1);

check('совпадение с инженером', agreementRate({ error_agreed: 3, error_missed: 1, ok_agreed: 4, ok_missed: 0, unsure: 9 }) === 7 / 8);
check('нечего сравнивать — null', agreementRate({ error_agreed: 0, error_missed: 0, ok_agreed: 0, ok_missed: 0, unsure: 5 }) === null);

check('ссылка на поле по-русски', evidenceLabel('r3.conversion_coefficient') === 'строка 3 · коэф. перевода');
check('ссылка на позицию', evidenceLabel('p1.customer_name') === 'позиция · наименование заказчика');
check('метка ошибки красная', labelDisplay('likely_error').color === 'red');
check('можно запускать — без текста-причины', availabilityText('started') === null && availabilityText('disabled') !== null);

if (failures.length) {
  console.error('\nПровалено: ' + failures.length);
  for (const x of failures) console.error('  FAIL — ' + x);
  process.exit(1);
}
console.log('\nВсе проверки пройдены.');
