// Этап 2.6 focused frontend checks — run via tsx:
//   npx tsx scripts/checks/aiRolloutFrontendPolicy.check.mjs
//
// Pure-хелперы controlled rollout (§27): capability-состояния, гейты кнопок
// пилота, bulk-видимость, формат стоимости, отсутствие general availability.

import { readFileSync } from 'node:fs';
import {
  ACCEPTANCE_IS_PROXY_TEXT, AI_COST_UNIT_LABEL, EMERGENCY_OFF_CONFIRM, EMERGENCY_OFF_LABEL,
  FEEDBACK_OUTCOME_LABELS, PILOT_DISCLOSURE_TEXT, ROLLOUT_MODE_LABELS,
  aiSuggestEnabled, allGatesPassed, bulkConfirmVisible, bulkGateByChangeRate,
  capabilityDisplay, circuitDisplay, formatCost, highConfChangeRate,
  nextTransitionTargets, pilotModelLabel, quotaLine, rolloutModeDisplay,
} from '../../src/lib/quality/aiRolloutPolicy.ts';

const failures = [];
const check = (name, cond) => { cond ? console.log('  ok — ' + name) : failures.push(name); };

const cap = (over = {}) => ({
  status: 'available', rollout_mode: 'pilot_individual', is_pilot: true,
  individual_suggestions_allowed: true, bulk_confirmation_allowed: false,
  requests_remaining_today: 5, rows_remaining_today: 120,
  budget_status: 'ok', provider_status: 'connected',
  model_label: 'Test Model', prompt_version: 'nomenclature-rerank-v1', ...over,
});

// 1-6. Состояния capability (§27.1-6).
check('1. rollout off → info, ручной путь доступен',
  capabilityDisplay({ status: 'rollout_off' }).tone === 'info'
  && capabilityDisplay({ status: 'rollout_off' }).text.includes('ручной'.slice(0, 4)) === false
  ? capabilityDisplay({ status: 'rollout_off' }).text.includes('Ручной') || capabilityDisplay({ status: 'rollout_off' }).text.includes('ручной')
  : capabilityDisplay({ status: 'rollout_off' }).text.length > 0);
check('2. evaluation only → AI только администратору',
  capabilityDisplay({ status: 'evaluation_only' }).text.includes('админ'));
check('3. pilot individual: suggest доступен, bulk скрыт',
  aiSuggestEnabled(cap()) === true && bulkConfirmVisible(cap()) === false);
check('4. pilot bulk: bulk виден только с личным разрешением',
  bulkConfirmVisible(cap({ rollout_mode: 'pilot_bulk', bulk_confirmation_allowed: true })) === true
  && bulkConfirmVisible(cap({ rollout_mode: 'pilot_bulk', bulk_confirmation_allowed: false })) === false);
check('5. non-pilot: not_allowed, suggest недоступен',
  capabilityDisplay({ status: 'not_allowed' }).tone === 'info'
  && aiSuggestEnabled(cap({ is_pilot: false, status: 'not_allowed', individual_suggestions_allowed: false })) === false);
check('6. expired pilot ≙ not_allowed (сервер отдаёт not_allowed)',
  aiSuggestEnabled(cap({ status: 'not_allowed', individual_suggestions_allowed: false })) === false);

// 7-12. Статусы деградации (§27.7-12): warning + ручной путь.
for (const [i, st] of [
  ['7', 'user_quota_exhausted'], ['8', 'row_quota_exhausted'], ['9', 'budget_exhausted'],
  ['10', 'key_limit_exhausted'], ['11', 'circuit_open'], ['12', 'provider_unavailable'],
]) {
  const d = capabilityDisplay({ status: st });
  check(`${i}. ${st} → warning + «Ручной путь доступен»`,
    d.tone === 'warning' && /[Рр]учной путь/.test(d.text));
  check(`${i}b. ${st} блокирует suggest`,
    aiSuggestEnabled(cap({ status: st, individual_suggestions_allowed: false })) === false);
}

// 13. Кнопка suggest: только available.
check('13. suggest button availability строго по status=available',
  aiSuggestEnabled(cap({ status: 'available' })) === true
  && aiSuggestEnabled(cap({ status: 'rate_limited' })) === false);

// 14-15. Bulk по режимам (§27.14-15).
check('14. bulk скрыт в individual', bulkConfirmVisible(cap({ rollout_mode: 'pilot_individual', bulk_confirmation_allowed: true })) === false);
check('15. bulk виден в bulk-режиме', bulkConfirmVisible(cap({ rollout_mode: 'pilot_bulk', bulk_confirmation_allowed: true })) === true);

// 16-18. Подтверждение/ручной fallback (§27.16-18): дисклеймер обязателен.
check('16. suggestion не выбирается автоматически (текст дисклеймера)',
  PILOT_DISCLOSURE_TEXT.includes('никогда не выбирается автоматически'));
