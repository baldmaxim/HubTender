/**
 * Основной хук для сопоставления версий тендера
 */

import { useReducer, useCallback, useEffect } from 'react';
import { message } from 'antd';
import { supabase } from '../../../../../lib/supabase';
import type { Tender } from '../../../../../lib/supabase';
import type { ParsedRow } from '../../../../../utils/matching';
import { findBestMatches } from '../../../../../utils/matching';
import {
  createNewVersion,
  transferPositionData,
  transferAdditionalPositions,
  copyBoqItems,
  copyCostVolumes,
} from '../../../../../utils/versionTransfer';
import { matchReducer, initialMatchState, type MatchPair, type VersionMatchState } from '../types';

export interface UseVersionMatchingProps {
  sourceTender: Tender | null;
  newPositions: ParsedRow[];
}

export interface UseVersionMatchingResult {
  state: VersionMatchState;

  // Действия
  performAutoMatch: () => void;
  toggleTransfer: (oldId: string) => void;
  acceptAllLowConfidence: () => void;
  manualMatch: (oldId: string, newIdx: number) => void;
  breakMatch: (oldId: string) => void;
  setFilter: (filter: VersionMatchState['filter']) => void;

  // Создание новой версии
  createVersion: () => Promise<void>;

  // Сброс
  reset: () => void;
}

/**
 * Хук для сопоставления и переноса данных между версиями тендера
 *
 * @param sourceTender - исходный тендер (старая версия)
 * @param newPositions - распарсенные позиции из Excel файла
 * @returns объект с состоянием и методами управления
 */
