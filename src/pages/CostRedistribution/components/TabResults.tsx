/**
 * Вкладка "Таблица результатов"
 */

import React, { memo } from 'react';
import { ResultsTable } from './Results/ResultsTable';
import type { ResultRow } from './Results/ResultsTableColumns';

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
