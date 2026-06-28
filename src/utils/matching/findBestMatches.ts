/**
 * Поиск лучших совпадений между позициями старой и новой версий тендера
 */

import {
  calculateMatchScore,
  isAutoMatchScore,
  type ParsedRow,
  type MatchScoreBreakdown,
} from './calculateMatchScore';
import { calculateVolumeProximity, normalizeString } from './similarity';
import type { ClientPosition } from '../../lib/supabase';

const POSITION_WINDOW = 80;
const MAX_FULL_SCORE_CANDIDATES = 30;

interface PositionMeta {
  position: ClientPosition;
  normalizedItemNo: string;
  normalizedUnitCode: string;
  normalizedWorkName: string;
  primaryToken: string;
  volumeKey: string;
  index: number;
}

interface ParsedRowMeta {
  position: ParsedRow;
  normalizedItemNo: string;
  normalizedUnitCode: string;
  normalizedWorkName: string;
  primaryToken: string;
  volumeKey: string;
  index: number;
}

/**
 * Результат сопоставления одной позиции
 */
export interface MatchResult {
  oldPositionId: string;
  newPositionIndex: number;
  score: MatchScoreBreakdown;
  matchType: 'auto' | 'low_confidence';
}

function normalizeLookup(value: string | null | undefined): string {
  return normalizeString(value || '');
}

function formatVolumeKey(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return '';
  }

  return Number(value).toFixed(6);
}

function extractPrimaryToken(normalizedWorkName: string): string {
  const token = normalizedWorkName
    .split(' ')
    .find(part => part.length >= 3);

  return token || '';
}

function buildPositionMeta(position: ClientPosition, index: number): PositionMeta {
  const normalizedWorkName = normalizeLookup(position.work_name);

  return {
    position,
    normalizedItemNo: normalizeLookup(position.item_no),
    normalizedUnitCode: normalizeLookup(position.unit_code),
    normalizedWorkName,
    primaryToken: extractPrimaryToken(normalizedWorkName),
    volumeKey: formatVolumeKey(position.volume),
    index,
  };
}

function buildParsedRowMeta(position: ParsedRow, index: number): ParsedRowMeta {
  const normalizedWorkName = normalizeLookup(position.work_name);

  return {
    position,
    normalizedItemNo: normalizeLookup(position.item_no),
    normalizedUnitCode: normalizeLookup(position.unit_code),
    normalizedWorkName,
    primaryToken: extractPrimaryToken(normalizedWorkName),
    volumeKey: formatVolumeKey(position.volume),
    index,
  };
}

function buildStrongKey(meta: Pick<PositionMeta, 'normalizedItemNo' | 'normalizedUnitCode' | 'normalizedWorkName'>): string {
  return `${meta.normalizedItemNo}|${meta.normalizedUnitCode}|${meta.normalizedWorkName}`;
}

function buildExactKey(meta: Pick<PositionMeta, 'normalizedItemNo' | 'normalizedUnitCode' | 'normalizedWorkName' | 'volumeKey'>): string {
  return `${buildStrongKey(meta)}|${meta.volumeKey}`;
}

function pushToMap<T>(map: Map<string, T[]>, key: string, value: T) {
  if (!key || key === '||' || key === '|||') {
    return;
  }

  const bucket = map.get(key) || [];
  bucket.push(value);
  map.set(key, bucket);
}

function addCandidates(
  target: PositionMeta[],
  source: PositionMeta[] | undefined,
  usedOldPositions: Set<string>,
  seenIds: Set<string>
) {
  if (!source) {
    return;
  }

  for (const candidate of source) {
    if (usedOldPositions.has(candidate.position.id) || seenIds.has(candidate.position.id)) {
      continue;
    }

    seenIds.add(candidate.position.id);
    target.push(candidate);
  }
}

function buildQuickScore(candidate: PositionMeta, current: ParsedRowMeta): number {
  let score = 0;

  if (candidate.normalizedItemNo && candidate.normalizedItemNo === current.normalizedItemNo) {
    score += 140;
  }

  if (candidate.normalizedWorkName && candidate.normalizedWorkName === current.normalizedWorkName) {
    score += 60;
  }

  if (candidate.normalizedUnitCode && candidate.normalizedUnitCode === current.normalizedUnitCode) {
    score += 25;
  }

  if (candidate.primaryToken && candidate.primaryToken === current.primaryToken) {
    score += 15;
  }

  if (candidate.volumeKey && candidate.volumeKey === current.volumeKey) {
    score += 15;
  }

  score += calculateVolumeProximity(candidate.position.volume ?? null, current.position.volume ?? null) * 10;
  score += Math.max(0, 15 - Math.abs(candidate.index - current.index) / 5);

  return score;
}

