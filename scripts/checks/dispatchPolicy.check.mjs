// Проверки хелперов рассылки замечаний в Telegram — run via tsx:
//   npx tsx scripts/checks/dispatchPolicy.check.mjs

import {
  dispatchableIds, resolverText, willSend, dispatchResultText, MAX_DISPATCH_FINDINGS,
} from '../../src/lib/quality/dispatchPolicy.ts';

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
  else console.log('  ok — ' + name);
}

const f = (over = {}) => ({ finding_id: 'f1', verdict: null, ...over });

check('принятые как норма не отправляются',
  dispatchableIds([f(), f({ finding_id: 'f2', verdict: 'accepted' }), f({ finding_id: 'f3', verdict: 'error' })]).join() === 'f1,f3');
check('несохранённые находки (без finding_id) не отправляются', dispatchableIds([f({ finding_id: null })]).length === 0);
check('дубли одной находки схлопываются', dispatchableIds([f(), f()]).length === 1);
check('не больше предела отправки',
  dispatchableIds(Array.from({ length: 600 }, (_, i) => f({ finding_id: 'x' + i }))).length === MAX_DISPATCH_FINDINGS);

const rec = (over = {}) => ({
  user_id: 'u', full_name: 'Иванов', linked: true, findings: 5, already_sent: 2,
  by_resolver: { item_author: 3, sender: 2 }, ...over,
});
check('основание адресации читаемо', resolverText(rec()) === 'правил строку: 3, автор не найден — вам: 2');
check('уйдёт только привязанным и без повторов', willSend([rec(), rec({ linked: false })]) === 3);
check('итог отправки', dispatchResultText({ recipients: [], queued: 3, messages: 1, duplicates: 2, unlinked: 5 })
  === 'Отправлено замечаний: 3 (сообщений: 1); уже отправлялись: 2; без Telegram: 5');

if (failures.length) {
  console.error('\nПровалено: ' + failures.length);
  for (const x of failures) console.error('  FAIL — ' + x);
  process.exit(1);
}
console.log('\nВсе проверки пройдены.');
