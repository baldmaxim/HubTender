/**
 * Команда run: разбор открытых находок «Проверки данных» моделями → review.md для разметки.
 *
 *   run <тендер> [--models=a,b] [--rule=U,V] [--new] [--max=N] [--remarks=N | --all] [--think] [--refresh] [--no-cache]
 *
 * Кроме оценки находок модель пишет собственные замечания (remarks) по позициям: по позициям с находками и по
 * позициям без находок (самым дорогим, --remarks=N; --all — по всем). Замечания идут в отдельный раздел review.md.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { combineAssessments } from './combine.mjs';
import { ConfigError, getProfile } from './env.mjs';
import { formatStamp } from './format.mjs';
import { createLlmClient } from './llm.mjs';
import { DEFAULT_OUT_DIR } from './paths.mjs';
import { collectData, describePosition } from './prepare.mjs';
import { createPortal } from './portal.mjs';
import { importSkills, prepareSystem } from './prompt.mjs';
import { renderReview } from './review-md.mjs';
import { addUsage, newUsage, reviewItems } from './reviewer.mjs';
import { findingLink } from './tender.mjs';

const STATE_VERSION = 1;

/** Сколько позиций без находок берётся для собственных замечаний по умолчанию. */
export const DEFAULT_REMARK_POSITIONS = 150;

/** Имя части пути: только символы, безопасные для Windows. */
export const safeName = (text) => String(text).replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[._]+|[._]+$/g, '') || 'x';

/** Профили для прогона: --models либо первая модель из AI_REVIEW_MODELS. */
export const pickProfiles = (config, models) => {
  const names = models && models.length > 0 ? models : config.modelNames.slice(0, 1);
  if (names.length === 0) throw new ConfigError('Нет моделей: задайте AI_REVIEW_MODELS в ai-review.env или флаг --models');
  return [...new Set(names)].map((name) => getProfile(config, name));
};

