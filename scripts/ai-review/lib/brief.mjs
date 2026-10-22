/**
 * Краткий итог ИИ-проверки в выжимке тендера (GET/PUT /tenders/{id}/brief).
 * Меняется только свой блок между [ИИ-проверка …] и [/ИИ-проверка], остальной текст не трогается.
 */

import { byMoneyDesc, formatDateTime, formatMoney } from './format.mjs';

export const BRIEF_MAX_CHARS = 20_000;
const MAX_LINES = 10;
const BLOCK_RE = /^\[ИИ-проверка[^\n]*\n[\s\S]*?^\[\/ИИ-проверка\]/m;

/** «поз. 12.3» из подписи места; нет — сама подпись. */
const positionLabel = (where) => /^поз\.\s*\S+/.exec(where)?.[0] ?? where;

/**
 * Блок выжимки: заголовок, счётчик, до `lines` крупнейших.
 * @param {{ tender: { number: string, version: number | null }, confirmed: any[], rejected: number, date: Date, lines: number }} p
 */
export const buildBriefBlock = ({ tender, confirmed, rejected, date, lines }) => {
  const total = confirmed.reduce((sum, item) => sum + Math.abs(Number(item.moneyDelta ?? 0)), 0);
  const money = formatMoney(total);
  const version = tender.version ? ` v${tender.version}` : '';
  const out = [
    `[ИИ-проверка ${formatDateTime(date)}]`,
    `Тендер ${tender.number}${version}: подтверждено ошибок ${confirmed.length}${money ? ` на ${money}` : ''}, отклонено ${rejected}.`,
  ];
  const top = [...confirmed].sort((a, b) => byMoneyDesc(a.moneyDelta, b.moneyDelta)).slice(0, lines);
  if (top.length > 0) out.push('Крупнейшие:');
  for (const item of top) {
    out.push(`- ${[positionLabel(item.where), item.ruleCode, formatMoney(item.moneyDelta)].filter(Boolean).join(' · ')}`);
  }
  out.push('[/ИИ-проверка]');
  return out.join('\n');
};

/** Подставляет блок в текст: свой блок заменяется, нет — дописывается в конец через пустую строку. */
export const injectBlock = (text, block) => {
  const source = String(text ?? '');
  if (BLOCK_RE.test(source)) return source.replace(BLOCK_RE, () => block);
  const trimmed = source.replace(/\s+$/, '');
  return trimmed === '' ? block : `${trimmed}\n\n${block}`;
};

/** Текст выжимки с блоком, уложенный в лимит (сокращается число строк «Крупнейшие»). */
export const composeBrief = (current, params) => {
  for (let lines = MAX_LINES; lines >= 0; lines -= 1) {
    const text = injectBlock(current, buildBriefBlock({ ...params, lines }));
    if (Array.from(text).length <= BRIEF_MAX_CHARS) return text;
  }
  throw new Error(`выжимка тендера длиннее ${BRIEF_MAX_CHARS} символов даже без списка, блок не добавлен`);
};

/**
 * Обновляет выжимку тендера. fact_category_ids передаётся ровно как вернул GET.
 * @param {{ get: Function, put: Function }} portal
 */
export const updateBrief = async (portal, tenderId, params) => {
  const path = `/api/v1/tenders/${tenderId}/brief`;
  const brief = await portal.get(path);
  const summary = composeBrief(brief?.summary_text ?? '', params);
  await portal.put(path, { summary_text: summary, fact_category_ids: brief?.fact_category_ids ?? null });
  return summary;
};
