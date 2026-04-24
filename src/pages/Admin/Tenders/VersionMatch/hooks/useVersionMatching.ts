/**
 * Основной хук для сопоставления версий тендера
 */

import { useReducer, useCallback, useEffect, useMemo } from 'react';
import { message } from 'antd';
import { supabase } from '../../../../../lib/supabase';
import type { Tender } from '../../../../../lib/supabase';
import type { ParsedRow } from '../../../../../utils/matching';
import { findBestMatches } from '../../../../../utils/matching';
import { executeVersionTransfer } from '../../../../../utils/versionTransfer';
import { matchReducer, initialMatchState, type MatchPair, type VersionMatchState } from '../types';
import { getErrorMessage } from '../../../../../utils/errors';

const PAGE_SIZE = 1000;

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

  const oldPositionsById = useMemo(
    () => new Map(state.oldPositions.map(position => [position.id, position])),
    [state.oldPositions]
  );

  const newPositionIndexes = useMemo(
    () => new Map(newPositions.map((position, index) => [position, index])),
    [newPositions]
  );

  const fetchAllClientPositions = useCallback(async (
    filters: (query: any) => any
  ) => {
    const items: any[] = [];
    let from = 0;

    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const query = filters(
        supabase
          .from('client_positions')
          .select('*')
      ).range(from, to);

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      const batch = data || [];
      items.push(...batch);

      if (batch.length < PAGE_SIZE) {
        break;
      }

      from += PAGE_SIZE;
    }

    return items;
  }, []);

  const loadOldPositions = useCallback(async (tenderId: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });

    try {
      const data = await fetchAllClientPositions((query) => query
        .eq('tender_id', tenderId)
        .eq('is_additional', false)
        .order('position_number', { ascending: true })
      );

      dispatch({ type: 'SET_OLD_POSITIONS', payload: data || [] });
    } catch (error) {
      console.error('Ошибка загрузки старых позиций:', error);
      message.error(`Не удалось загрузить позиции: ${getErrorMessage(error)}`);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [fetchAllClientPositions]);

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

    dispatch({ type: 'SET_LOADING', payload: true });

    window.setTimeout(() => {
      try {
        const matches = findBestMatches(state.oldPositions, newPositions);
        const matchMap = new Map<number, typeof matches[0]>();
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

        const unmatchedOldPositions = state.oldPositions
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

        dispatch({ type: 'SET_MATCHES', payload: matchPairs });

        const autoCount = matchPairs.filter(m => m.matchType === 'auto').length;
        const lowConfCount = matchPairs.filter(m => m.matchType === 'low_confidence').length;

        message.success(
          `Сопоставление выполнено: ${autoCount} точных совпадений, ${lowConfCount} с низкой уверенностью`
        );
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }, 0);
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
      message.error(`Не удалось создать версию: ${getErrorMessage(error)}`);
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
