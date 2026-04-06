/**
 * Вкладка "Таблица результатов"
 */

import React from 'react';
import { ResultsTable } from './Results/ResultsTable';
import type { ResultRow } from './Results/ResultsTableColumns';

interface TabResultsProps {
  rows: ResultRow[];
  hasResults: boolean;
  loading?: boolean;
}

export const TabResults: React.FC<TabResultsProps> = ({
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