export function useVersionMatching({
  sourceTender,
  newPositions,
}: UseVersionMatchingProps): UseVersionMatchingResult {
  const [state, dispatch] = useReducer(matchReducer, initialMatchState);

  /**
   * Загрузить позиции старой версии из БД
   */
  const loadOldPositions = useCallback(async (tenderId: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });

    try {
      const { data, error } = await supabase
        .from('client_positions')
        .select('*')
        .eq('tender_id', tenderId)
        .eq('is_additional', false)
        .order('position_number', { ascending: true });

      if (error) throw error;

      dispatch({ type: 'SET_OLD_POSITIONS', payload: data || [] });
    } catch (error: any) {
      console.error('Ошибка загрузки старых позиций:', error);
      message.error(`Не удалось загрузить позиции: ${error.message}`);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, []);

  // Загрузить старые позиции при изменении тендера
  useEffect(() => {
    if (!sourceTender) {
      dispatch({ type: 'RESET' });
      return;
    }

    dispatch({ type: 'SET_SOURCE_TENDER', payload: sourceTender });
    loadOldPositions(sourceTender.id);
  }, [sourceTender, loadOldPositions]);

  // Обновить новые позиции
  useEffect(() => {
    dispatch({ type: 'SET_NEW_POSITIONS', payload: newPositions });
  }, [newPositions]);

  /**
   * Выполнить автоматическое сопоставление
   */
  const performAutoMatch = useCallback(() => {
    if (state.oldPositions.length === 0 || newPositions.length === 0) {
      message.warning('Необходимо загрузить обе версии для сопоставления');
      return;
    }

    // Найти лучшие совпадения
    const matches = findBestMatches(state.oldPositions, newPositions);

    // Создать карту сопоставлений для быстрого поиска
    const matchMap = new Map<number, typeof matches[0]>();
    matches.forEach(match => {
      matchMap.set(match.newPositionIndex, match);
    });

    const matchedOldIds = new Set(matches.map(m => m.oldPositionId));

    // Создать пары сопоставлений в порядке новых позиций (порядок файла)
    const matchPairs: MatchPair[] = [];

    // Сначала добавляем все новые позиции в порядке их следования в файле
    newPositions.forEach((newPos, idx) => {
      const match = matchMap.get(idx);

      if (match) {
        // Есть сопоставление
        const oldPosition = state.oldPositions.find(p => p.id === match.oldPositionId);

        if (oldPosition) {
          matchPairs.push({
            oldPosition,
            newPosition: newPos,
            score: match.score,
            matchType: match.matchType,
            transferData: match.matchType === 'auto', // Автоматически включаем перенос для точных совпадений
            isAdditional: false,
          });
        }
      } else {
        // Нет сопоставления - новая позиция
        matchPairs.push({
          oldPosition: null,
          newPosition: newPos,
          score: null,
          matchType: 'new',
          transferData: false,
          isAdditional: false,
        });
      }
    });

    // Затем добавляем несопоставленные старые позиции (удаленные) в порядке их position_number
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
  }, [state.oldPositions, newPositions]);

  /**
   * Переключить флаг переноса данных
   */
  const toggleTransfer = useCallback((oldId: string) => {
    dispatch({ type: 'TOGGLE_TRANSFER', payload: { oldId } });
  }, []);

  /**
   * Принять все строки с низкой уверенностью (включить перенос данных)
   */
  const acceptAllLowConfidence = useCallback(() => {
    dispatch({ type: 'ACCEPT_ALL_LOW_CONFIDENCE' });
    message.success('Все строки с низкой уверенностью приняты для переноса');
  }, []);

  /**
   * Вручную сопоставить позиции
   */
  const manualMatch = useCallback((oldId: string, newIdx: number) => {
    dispatch({ type: 'MANUAL_MATCH', payload: { oldId, newIdx } });
    message.success('Позиции сопоставлены вручную');
  }, []);

  /**
   * Разорвать сопоставление
   */
  const breakMatch = useCallback((oldId: string) => {
    dispatch({ type: 'BREAK_MATCH', payload: { oldId } });
    message.info('Сопоставление удалено');
  }, []);

  /**
   * Установить фильтр
   */
  const setFilter = useCallback((filter: VersionMatchState['filter']) => {
    dispatch({ type: 'SET_FILTER', payload: filter });
  }, []);

  /**
   * Создать новую версию тендера
   */
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
      // 1. Создать новую версию тендера
      const createResult = await createNewVersion({
        sourceTender,
        newPositions,
      });

      const newTenderId = createResult.tenderId;
      const positionIdMap = createResult.positionIdMap;

      // 2. Подготовить маппинг для переноса данных
      const transferMappings = state.matches
        .filter(m => m.transferData && m.oldPosition && m.newPosition)
        .map(m => {
          const newIdx = newPositions.indexOf(m.newPosition!);
          const newPositionId = positionIdMap.get(newIdx);

          if (!newPositionId) {
            console.warn(`Не найден ID для новой позиции с индексом ${newIdx}`);
            return null;
          }

          return {
            oldPositionId: m.oldPosition!.id,
            newPositionId,
            transferData: true,
          };
        })
        .filter(Boolean) as Array<{
          oldPositionId: string;
          newPositionId: string;
          transferData: boolean;
        }>;

      // 3. Перенести данные позиций (manual_volume, manual_note)
      if (transferMappings.length > 0) {
        const transferResult = await transferPositionData(transferMappings);
        console.log('Перенос данных позиций:', transferResult);
      }

      // 3.5. Копировать boq_items для сопоставленных позиций
      if (transferMappings.length > 0) {
        console.log(`Копирование boq_items для ${transferMappings.length} позиций...`);

        const copyPromises = transferMappings.map(mapping =>
          copyBoqItems(mapping.oldPositionId, mapping.newPositionId, newTenderId)
        );

        const copyResults = await Promise.all(copyPromises);

        const totalCopied = copyResults.reduce((sum, result) => sum + result.copied, 0);
        const allErrors = copyResults.flatMap(result => result.errors);

        console.log(`Скопировано boq_items: ${totalCopied}`);
        if (allErrors.length > 0) {
          console.warn('Ошибки при копировании boq_items:', allErrors);
        }
      }

      // 3.6. Копировать объёмы затрат на строительство
      const costVolumesResult = await copyCostVolumes(sourceTender.id, newTenderId);
      console.log(`Скопировано объёмов затрат: ${costVolumesResult.copied}`);
      if (costVolumesResult.errors.length > 0) {
        console.warn('Ошибки при копировании объёмов затрат:', costVolumesResult.errors);
      }

      // 4. Обработать дополнительные работы
      const { data: additionalWorks } = await supabase
        .from('client_positions')
        .select('*')
        .eq('tender_id', sourceTender.id)
        .eq('is_additional', true);

      if (additionalWorks && additionalWorks.length > 0) {
        // Создать Map старых ID → новых ID
        const matchMap = new Map<string, string>();
        state.matches.forEach(m => {
          if (m.oldPosition && m.newPosition) {
            const newIdx = newPositions.indexOf(m.newPosition);
            const newId = positionIdMap.get(newIdx);
            if (newId) {
              matchMap.set(m.oldPosition.id, newId);
            }
          }
        });

        // Получить все новые позиции
        const { data: newPositionsFromDb } = await supabase
          .from('client_positions')
          .select('*')
          .eq('tender_id', newTenderId)
          .eq('is_additional', false);

        if (newPositionsFromDb) {
          const additionalResults = await transferAdditionalPositions(
            additionalWorks,
            matchMap,
            newPositionsFromDb,
            newTenderId
          );

          dispatch({ type: 'SET_ADDITIONAL_WORKS', payload: additionalResults });

          const successCount = additionalResults.filter(r => r.success).length;
          console.log(`Перенесено ДОП работ: ${successCount}/${additionalResults.length}`);
        }
      }

      dispatch({ type: 'SET_NEW_TENDER_ID', payload: newTenderId });
      message.success(`Новая версия создана! Тендер №${sourceTender.tender_number} v${createResult.version}`);

    } catch (error: any) {
      console.error('Ошибка создания версии:', error);
      message.error(`Не удалось создать версию: ${error.message}`);
    } finally {
      dispatch({ type: 'SET_CREATING', payload: false });
    }
  }, [sourceTender, newPositions, state.matches]);

  /**
   * Сброс состояния
   */
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