function evaluateBestMatch(
  candidates: PositionMeta[],
  current: ParsedRowMeta,
  scoreCache: Map<string, MatchScoreBreakdown>
): { oldPos: ClientPosition; score: MatchScoreBreakdown } | null {
  let bestMatch: {
    oldPos: ClientPosition;
    score: MatchScoreBreakdown;
  } | null = null;

  for (const candidate of candidates) {
    // Score детерминирован для пары (candidate, current) — кэшируем в рамках одной новой
    // позиции, чтобы не пересчитывать кандидата, попавшего в несколько списков (exact/strong/shortlist/fallback).
    let score = scoreCache.get(candidate.position.id);
    if (score === undefined) {
      score = calculateMatchScore(
        candidate.position,
        current.position,
        candidate.normalizedWorkName,
        current.normalizedWorkName
      );
      scoreCache.set(candidate.position.id, score);
    }

    if (!bestMatch || score.total > bestMatch.score.total) {
      bestMatch = {
        oldPos: candidate.position,
        score,
      };
    }
  }

  return bestMatch;
}

function getUnusedCandidates(
  source: PositionMeta[] | undefined,
  usedOldPositions: Set<string>
): PositionMeta[] {
  if (!source) {
    return [];
  }

  return source.filter(candidate => !usedOldPositions.has(candidate.position.id));
}

function collectCandidatePool(
  oldMetas: PositionMeta[],
  current: ParsedRowMeta,
  usedOldPositions: Set<string>,
  byItemNo: Map<string, PositionMeta[]>,
  byUnitCode: Map<string, PositionMeta[]>,
  byToken: Map<string, PositionMeta[]>
): PositionMeta[] {
  const candidates: PositionMeta[] = [];
  const seenIds = new Set<string>();

  if (current.normalizedItemNo) {
    addCandidates(candidates, byItemNo.get(current.normalizedItemNo), usedOldPositions, seenIds);
  }

  const windowStart = Math.max(0, current.index - POSITION_WINDOW);
  const windowEnd = Math.min(oldMetas.length - 1, current.index + POSITION_WINDOW);

  for (let idx = windowStart; idx <= windowEnd; idx++) {
    const candidate = oldMetas[idx];

    if (
      usedOldPositions.has(candidate.position.id) ||
      seenIds.has(candidate.position.id)
    ) {
      continue;
    }

    if (
      (current.normalizedUnitCode && candidate.normalizedUnitCode === current.normalizedUnitCode) ||
      (current.primaryToken && candidate.primaryToken === current.primaryToken) ||
      Math.abs(candidate.index - current.index) <= 10
    ) {
      seenIds.add(candidate.position.id);
      candidates.push(candidate);
    }
  }

  if (current.normalizedUnitCode) {
    addCandidates(candidates, byUnitCode.get(current.normalizedUnitCode), usedOldPositions, seenIds);
  }

  if (current.primaryToken) {
    addCandidates(candidates, byToken.get(current.primaryToken), usedOldPositions, seenIds);
  }

  if (candidates.length === 0) {
    addCandidates(candidates, oldMetas, usedOldPositions, seenIds);
  }

  // quickScore считаем один раз на кандидата, затем сортируем по готовому ключу
  // (раньше компаратор пересчитывал buildQuickScore дважды на каждое сравнение).
  const scored = candidates.map(candidate => ({
    candidate,
    quick: buildQuickScore(candidate, current),
  }));
  scored.sort((left, right) => right.quick - left.quick);

  return scored.map(item => item.candidate);
}

/**
 * Найти лучшие совпадения для всех позиций
 *
 * Алгоритм:
 * 1. Сначала пытаемся найти точное совпадение по сильному ключу
 * 2. Для остальных строк строим короткий список кандидатов
 * 3. Полный перебор выполняем только как fallback для спорных строк
 */
