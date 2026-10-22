// Проверки чистых хелперов страницы «Проверка данных» — run via tsx:
//   npx tsx scripts/checks/findingsPolicy.check.mjs
//
// Без React и DOM: только src/lib/quality/findingsPolicy.ts.

import {
  findingLink, findingItemId, countNewActive, PROPOSAL_CHECKS, computeProposalReadiness,
} from '../../src/lib/quality/findingsPolicy.ts';

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
  else console.log('  ok — ' + name);
}

const finding = (over) => ({
  rule_code: 'H', rule_title: 'T', severity: 'warning', summary: 'S',
  tender_id: 't', position_number: 1, item_no: '1.1',
  entity_type: 'client_position', entity_id: 'pos-1', fingerprint: 'fp', detail: 'd',
  money_delta: null, verdict: null, note: null,
  finding_id: null, first_seen_at: null, is_new: false,
  ...over,
});
const rule = (code, status) => ({
  Code: code, Title: code, Severity: 'warning', Money: false, EntityType: 'client_position',
  Status: status, Summary: '', SQL: '',
});

// Ссылка ведёт на позицию; у находки по строке добавляется itemId
check('ссылка на позицию',
  findingLink(finding({ entity_type: 'client_position', entity_id: 'pos-9', position_id: 'pos-9' }))
    === '/positions/pos-9/items?tenderId=t&positionId=pos-9');
check('позиция без position_id — фолбэк на entity_id (старый бэкенд)',
  findingLink(finding({ entity_type: 'client_position', entity_id: 'pos-9' }))
    === '/positions/pos-9/items?tenderId=t&positionId=pos-9');
check('строка с position_id — ссылка на позицию с itemId',
  findingLink(finding({ entity_type: 'boq_item', entity_id: 'item-9', position_id: 'pos-3' }))
    === '/positions/pos-3/items?tenderId=t&positionId=pos-3&itemId=item-9');
check('строка без position_id — ссылки нет',
  findingLink(finding({ entity_type: 'boq_item', entity_id: 'item-9' })) === null);
check('строка с position_id=null — ссылки нет',
  findingLink(finding({ entity_type: 'boq_item', entity_id: 'item-9', position_id: null })) === null);
check('материал без position_id — ссылки нет',
  findingLink(finding({ entity_type: 'material_name', entity_id: 'mn-1' })) === null);
check('материал с position_id и item_id — ссылка с itemId строки',
  findingLink(finding({
    entity_type: 'material_name', entity_id: 'mn-1', position_id: 'pos-4', item_id: 'item-7',
  })) === '/positions/pos-4/items?tenderId=t&positionId=pos-4&itemId=item-7');
check('позиция с item_id — ссылка с itemId строки',
  findingLink(finding({
    entity_type: 'client_position', entity_id: 'pos-9', position_id: 'pos-9', item_id: 'item-2',
  })) === '/positions/pos-9/items?tenderId=t&positionId=pos-9&itemId=item-2');
check('findingItemId: строка без item_id — её entity_id',
  findingItemId(finding({ entity_type: 'boq_item', entity_id: 'item-9' })) === 'item-9');
check('findingItemId: позиция без item_id — null',
  findingItemId(finding({ entity_type: 'client_position', entity_id: 'pos-9' })) === null);
check('findingItemId: item_id имеет приоритет',
  findingItemId(finding({ entity_type: 'boq_item', entity_id: 'a', item_id: 'b' })) === 'b');

// Новые: считаются только не принятые
check('новые без принятых', countNewActive([
  finding({ is_new: true }), finding({ is_new: true, verdict: 'accepted' }), finding({ is_new: false }),
]) === 1);

// Пустой список находок при активных правилах = готов
const allActive = PROPOSAL_CHECKS.map((c) => rule(c.code, 'active'));
const readyState = computeProposalReadiness([], allActive);
check('нет находок при активных правилах → готов',
  readyState.ready === true && readyState.findingsCount === 0 && readyState.notCheckedCount === 0);

// Ключевое: выключенное правило НЕ считается пройденной проверкой
const withDraft = PROPOSAL_CHECKS.map((c, i) => rule(c.code, i === 0 ? 'draft' : 'active'));
const draftState = computeProposalReadiness([], withDraft);
check('выключенное правило не выдаётся за пройденную проверку',
  draftState.ready === false && draftState.notCheckedCount === 1);
check('выключенное правило помечено not_checked',
  draftState.checks.find((c) => c.code === PROPOSAL_CHECKS[0].code).status === 'not_checked');

// Пустой каталог (ещё не загружен) — не «готов»
const emptyCatalog = computeProposalReadiness([], []);
check('пустой каталог не даёт готовности',
  emptyCatalog.ready === false && emptyCatalog.notCheckedCount === PROPOSAL_CHECKS.length);

// Находки считаются, принятые — нет
const counted = computeProposalReadiness([
  finding({ rule_code: 'H', entity_id: 'a' }),
  finding({ rule_code: 'H', entity_id: 'b' }),
  finding({ rule_code: 'H', entity_id: 'c', verdict: 'accepted' }),
], allActive);
check('принятые находки не мешают сборке',
  counted.findingsCount === 2 && counted.checks.find((c) => c.code === 'H').count === 2);
check('находки делают тендер неготовым', counted.ready === false);

// Находки по правилам вне чек-листа не влияют на готовность КП
const unrelated = computeProposalReadiness([finding({ rule_code: 'Q', entity_id: 'x' })], allActive);
check('посторонние правила не влияют на готовность КП', unrelated.ready === true);

if (failures.length) {
  console.error('\nПровалено: ' + failures.length);
  for (const f of failures) console.error('  FAIL — ' + f);
  process.exit(1);
}
console.log('\nВсе проверки пройдены.');
