/**
 * Вкладка "Таблица результатов"
 */

import React, { memo } from 'react';
import { ResultsTable } from './Results/ResultsTable';
import type { ResultRow } from './Results/ResultsTableColumns';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useTheme } from '../../../contexts/ThemeContext';
import { LandscapeTableOverlay } from '../../../components/responsive/LandscapeTableOverlay';

interface TabResultsProps {
  rows: ResultRow[];
  hasResults: boolean;
  loading?: boolean;
}

const TabResultsImpl: React.FC<TabResultsProps> = ({
  rows,
  hasResults,
  loading,
}) => {
  const { isLandscapePhone } = useIsMobile();
  const { theme: currentTheme } = useTheme();

  // В ландшафте телефона — таблица (read-only) во весь экран с авто-масштабом.
  // Неактивная вкладка скрыта через display:none у Ant Tabs, поэтому fixed-оверлей
  // не «вылезает» когда вкладка результатов не выбрана.
  if (isLandscapePhone && hasResults) {
    return (
      <LandscapeTableOverlay theme={currentTheme} fit="width">
        <ResultsTable rows={rows} hasResults={hasResults} loading={loading} fitToScreen />
      </LandscapeTableOverlay>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      <ResultsTable
        rows={rows}
        hasResults={hasResults}
        loading={loading}
      />
    </div>
  );
};

// Вкладка рендерится из родителя на каждый тик autosave/nonce — memo
// срезает ре-рендеры, пока rows/hasResults/loading стабильны по ссылке.
export const TabResults = memo(TabResultsImpl);
