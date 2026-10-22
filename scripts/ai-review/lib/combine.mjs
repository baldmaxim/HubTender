/**
 * Сведение оценок нескольких моделей по одной находке.
 */

import { LABEL_RU } from './format.mjs';

/**
 * @typedef {object} Combined
 * @property {string} label
 * @property {string} reason
 * @property {string} basis
 * @property {boolean} agree
 */

/**
 * Оценки со status 'ok' совпали — эта метка; разошлись — unsure и agree: false;
 * одна модель — её метка; ни одной — unsure с причиной сбоя.
 * @param {Record<string, { label: string, reason: string, basis?: string, status: string } | undefined>} byModel
 * @returns {Combined}
 */
export const combineAssessments = (byModel) => {
  const entries = Object.entries(byModel).filter(([, a]) => a);
  const ok = entries.filter(([, a]) => a.status === 'ok');
  if (ok.length === 0) {
    const first = entries[0]?.[1];
    return { label: 'unsure', reason: first?.reason || 'нет ответа модели', basis: '', agree: true };
  }
  const labels = new Set(ok.map(([, a]) => a.label));
  if (labels.size === 1) {
    const withBasis = ok.find(([, a]) => a.basis);
    return { label: ok[0][1].label, reason: ok[0][1].reason, basis: withBasis?.[1].basis ?? '', agree: true };
  }
  const parts = ok.map(([name, a]) => `${name} — ${LABEL_RU[a.label] ?? a.label}${a.reason ? `: ${a.reason}` : ''}`);
  return { label: 'unsure', reason: `модели расходятся: ${parts.join('; ')}`, basis: '', agree: false };
};
