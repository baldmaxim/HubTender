// Проверки чистых хелперов страницы «Проверка данных» — run via tsx:
//   npx tsx scripts/checks/findingsPolicy.check.mjs
//
// Без React и DOM: только src/lib/quality/findingsPolicy.ts.

import {
  RULE_ENTITY_KIND, entityKindForRule, findingLink,
  PROPOSAL_CHECKS, computeProposalReadiness,
} from '../../src/lib/quality/findingsPolicy.ts';

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
  else console.log('  ok — ' + name);
}

const finding = (over) => ({
  rule_code: 'H', rule_title: 'T', severity: 'warning', summary: 'S',
  tender_id: 't', position_number: 1, item_no: '1.1',
  entity_id: 'pos-1', fingerprint: 'fp', detail: 'd', money_delta: null,
  verdict: null, note: null,
  ...over,
});
const rule = (code, status) => ({
  Code: code, Title: code, Severity: 'warning', Money: false,
  Status: status, Summary: '', SQL: '',
});

// 1. Тип сущности выводится из кода правила
check('позиционные правила дают position',
  entityKindForRule('H') === 'position' && entityKindForRule('V') === 'position');
check('строчные правила дают boq_item',
  entityKindForRule('Q') === 'boq_item' && entityKindForRule('I') === 'boq_item');
check('P указывает на номенклатуру', entityKindForRule('P') === 'material_name');
check('неизвестный код даёт null', entityKindForRule('ZZZ') === null);

// 2. Каждая проверка чек-листа КП описана в карте сущностей — иначе переход
//    к строке для неё молча не работает.
check('все коды чек-листа КП есть в карте сущностей',
  PROPOSAL_CHECKS.every((c) => RULE_ENTITY_KIND[c.code] !== undefined));

// 3. Ссылка строится только для позиций
check('ссылка на позицию',
  findingLink(finding({ rule_code: 'H', entity_id: 'pos-9' })) === '/positions/pos-9/items');
check('для находки по строке ссылки нет',
  findingLink(finding({ rule_code: 'Q', entity_id: 'item-9' })) === null);

// 4. Пустой список находок при активных правилах = готов
const allActive = PROPOSAL_CHECKS.map((c) => rule(c.code, 'active'));
const readyState = computeProposalReadiness([], allActive);
check('нет находок при активных правилах → готов',
  readyState.ready === true && readyState.findingsCount === 0 && readyState.notCheckedCount === 0);

// 5. Ключевое: выключенное правило НЕ считается пройденной проверкой
const withDraft = PROPOSAL_CHECKS.map((c, i) => rule(c.code, i === 0 ? 'draft' : 'active'));
const draftState = computeProposalReadiness([], withDraft);
check('выключенное правило не выдаётся за пройденную проверку',
  draftState.ready === false && draftState.notCheckedCount === 1);
check('выключенное правило помечено not_checked',
  draftState.checks.find((c) => c.code === PROPOSAL_CHECKS[0].code).status === 'not_checked');

// 6. Пустой каталог (ещё не загружен) — не «готов»
const emptyCatalog = computeProposalReadiness([], []);
check('пустой каталог не даёт готовности',
  emptyCatalog.ready === false && emptyCatalog.notCheckedCount === PROPOSAL_CHECKS.length);

// 7. Находки считаются, принятые — нет
const counted = computeProposalReadiness([
  finding({ rule_code: 'H', entity_id: 'a' }),
  finding({ rule_code: 'H', entity_id: 'b' }),
  finding({ rule_code: 'H', entity_id: 'c', verdict: 'accepted' }),
], allActive);
check('принятые находки не мешают сборке',
  counted.findingsCount === 2 && counted.checks.find((c) => c.code === 'H').count === 2);
check('находки делают тендер неготовым', counted.ready === false);

// 8. Находки по правилам вне чек-листа не влияют на готовность КП
const unrelated = computeProposalReadiness([finding({ rule_code: 'Q', entity_id: 'x' })], allActive);
check('посторонние правила не влияют на готовность КП', unrelated.ready === true);

if (failures.length) {
  console.error('\nПровалено: ' + failures.length);
  for (const f of failures) console.error('  FAIL — ' + f);
  process.exit(1);
}
console.log('\nВсе проверки пройдены.');