export function findBestMatches(
  oldPositions: ClientPosition[],
  newPositions: ParsedRow[],
  threshold: number = 80
): MatchResult[] {
  const results: MatchResult[] = [];
  const usedOldPositions = new Set<string>();

  const oldMetas = oldPositions
    .filter(position => !position.is_additional)
    .map((position, index) => buildPositionMeta(position, index));

  const newMetas = newPositions.map((position, index) => buildParsedRowMeta(position, index));

  const byItemNo = new Map<string, PositionMeta[]>();
  const byUnitCode = new Map<string, PositionMeta[]>();
  const byToken = new Map<string, PositionMeta[]>();
  const byExactKey = new Map<string, PositionMeta[]>();
  const byStrongKey = new Map<string, PositionMeta[]>();

  for (const meta of oldMetas) {
    if (meta.normalizedItemNo) {
      pushToMap(byItemNo, meta.normalizedItemNo, meta);
    }

    if (meta.normalizedUnitCode) {
      pushToMap(byUnitCode, meta.normalizedUnitCode, meta);
    }

    if (meta.primaryToken) {
      pushToMap(byToken, meta.primaryToken, meta);
    }

    pushToMap(byExactKey, buildExactKey(meta), meta);
    pushToMap(byStrongKey, buildStrongKey(meta), meta);
  }

  for (const current of newMetas) {
    // Кэш score'ов в пределах текущей новой позиции (сбрасывается на каждой итерации).
    const scoreCache = new Map<string, MatchScoreBreakdown>();
    const exactCandidates = getUnusedCandidates(byExactKey.get(buildExactKey(current)), usedOldPositions);
    let bestMatch: { oldPos: ClientPosition; score: MatchScoreBreakdown } | null = null;

    if (exactCandidates.length > 0) {
      bestMatch = evaluateBestMatch(exactCandidates, current, scoreCache);
    }

    if (!bestMatch) {
      const strongCandidates = getUnusedCandidates(byStrongKey.get(buildStrongKey(current)), usedOldPositions);

      if (strongCandidates.length > 0) {
        bestMatch = evaluateBestMatch(strongCandidates, current, scoreCache);
      }
    }

    if (!bestMatch || bestMatch.score.total < threshold) {
      const candidatePool = collectCandidatePool(
        oldMetas,
        current,
        usedOldPositions,
        byItemNo,
        byUnitCode,
        byToken
      );

      const shortlistedCandidates = candidatePool.slice(0, MAX_FULL_SCORE_CANDIDATES);
      const shortlistedBestMatch = evaluateBestMatch(shortlistedCandidates, current, scoreCache);

      if (
        shortlistedBestMatch &&
        (!bestMatch || shortlistedBestMatch.score.total > bestMatch.score.total)
      ) {
        bestMatch = shortlistedBestMatch;
      }

      const bestScore = bestMatch?.score.total ?? 0;
      const needsFullFallback =
        bestScore < threshold &&
        shortlistedCandidates.length < candidatePool.length;

      if (needsFullFallback) {
        const evaluatedIds = new Set(shortlistedCandidates.map(candidate => candidate.position.id));
        const remainingCandidates = oldMetas.filter(candidate =>
          !usedOldPositions.has(candidate.position.id) &&
          !evaluatedIds.has(candidate.position.id)
        );

        const fallbackBestMatch = evaluateBestMatch(remainingCandidates, current, scoreCache);

        if (
          fallbackBestMatch &&
          (!bestMatch || fallbackBestMatch.score.total > bestMatch.score.total)
        ) {
          bestMatch = fallbackBestMatch;
        }
      }
    }

    if (bestMatch && bestMatch.score.total > 50) {
      const matchType = isAutoMatchScore(bestMatch.score, threshold)
        ? 'auto'
        : 'low_confidence';

      results.push({
        oldPositionId: bestMatch.oldPos.id,
        newPositionIndex: current.index,
        score: bestMatch.score,
        matchType,
      });

      usedOldPositions.add(bestMatch.oldPos.id);
    }
  }

  return results;
}

/**
 * Получить не сопоставленные позиции старой версии (удаленные заказчиком)
 */
export function getUnmatchedOldPositions(
  oldPositions: ClientPosition[],
  matches: MatchResult[]
): ClientPosition[] {
  const matchedIds = new Set(matches.map(m => m.oldPositionId));

  return oldPositions.filter(pos =>
    !matchedIds.has(pos.id) &&
    !pos.is_additional
  );
}

/**
 * Получить индексы не сопоставленных позиций новой версии (новые позиции)
 */
export function getUnmatchedNewPositionIndices(
  newPositions: ParsedRow[],
  matches: MatchResult[]
): number[] {
  const matchedIndices = new Set(matches.map(m => m.newPositionIndex));

  return newPositions
    .map((_, idx) => idx)
    .filter(idx => !matchedIndices.has(idx));
}

/**
 * Статистика сопоставления
 */
export interface MatchingStatistics {
  totalOld: number;
  totalNew: number;
  autoMatched: number;
  lowConfidence: number;
  deleted: number;
  new: number;
  additionalWorks: number;
}

/**
 * Вычислить статистику сопоставления
 */
export function calculateMatchingStatistics(
  oldPositions: ClientPosition[],
  newPositions: ParsedRow[],
  matches: MatchResult[]
): MatchingStatistics {
  const autoMatched = matches.filter(m => m.matchType === 'auto').length;
  const lowConfidence = matches.filter(m => m.matchType === 'low_confidence').length;
  const matchedOldIds = new Set(matches.map(m => m.oldPositionId));
  const matchedNewIndices = new Set(matches.map(m => m.newPositionIndex));

  return {
    totalOld: oldPositions.filter(p => !p.is_additional).length,
    totalNew: newPositions.length,
    autoMatched,
    lowConfidence,
    deleted: oldPositions.filter(p => !p.is_additional && !matchedOldIds.has(p.id)).length,
    new: newPositions.filter((_, idx) => !matchedNewIndices.has(idx)).length,
    additionalWorks: oldPositions.filter(p => p.is_additional).length,
  };
}
