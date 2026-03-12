/**
 * Типы для модуля сопоставления версий тендера
 */

import type { ClientPosition, Tender } from '../../../../lib/supabase';
import type { ParsedRow, MatchScoreBreakdown } from '../../../../utils/matching';
import type { AdditionalWorkTransfer } from '../../../../utils/versionTransfer';

/**
 * Пара сопоставленных позиций (старая ↔ новая)
 */
export interface MatchPair {
  oldPosition: ClientPosition | null; // null = новая позиция
  newPosition: ParsedRow | null;      // null = удалена
  score: MatchScoreBreakdown | null;
  matchType: 'auto' | 'manual' | 'new' | 'deleted' | 'low_confidence';
  transferData: boolean; // Флаг переноса данных
  isAdditional: boolean; // Является ли дополнительной работой
}

/**
 * Состояние модуля сопоставления версий
 */
export interface VersionMatchState {
  sourceTender: Tender | null;
  oldPositions: ClientPosition[];
  newPositions: ParsedRow[];
  matches: MatchPair[];
  additionalWorks: AdditionalWorkTransfer[];
  filter: 'all' | 'matched' | 'unmatched' | 'additional' | 'low_confidence';
  loading: boolean;
  creating: boolean;
  newTenderId: string | null;
}

/**
 * Действия для управления состоянием
 */
export type MatchAction =
  | { type: 'SET_SOURCE_TENDER'; payload: Tender }
  | { type: 'SET_OLD_POSITIONS'; payload: ClientPosition[] }
  | { type: 'SET_NEW_POSITIONS'; payload: ParsedRow[] }
  | { type: 'SET_MATCHES'; payload: MatchPair[] }
  | { type: 'SET_ADDITIONAL_WORKS'; payload: AdditionalWorkTransfer[] }
  | { type: 'UPDATE_MATCH'; payload: { index: number; match: MatchPair } }
  | { type: 'TOGGLE_TRANSFER'; payload: { oldId: string } }
  | { type: 'ACCEPT_ALL_LOW_CONFIDENCE' }
  | { type: 'MANUAL_MATCH'; payload: { oldId: string; newIdx: number } }
  | { type: 'BREAK_MATCH'; payload: { oldId: string } }
  | { type: 'SET_FILTER'; payload: VersionMatchState['filter'] }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_CREATING'; payload: boolean }
  | { type: 'SET_NEW_TENDER_ID'; payload: string }
  | { type: 'RESET' };

/**
 * Редюсер для управления состоянием сопоставления
 */
export function matchReducer(
  state: VersionMatchState,
  action: MatchAction
): VersionMatchState {
  switch (action.type) {
    case 'SET_SOURCE_TENDER':
      return { ...state, sourceTender: action.payload };

    case 'SET_OLD_POSITIONS':
      return { ...state, oldPositions: action.payload };

    case 'SET_NEW_POSITIONS':
      return { ...state, newPositions: action.payload };

    case 'SET_MATCHES':
      return { ...state, matches: action.payload };

    case 'SET_ADDITIONAL_WORKS':
      return { ...state, additionalWorks: action.payload };

    case 'UPDATE_MATCH': {
      const newMatches = [...state.matches];
      newMatches[action.payload.index] = action.payload.match;
      return { ...state, matches: newMatches };
    }

    case 'TOGGLE_TRANSFER': {
      const newMatches = state.matches.map(match => {
        if (match.oldPosition?.id === action.payload.oldId) {
          return { ...match, transferData: !match.transferData };
        }
        return match;
      });
      return { ...state, matches: newMatches };
    }

    case 'ACCEPT_ALL_LOW_CONFIDENCE': {
      const newMatches = state.matches.map(match => {
        if (match.matchType === 'low_confidence' && !match.transferData) {
          return { ...match, transferData: true };
        }
        return match;
      });
      return { ...state, matches: newMatches };
    }

    case 'MANUAL_MATCH': {
      const { oldId, newIdx } = action.payload;
      // Найти старую позицию
      const oldPosition = state.oldPositions.find(p => p.id === oldId);
      const newPosition = state.newPositions[newIdx];

      if (!oldPosition || !newPosition) return state;

      // Обновить matches
      const newMatches = state.matches.map(match => {
        // Удалить старые сопоставления для этих позиций
        if (match.oldPosition?.id === oldId || match.newPosition === newPosition) {
          return match;
        }
        return match;
      });

      // Добавить новое сопоставление
      newMatches.push({
        oldPosition,
        newPosition,
        score: null,
        matchType: 'manual',
        transferData: true,
        isAdditional: false,
      });

      return { ...state, matches: newMatches };
    }

    case 'BREAK_MATCH': {
      const newMatches = state.matches.filter(
        match => match.oldPosition?.id !== action.payload.oldId
      );
      return { ...state, matches: newMatches };
    }

    case 'SET_FILTER':
      return { ...state, filter: action.payload };

    case 'SET_LOADING':
      return { ...state, loading: action.payload };

    case 'SET_CREATING':
      return { ...state, creating: action.payload };

    case 'SET_NEW_TENDER_ID':
      return { ...state, newTenderId: action.payload };

    case 'RESET':
      return initialMatchState;

    default:
      return state;
  }
}

/**
 * Начальное состояние
 */
export const initialMatchState: VersionMatchState = {
  sourceTender: null,
  oldPositions: [],
  newPositions: [],
  matches: [],
  additionalWorks: [],
  filter: 'all',
  loading: false,
  creating: false,
  newTenderId: null,
};
