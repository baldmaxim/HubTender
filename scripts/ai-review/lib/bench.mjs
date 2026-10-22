/**
 * ping --bench=<тендер>: замер скорости моделей на 20 первых позициях тендера и прогноз
 * времени на все открытые находки. Ничего не пишет: ни кэш, ни прогон, ни портал.
 */

import { ConfigError } from './env.mjs';
import { createLlmClient } from './llm.mjs';
import { collectData } from './prepare.mjs';
import { createPortal } from './portal.mjs';
import { importSkills, prepareSystem } from './prompt.mjs';
import { pickProfiles } from './run.mjs';
import { reviewPass } from './reviewer.mjs';

const SAMPLE_POSITIONS = 20;

const formatDuration = (ms) => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))} с`;
  if (minutes < 60) return `${minutes} мин`;
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
};

const countFindings = (items) => items.reduce((sum, it) => sum + it.findings.length, 0);

/**
 * @param {import('./env.mjs').IConfig} config
 * @param {{ tender: string, models?: string[] }} args
 * @param {{ portal?: any, createClient?: Function, skills?: any, log?: (line: string) => void }} [deps]
 * @returns {Promise<number>}
 */
export const runBench = async (config, { tender, models }, deps = {}) => {
  const { createClient = (profile) => createLlmClient(profile), log = (line) => console.log(line) } = deps;
  const profiles = pickProfiles(config, models);
  const portal = deps.portal ?? createPortal(config.portal);

  const all = await collectData(portal, tender, { log });
  if (all.items.length === 0) throw new ConfigError('У тендера нет открытых находок с позициями: замерять нечего');
  // Выборка — как при --max=20; прогноз на все находки с позициями (находки без позиции модели не отправляются).
  const data = { ...all, items: all.items.slice(0, SAMPLE_POSITIONS) };
  const totalFindings = countFindings(all.items);
  const sampleFindings = countFindings(data.items);

  const ruleCodes = [...new Set(data.items.flatMap((g) => g.findings).map((f) => f.ruleCode))];
  const skills = deps.skills ?? (await importSkills());
  const { system, promptVersion, skillsRev, knownBasis } = prepareSystem({ ruleCodes, skills });
  log(`Выборка: ${data.items.length} позиций, ${sampleFindings} находок; всего с позициями: ${totalFindings}. Кэш не используется.`);

  for (const profile of profiles) {
    const client = createClient(profile);
    const modes = [{ think: false, title: 'без рассуждений' }];
    if (profile.thinkExtra) modes.push({ think: true, title: 'с рассуждениями' });
    else log(`\n${profile.name}: режим рассуждений не настроен (AI_REVIEW_${profile.name.toUpperCase()}_THINK_EXTRA)`);

    for (const mode of modes) {
      log(`\n${profile.name} (${profile.model}), ${mode.title}:`);
      const startedAt = Date.now();
      const { usage } = await reviewPass({
        client,
        profile,
        system,
        promptVersion,
        skillsRev,
        knownBasis,
        items: data.items,
        think: mode.think,
        onProgress: log,
      });
      const elapsedMs = Math.max(1, Date.now() - startedAt);
      const perSecond = usage.completionTokens / (elapsedMs / 1000);
      log(
        `  запросов ${usage.requests}, токены вход ${usage.promptTokens} / выход ${usage.completionTokens}` +
          `${mode.think ? ` (рассуждения ${usage.reasoningTokens})` : ''}, время ${formatDuration(elapsedMs)}, ` +
          `${perSecond.toFixed(1)} ток/с выхода`,
      );
      log(`  прогноз на ${totalFindings} находок: ~${formatDuration((elapsedMs * totalFindings) / sampleFindings)}`);
    }
  }
  return 0;
};