/** Свободная папка прогона <номер>-v<версия>/<ГГГГ-ММ-ДД_ЧЧММ>. */
const makeRunDir = (outDir, tender, date) => {
  const parent = join(outDir, `${safeName(tender.number)}-v${tender.version ?? 0}`);
  const stamp = formatStamp(date);
  let dir = join(parent, stamp);
  for (let n = 2; existsSync(dir); n += 1) dir = join(parent, `${stamp}-${n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** Сводка по состоянию: сколько в каком разделе. */
const summarize = (items) => {
  const count = (pred) => items.filter(pred).length;
  return {
    total: items.length,
    likelyError: count((i) => i.combined?.label === 'likely_error'),
    likelyOk: count((i) => i.combined?.label === 'likely_ok'),
    unsure: count((i) => i.combined?.label === 'unsure'),
    disagree: count((i) => i.combined?.agree === false),
    unreviewed: count((i) => !i.combined),
  };
};

const usageLine = (name, u) =>
  `  ${name}: запросов ${u.requests}, токены вход ${u.promptTokens} / выход ${u.completionTokens}` +
  `${u.reasoningTokens ? ` (рассуждения ${u.reasoningTokens})` : ''}, ` +
  `время ${Math.round(u.elapsedMs / 1000)} с, позиций из кэша ${u.cachedPositions} из ${u.cachedPositions + u.askedPositions}`;

/**
 * Сколько позиций без находок брать для замечаний: явный --remarks сильнее; при --rule и --new по умолчанию 0.
 * @param {{ remarks?: number, rules?: string[], onlyNew?: boolean }} args
 */
const remarkPositionsOf = (args) => args.remarks ?? (args.rules?.length > 0 || args.onlyNew ? 0 : DEFAULT_REMARK_POSITIONS);

/**
 * @param {import('./env.mjs').IConfig} config
 * @param {{ tender: string, models?: string[], rules?: string[], onlyNew?: boolean, max?: number, remarks?: number, all?: boolean,
 *   think?: boolean, refresh?: boolean, noCache?: boolean }} args
 * @param {{ portal?: any, createClient?: Function, outDir?: string, skills?: any, now?: () => Date, log?: (line: string) => void }} [deps]
 * @returns {Promise<{ code: number, runDir: string, reviewPath: string, state: any }>}
 */
export const runReview = async (config, args, deps = {}) => {
  const {
    outDir = DEFAULT_OUT_DIR,
    createClient = (profile) => createLlmClient(profile),
    now = () => new Date(),
    log = (line) => console.log(line),
  } = deps;
  if (args.all && args.remarks !== undefined) throw new ConfigError('--all и --remarks=N несовместимы: --all берёт все позиции со строками');
  const profiles = pickProfiles(config, args.models);
  const remarksLimit = remarkPositionsOf(args);
  const portal = deps.portal ?? createPortal(config.portal);

  const data = await collectData(portal, args.tender, {
    rules: args.rules,
    onlyNew: args.onlyNew,
    refresh: args.refresh,
    max: args.max,
    remarks: remarksLimit,
    all: Boolean(args.all),
    log,
  });
  for (const warning of data.warnings) log(`ВНИМАНИЕ: ${warning}`);
  if (data.skippedPositions > 0) log(`Не вошло по --max: ${data.skippedPositions} позиций`);

  const ruleCodes = [...new Set([...data.items.flatMap((g) => g.findings), ...data.unreviewed].map((f) => f.ruleCode))];
  const skills = deps.skills ?? (await importSkills());
  const { system, promptVersion, skillsRev, knownBasis, remarkCodes } = prepareSystem({ ruleCodes, skills });
  const knownRuleCodes = new Set(data.rules.keys());

  // Позиции с находками и позиции без находок (только для собственных замечаний ИИ).
  const modelItems = [...data.items, ...data.remarkItems];
  const cache = { read: !args.noCache, write: true, dir: outDir };
  const passes = await Promise.all(
    modelItems.length === 0
      ? []
      : profiles.map(async (profile) => {
          const pass = await reviewItems({
            client: createClient(profile),
            profile,
            system,
            promptVersion,
            skillsRev,
            knownBasis,
            items: modelItems,
            remarkCodes,
            ruleCodes: knownRuleCodes,
            think: args.think,
            cache,
            onProgress: log,
          });
          return { name: profile.name, ...pass };
        }),
  );

  // Состояние прогона.
  let counter = 0;
  const link = (f) => findingLink(portal.baseUrl, data.tender.id, f);
  const makeItem = (f, ai, combined) => {
    counter += 1;
    return {
      key: `f${counter}`,
      findingId: f.id,
      ruleCode: f.ruleCode,
      entityType: f.entityType,
      entityId: f.entityId,
      itemId: f.itemId ?? null,
      positionId: f.positionId ?? null,
      positionNumber: data.positionNumbers.get(f.positionId) ?? f.positionNumber ?? null,
      fingerprint: f.fingerprint,
      moneyDelta: f.moneyDelta,
      detail: f.detail,
      where: f.where,
      link: link(f),
      ai,
      combined,
    };
  };

  const items = [];
  const snapshot = {};
  for (const group of modelItems) snapshot[group.position.id] = group.position;
  for (const group of data.items) {
    for (const f of group.findings) {
      const ai = {};
      for (const pass of passes) {
        const a = pass.results.get(f.id);
        ai[pass.name] = {
          label: a.label,
          reason: a.reason,
          evidence: a.evidence,
          basis: a.basis,
          downgraded: a.downgraded,
          status: a.status,
          think: a.think,
        };
      }
      items.push(makeItem(f, ai, combineAssessments(ai)));
    }
  }
  for (const f of data.unreviewed) items.push(makeItem(f, {}, null));

  // Собственные замечания ИИ: отдельно от находок, сквозные ключи n1, n2, …
  const remarks = [];
  const positionById = new Map(modelItems.map((g) => [g.position.id, g.position]));
  for (const pass of passes) {
    for (const group of modelItems) {
      for (const r of pass.remarks.get(group.position.id) ?? []) {
        remarks.push({
          key: `n${remarks.length + 1}`,
          model: pass.name,
          type: r.type,
          title: r.title,
          positionId: r.positionId,
          rowId: r.rowId,
          positionNumber: data.positionNumbers.get(r.positionId) ?? null,
          where: describePosition(positionById.get(r.positionId), r.rowId),
          positionTotal: data.positionTotals.get(r.positionId) ?? 0,
          detail: r.detail,
          evidence: r.evidence,
          link: findingLink(portal.baseUrl, data.tender.id, { positionId: r.positionId, itemId: r.rowId ?? undefined }),
        });
      }
    }
  }

  const usage = {};
  for (const pass of passes) usage[pass.name] = addUsage(newUsage(), pass.usage);

  const createdAt = now();
  const state = {
    version: STATE_VERSION,
    createdAt: createdAt.toISOString(),
    tender: data.tender,
    models: profiles.map((p) => ({ name: p.name, model: p.model })),
    promptVersion,
    skillsRev,
    options: {
      rules: args.rules ?? null,
      onlyNew: Boolean(args.onlyNew),
      max: args.max ?? null,
      remarks: args.all ? null : remarksLimit,
      all: Boolean(args.all),
      think: Boolean(args.think),
      refresh: Boolean(args.refresh),
      noCache: Boolean(args.noCache),
    },
    usage,
    items,
    remarks,
  };

  const runDir = makeRunDir(outDir, data.tender, createdAt);
  const reviewPath = join(runDir, 'review.md');
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(state, null, 2), 'utf8');
  writeFileSync(join(runDir, 'positions.json'), JSON.stringify(snapshot), 'utf8');
  writeFileSync(reviewPath, renderReview(state), 'utf8');

  const s = summarize(items);
  log('');
  log(`Разобрано находок: ${s.total - s.unreviewed}, без разбора: ${s.unreviewed}`);
  log(`  по делу: ${s.likelyError} · шум: ${s.likelyOk} · не уверен: ${s.unsure}${s.disagree ? ` (расхождений моделей: ${s.disagree})` : ''}`);
  for (const [name, u] of Object.entries(usage)) log(usageLine(name, u));
  const usages = Object.values(usage);
  const dropped = usages.reduce((sum, u) => sum + u.remarksDropped, 0);
  const failed = Math.max(0, ...usages.map((u) => u.remarkPositionsFailed));
  if (remarks.length > 0 || dropped > 0 || data.remarkItems.length > 0) {
    log(
      `Своих замечаний ИИ: ${remarks.length} (отброшено без подтверждения: ${dropped}), ` +
        `позиций без находок просмотрено: ${data.remarkItems.length} (покрытие ${Math.round(data.remarkCoverage * 100)} % стоимости)`,
    );
    if (failed > 0) log(`  позиций без ответа: ${failed}`);
  }
  log(`Файл для разметки: ${reviewPath}`);
  log(`Дальше: отметьте строки ([+] по делу, [-] не по делу) и запустите apply «${reviewPath}»`);
  return { code: 0, runDir, reviewPath, state };
};
