/**
 * Основной хук для сопоставления версий тендера
 */

import { useReducer, useCallback, useEffect, useMemo, useRef } from 'react';
import { message } from 'antd';
import type { Tender, ClientPosition } from '../../../../../lib/supabase';
import { fetchPositionsWithCosts } from '../../../../../lib/api/positions';
import type { ParsedRow, MatchResult } from '../../../../../utils/matching';
import { executeVersionTransfer } from '../../../../../utils/versionTransfer';
import type { MatchWorkerRequest, MatchWorkerResponse } from '../../../../../utils/matching/matching.worker';
import { matchReducer, initialMatchState, type MatchPair, type VersionMatchState } from '../types';
import { getErrorMessage } from '../../../../../utils/errors';

/**
 * Собрать пары сопоставления из «сырых» результатов алгоритма.
 * Чистая функция — логика идентична прежней инлайн-версии, вынесена для переиспользования
 * из обработчика сообщения воркера.
 */
function buildMatchPairs(
  matches: MatchResult[],
  newPositions: ParsedRow[],
  oldPositions: ClientPosition[],
  oldPositionsById: Map<string, ClientPosition>
): MatchPair[] {
  const matchMap = new Map<number, MatchResult>();
  matches.forEach(match => {
    matchMap.set(match.newPositionIndex, match);
  });

  const matchedOldIds = new Set(matches.map(m => m.oldPositionId));
  const matchPairs: MatchPair[] = [];

  newPositions.forEach((newPos, idx) => {
    const match = matchMap.get(idx);

    if (match) {
      const oldPosition = oldPositionsById.get(match.oldPositionId);

      if (oldPosition) {
        matchPairs.push({
          oldPosition,
          newPosition: newPos,
          score: match.score,
          matchType: match.matchType,
          transferData: match.matchType === 'auto' || match.matchType === 'low_confidence',
          isAdditional: false,
        });
        return;
      }
    }

    matchPairs.push({
      oldPosition: null,
      newPosition: newPos,
      score: null,
      matchType: 'new',
      transferData: false,
      isAdditional: false,
    });
  });

  const unmatchedOldPositions = oldPositions
    .filter(oldPos => !matchedOldIds.has(oldPos.id))
    .sort((a, b) => (a.position_number || 0) - (b.position_number || 0));

  unmatchedOldPositions.forEach(oldPos => {
    matchPairs.push({
      oldPosition: oldPos,
      newPosition: null,
      score: null,
      matchType: 'deleted',
      transferData: false,
      isAdditional: false,
    });
  });

  return matchPairs;
}

export interface UseVersionMatchingProps {
  sourceTender: Tender | null;
  newPositions: ParsedRow[];
}

export interface UseVersionMatchingResult {
  state: VersionMatchState;
  performAutoMatch: () => void;
  toggleTransfer: (oldId: string) => void;
  acceptAllLowConfidence: () => void;
  manualMatch: (oldId: string, newIdx: number) => void;
  breakMatch: (oldId: string) => void;
  setFilter: (filter: VersionMatchState['filter']) => void;
  createVersion: () => Promise<void>;
  reset: () => void;
}

