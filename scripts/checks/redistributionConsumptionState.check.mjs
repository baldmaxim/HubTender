// Stage 0.1.2.3b.1 focused frontend check — run via tsx:
//   npx tsx scripts/checks/redistributionConsumptionState.check.mjs
//
// Truth-table test of the SINGLE consumption policy
// (resolveRedistributionConsumptionState): Commerce, FI, CostRedistribution
// and every export must branch through it — this check pins the policy so a
// consumer cannot silently get a different fallback.

import { resolveRedistributionConsumptionState } from '../../src/lib/redistribution/consumptionState.ts';

const failures = [];
const expect = (name, cond) => {
  if (!cond) failures.push(name);
};

// §15.1 — calculated: final values from server prepared, export allowed.
{
  const s = resolveRedistributionConsumptionState('calculated');
  expect('calculated.finalValuesAvailable', s.finalValuesAvailable === true);
  expect('calculated.exportFinalAllowed', s.exportFinalAllowed === true);
  expect('calculated.exportBaseAllowed', s.exportBaseAllowed === true);
  expect('calculated.alert', s.alert === null);
  expect('calculated.exportBlockedCode', s.exportBlockedCode === null);
}

// §15.2 — not_configured: base visible as base only; redistribution-specific
// export disabled; general base export allowed; no false "recalculate" alert.
{
  const s = resolveRedistributionConsumptionState('not_configured');
  expect('not_configured.finalValuesAvailable', s.finalValuesAvailable === false);
  expect('not_configured.baseValuesVisibleAsBaseOnly', s.baseValuesVisibleAsBaseOnly === true);
  expect('not_configured.exportFinalAllowed', s.exportFinalAllowed === false);
  expect('not_configured.exportBaseAllowed', s.exportBaseAllowed === true);
  expect('not_configured.alert', s.alert === null);
  expect('not_configured.code', s.exportBlockedCode === 'REDISTRIBUTION_NOT_CONFIGURED');
}

// §15.3 — requires_recalculation: final unavailable, base NOT substituted as
// final, alert present, ALL redistribution exports blocked. Never collapses
// into not_configured.
{
  const s = resolveRedistributionConsumptionState('requires_recalculation');
  expect('requires.finalValuesAvailable', s.finalValuesAvailable === false);
  expect('requires.exportFinalAllowed', s.exportFinalAllowed === false);
  expect('requires.exportBaseAllowed', s.exportBaseAllowed === false);
  expect('requires.alert-present', typeof s.alert === 'string' && s.alert.length > 0);
  expect('requires.code', s.exportBlockedCode === 'REDISTRIBUTION_RECALCULATION_REQUIRED');
  expect('requires.status-preserved', s.status === 'requires_recalculation');
}

// §15.4-6 — reason-specific messages (branching by CODE, not by text).
{
  const legacy = resolveRedistributionConsumptionState('requires_recalculation', 'LEGACY_SNAPSHOT');
  expect('reason.legacy', legacy.alert.includes('старой версией'));
  const mismatch = resolveRedistributionConsumptionState('requires_recalculation', 'SNAPSHOT_SET_MISMATCH');
  expect('reason.mismatch', mismatch.alert.includes('составу BOQ'));
  const insurance = resolveRedistributionConsumptionState('requires_recalculation', 'INSURANCE_ALLOCATION_INVALID');
  expect('reason.insurance', insurance.alert.includes('Страхование'));
  const changed = resolveRedistributionConsumptionState('requires_recalculation', 'PREPARED_INPUT_CHANGED');
  expect('reason.changed', changed.alert.includes('изменились'));
  // Server-provided message wins over the local dictionary.
  const custom = resolveRedistributionConsumptionState('requires_recalculation', 'LEGACY_SNAPSHOT', 'Серверное сообщение.');
  expect('reason.serverMessageWins', custom.alert === 'Серверное сообщение.');
}

// Unknown/missing status is not_configured semantics — but NEVER for an
// explicit requires_recalculation.
{
  const s = resolveRedistributionConsumptionState(undefined);
  expect('unknown→not_configured', s.status === 'not_configured' && !s.finalValuesAvailable);
}

console.log('redistributionConsumptionState.check:');
if (failures.length > 0) {
  console.error('\n  ✗ consumption-policy truth table violated:\n');
  for (const f of failures) console.error('    - ' + f);
  console.error('');
  process.exit(1);
}
console.log('  ok — calculated / not_configured / requires_recalculation policies pinned');
console.log('  ok — reason-specific messages resolved by CODE (server message wins)');
console.log('\nredistributionConsumptionState.check: passed');
