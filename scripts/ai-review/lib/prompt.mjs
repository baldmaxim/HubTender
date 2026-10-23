/**
 * Системный промпт: шаблон prompts/review-v1.md + навыки проверяющего.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConfigError } from './env.mjs';

export const DEFAULT_PROMPT_PATH = fileURLToPath(new URL('../prompts/review-v1.md', import.meta.url));

const SKILLS_PLACEHOLDER = '{{SKILLS}}';
const NO_SKILLS_TEXT = 'Навыков пока нет.';

/**
 * Шаблон и версия промпта: имя файла без расширения + первые 8 hex sha256 содержимого.
 * @param {string} [path]
 * @returns {{ template: string, version: string }}
 */
export const loadPromptTemplate = (path = DEFAULT_PROMPT_PATH) => {
  const bytes = readFileSync(path);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const name = /([^/\\]+?)\.md$/.exec(path)?.[1] ?? 'review-v1';
  return { template: bytes.toString('utf8'), version: `${name}@${hash}` };
};

/**
 * Подставляет навыки в шаблон. Нет навыков — «Навыков пока нет.».
 * @param {string} template
 * @param {string} skillsText
 */
export const buildSystemPrompt = (template, skillsText) => {
  const text = String(skillsText ?? '').trim() || NO_SKILLS_TEXT;
  return template.replace(SKILLS_PLACEHOLDER, () => text).trim();
};

/**
 * Промпт и навыки прогона: навыки отбираются по кодам правил всех находок прогона,
 * поэтому системный промпт один на весь прогон (сервер модели кэширует префикс).
 * Типы собственных замечаний (remark) идут в промпт всегда: модель в любой момент может написать замечание.
 * @param {{ ruleCodes: string[], skills: { loadSkills: Function, renderSkillsForPrompt: Function, activeCodes: Function }, promptPath?: string, skillsPath?: string }} opts
 */
export const prepareSystem = ({ ruleCodes, skills, promptPath, skillsPath }) => {
  const { template, version } = loadPromptTemplate(promptPath);
  let loaded;
  try {
    loaded = skills.loadSkills(skillsPath);
  } catch (err) {
    // Разбор строгий: опечатка в мете или повтор кода не должны молча выкинуть навыки.
    throw new ConfigError(
      `docs/data-quality/AI-SKILLS.md не разобран: ${err.message}. Поправьте файл или откатите правку (git diff docs/data-quality/AI-SKILLS.md)`,
    );
  }
  const skillsText = skills.renderSkillsForPrompt(loaded.entries, ruleCodes, { includeRemarks: true });
  return {
    system: buildSystemPrompt(template, skillsText),
    promptVersion: version,
    skillsRev: loaded.rev,
    knownBasis: skills.activeCodes(loaded.entries),
    remarkCodes: new Set(loaded.entries.filter((e) => e.kind === 'remark' && e.status !== 'retired').map((e) => e.code)),
  };
};

/** Модуль навыков (создаётся отдельно); подключается лениво, чтобы ping работал и без него. */
export const importSkills = () => import('./skills.mjs');