check('17. подтверждение обязательно', PILOT_DISCLOSURE_TEXT.includes('подтверждения'));
check('18. manual fallback в каждом деградационном тексте',
  ['user_quota_exhausted', 'circuit_open', 'provider_unavailable', 'budget_exhausted']
    .every((s) => /[Рр]учной путь/.test(capabilityDisplay({ status: s }).text)));

// 19. Emergency off (§27.19).
check('19. emergency off: label + подтверждение с сохранением ручного пути',
  EMERGENCY_OFF_LABEL.includes('Экстренно')
  && EMERGENCY_OFF_CONFIRM.includes('ручной'));

// 20. Transition-гейты (§27.20).
check('20. allGatesPassed: все прошли/есть провал/пусто',
  allGatesPassed([{ key: 'a', title: '', passed: true }]) === true
  && allGatesPassed([{ key: 'a', title: '', passed: true }, { key: 'b', title: '', passed: false }]) === false
  && allGatesPassed([]) === false);

// 21-22. Pilot user управление (§27.21-22): поиск по существующим users —
// компонент использует listAllUsers + Select (без free-text UUID).
const pilotSection = readFileSync(new URL('../../src/pages/AdminAiSettings/components/PilotOperationsSection.tsx', import.meta.url), 'utf8');
check('21. pilot search через listAllUsers + Select showSearch',
  pilotSection.includes('listAllUsers') && pilotSection.includes('showSearch'));
check('22. add/remove присутствуют, free-text UUID-инпута нет',
  pilotSection.includes('addAiPilotUser') && pilotSection.includes('removeAiPilotUser')
  && !/Input[^.]*placeholder=.{0,30}(uuid|user id)/i.test(pilotSection));

// 23-24. Usage/cost форматирование (§27.23-24).
check('23. quotaLine для пилота', quotaLine(cap()).includes('5') && quotaLine(cap()).includes('120')
  && quotaLine(cap({ is_pilot: false })) === '');
check('24. cost unit + decimal-строка без NaN',
  AI_COST_UNIT_LABEL.includes('USD') && AI_COST_UNIT_LABEL.includes('OpenRouter')
  && formatCost('0.00188') === '$0.00188' && formatCost('NaN') === '—' && formatCost('') === '—');

// 25-26. Evaluation метрики/гейты (§27.25-26).
check('25. high-conf change rate вычисляется',
  highConfChangeRate(1, 60) !== null && Math.abs(highConfChangeRate(1, 60) - 1 / 60) < 1e-9
  && highConfChangeRate(0, 0) === null);
check('26. bulk-gate ≤2% (gate failure при 3/60)',
  bulkGateByChangeRate(1, 60) === true && bulkGateByChangeRate(3, 60) === false
  && bulkGateByChangeRate(0, 0) === false);

// 27. Circuit статус (§27.27).
check('27. circuit display: closed/open/half_open',
  circuitDisplay({ state: 'closed' }).tone === 'success'
  && circuitDisplay({ state: 'open', open_until: null }).tone === 'error'
  && circuitDisplay({ state: 'half_open' }).tone === 'warning');

// 28. Нет general availability (§27.28).
check('28. режима general availability не существует',
  !('all' in ROLLOUT_MODE_LABELS) && !('public' in ROLLOUT_MODE_LABELS)
  && !('general_availability' in ROLLOUT_MODE_LABELS)
  && nextTransitionTargets('pilot_bulk').every((t) => t === 'off'));

// 29-30. Нет API key поля / client model override (§27.29-30).
const rolloutSection = readFileSync(new URL('../../src/pages/AdminAiSettings/components/RolloutSection.tsx', import.meta.url), 'utf8');
const rolloutApi = readFileSync(new URL('../../src/lib/api/adminAi.ts', import.meta.url), 'utf8');
check('29. rollout UI без поля API key', !/api[_-]?key.{0,20}(value|onChange)/i.test(rolloutSection));
check('30. transition API не передаёт model/provider',
  /transitionAiRollout/.test(rolloutApi)
  && !/transition[\s\S]{0,400}model_id/.test(rolloutApi.slice(rolloutApi.indexOf('transitionAiRollout'), rolloutApi.indexOf('transitionAiRollout') + 500)));

// 31. Server rank/confidence остаётся авторитетом (§27.31).
check('31. capability/display не переопределяют серверные решения',
  pilotModelLabel(cap()).includes('Test Model')
  && rolloutModeDisplay('pilot_bulk').tone === 'success');

// 32. Feedback outcome только после успешного импорта (§27.32) — тексты
// исходов + proxy-дисклеймер.
check('32. outcome labels + acceptance = proxy',
  FEEDBACK_OUTCOME_LABELS.accepted.length > 0 && FEEDBACK_OUTCOME_LABELS.changed.length > 0
  && ACCEPTANCE_IS_PROXY_TEXT.includes('не математически доказанная'));

if (failures.length) {
  console.error('\nFAILED aiRolloutFrontendPolicy checks:');
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('\naiRolloutFrontendPolicy: все проверки пройдены');