export function useVersionMatching({
  sourceTender,
  newPositions,
}: UseVersionMatchingProps): UseVersionMatchingResult {
  const [state, dispatch] = useReducer(matchReducer, initialMatchState);

  // Воркер сопоставления создаётся один раз на время жизни хука.
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL('../../../../../utils/matching/matching.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const oldPositionsById = useMemo(
    () => new Map(state.oldPositions.map(position => [position.id, position])),
    [state.oldPositions]
  );

  const newPositionIndexes = useMemo(
    () => new Map(newPositions.map((position, index) => [position, index])),
    [newPositions]
  );

  const loadOldPositions = useCallback(async (tenderId: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });

    try {
      // Go: ORDER BY position_number,id — пагинация не нужна.
      // is_additional=false фильтруем на клиенте.
      const all = await fetchPositionsWithCosts(tenderId);
      const data = (all as unknown as ClientPosition[]).filter((p) => !p.is_additional);
      dispatch({ type: 'SET_OLD_POSITIONS', payload: data });
    } catch (error) {
      console.error('Ошибка загрузки старых позиций:', error);
      message.error(`Не удалось загрузить позиции: ${getErrorMessage(error)}`);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, []);

  useEffect(() => {
    if (!sourceTender) {
      dispatch({ type: 'RESET' });
      return;
    }

    dispatch({ type: 'SET_SOURCE_TENDER', payload: sourceTender });
    loadOldPositions(sourceTender.id);
  }, [sourceTender, loadOldPositions]);

  useEffect(() => {
    dispatch({ type: 'SET_NEW_POSITIONS', payload: newPositions });
  }, [newPositions]);

  const performAutoMatch = useCallback(() => {
    if (state.oldPositions.length === 0 || newPositions.length === 0) {
      message.warning('Необходимо загрузить обе версии для сопоставления');
      return;
    }

    const worker = workerRef.current;
    if (!worker) {
      message.error('Модуль сопоставления ещё не готов, попробуйте ещё раз');
      return;
    }

    dispatch({ type: 'SET_LOADING', payload: true });

    const oldPositionsSnapshot = state.oldPositions;

    const cleanup = () => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
    };

    const handleMessage = (ev: MessageEvent<MatchWorkerResponse>) => {
      cleanup();
      try {
        const matchPairs = buildMatchPairs(
          ev.data.matches,
          newPositions,
          oldPositionsSnapshot,
          oldPositionsById
        );

        dispatch({ type: 'SET_MATCHES', payload: matchPairs });

        const autoCount = matchPairs.filter(m => m.matchType === 'auto').length;
        const lowConfCount = matchPairs.filter(m => m.matchType === 'low_confidence').length;

        message.success(
          `Сопоставление выполнено: ${autoCount} точных совпадений, ${lowConfCount} с низкой уверенностью`
        );
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    };

    const handleError = (err: ErrorEvent) => {
      cleanup();
      console.error('Ошибка воркера сопоставления:', err);
      message.error('Не удалось выполнить сопоставление');
      dispatch({ type: 'SET_LOADING', payload: false });
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);

    const request: MatchWorkerRequest = {
      oldPositions: oldPositionsSnapshot,
      newPositions,
    };
    worker.postMessage(request);
  }, [state.oldPositions, newPositions, oldPositionsById]);

  const toggleTransfer = useCallback((oldId: string) => {
    dispatch({ type: 'TOGGLE_TRANSFER', payload: { oldId } });
  }, []);

  const acceptAllLowConfidence = useCallback(() => {
    dispatch({ type: 'ACCEPT_ALL_LOW_CONFIDENCE' });
    message.success('Все строки с низкой уверенностью приняты для переноса');
  }, []);

  const manualMatch = useCallback((oldId: string, newIdx: number) => {
    dispatch({ type: 'MANUAL_MATCH', payload: { oldId, newIdx } });
    message.success('Позиции сопоставлены вручную');
  }, []);

  const breakMatch = useCallback((oldId: string) => {
    dispatch({ type: 'BREAK_MATCH', payload: { oldId } });
    message.info('Сопоставление удалено');
  }, []);

  const setFilter = useCallback((filter: VersionMatchState['filter']) => {
    dispatch({ type: 'SET_FILTER', payload: filter });
  }, []);

  const createVersion = useCallback(async () => {
    if (!sourceTender) {
      message.error('Не выбран исходный тендер');
      return;
    }

    if (newPositions.length === 0) {
      message.error('Нет данных для создания новой версии');
      return;
    }

    dispatch({ type: 'SET_CREATING', payload: true });

    try {
      const transferMappings = state.matches
        .filter(m => m.transferData && m.oldPosition && m.newPosition)
        .map(m => {
          const newIdx = newPositionIndexes.get(m.newPosition!);

          if (newIdx == null) {
            console.warn('Не удалось определить индекс новой позиции для переноса');
            return null;
          }

          return {
            oldPositionId: m.oldPosition!.id,
            newRowIndex: newIdx,
          };
        })
        .filter(Boolean) as Array<{
          oldPositionId: string;
          newRowIndex: number;
        }>;

      const createResult = await executeVersionTransfer({
        sourceTenderId: sourceTender.id,
        newPositions: newPositions.map((position, index) => ({
          row_index: index,
          item_no: position.item_no || null,
          hierarchy_level: position.hierarchy_level || 0,
          work_name: position.work_name,
          unit_code: position.unit_code || null,
          volume: position.volume ?? null,
          client_note: position.client_note || null,
        })),
        matches: transferMappings.map(mapping => ({
          old_position_id: mapping.oldPositionId,
          new_row_index: mapping.newRowIndex,
        })),
      });

      dispatch({ type: 'SET_ADDITIONAL_WORKS', payload: [] });
      dispatch({ type: 'SET_NEW_TENDER_ID', payload: createResult.tenderId });
      message.success(
        `Новая версия создана! Тендер №${sourceTender.tender_number} v${createResult.version}`
      );
    } catch (error) {
      console.error('Ошибка создания версии:', error);
      const status = (error as { status?: number })?.status;
      if (status === 409) {
        message.error(
          'Эта версия тендера уже создана (возможно, кем-то параллельно). ' +
          'Закройте окно, обновите список тендеров и проверьте — новая версия должна быть видна.'
        );
      } else {
        message.error(`Не удалось создать версию: ${getErrorMessage(error)}`);
      }
    } finally {
      dispatch({ type: 'SET_CREATING', payload: false });
    }
  }, [sourceTender, newPositions, newPositionIndexes, state.matches]);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  return {
    state,
    performAutoMatch,
    toggleTransfer,
    acceptAllLowConfidence,
    manualMatch,
    breakMatch,
    setFilter,
    createVersion,
    reset,
  };
}
