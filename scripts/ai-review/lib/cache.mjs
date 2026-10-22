/**
 * Кэш ответов модели по позиции: <outDir>/cache/<профиль>/<ключ>.json.
 * Ключ — sha256 от версии промпта, ревизии навыков, модели, режима, текста позиции
 * и отпечатков её находок: изменилось что-то из этого — ответ спрашивается заново.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {{ promptVersion: string, skillsRev: string, model: string, think: boolean, text: string, fingerprints: string[] }} parts
 */
export const cacheKey = ({ promptVersion, skillsRev, model, think, text, fingerprints }) =>
  createHash('sha256').update(JSON.stringify([promptVersion, skillsRev, model, think, text, fingerprints])).digest('hex');

const cachePath = (dir, profileName, key) => join(dir, 'cache', profileName, `${key}.json`);

/**
 * Записанные оценки позиции либо undefined (нет файла / файл повреждён).
 * @param {string} dir
 * @param {string} profileName
 * @param {string} key
 * @returns {Array<object> | undefined}
 */
export const readCache = (dir, profileName, key) => {
  try {
    const data = JSON.parse(readFileSync(cachePath(dir, profileName, key), 'utf8'));
    return Array.isArray(data?.assessments) ? data.assessments : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Запись через временный файл и rename; сбой записи кэш не ломает.
 * @param {string} dir
 * @param {string} profileName
 * @param {string} key
 * @param {Array<object>} assessments
 */
export const writeCache = (dir, profileName, key, assessments) => {
  const target = cachePath(dir, profileName, key);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    mkdirSync(join(dir, 'cache', profileName), { recursive: true });
    writeFileSync(tmp, JSON.stringify({ v: 1, assessments }), 'utf8');
    renameSync(tmp, target);
  } catch {
    rmSync(tmp, { force: true });
  }
};
