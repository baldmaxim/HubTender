/**
 * Таблица результатов перераспределения
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Table, Alert } from 'antd';
import { getResultsTableColumns, type ResultRow } from './ResultsTableColumns';

function getTableScrollY(): number {
  if (typeof window === 'undefined') {
    return 600;
  }

  return Math.max(window.innerHeight - 350, 320);
}

interface ResultsTableProps {
  rows: ResultRow[];
  hasResults: boolean;
  loading?: boolean;
}

export const ResultsTable: React.FC<ResultsTableProps> = ({
  rows,
  hasResults,
  loading = false,
}) => {
  const [tableScrollY, setTableScrollY] = useState(getTableScrollY);
  const columns = useMemo(() => getResultsTableColumns(), []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleResize = () => {
      setTableScrollY(getTableScrollY());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!hasResults) {
    return (
      <Alert
        message="Результаты перераспределения отсутствуют"
        description="Выполните расчет на вкладке 'Настройка перераспределения'"
        type="info"
        showIcon
      />
    );
  }

  return (
    <div style={{ width: '100%' }}>
      <Table
        columns={columns}
        dataSource={rows}
        rowKey="key"
        loading={loading}
        bordered
        size="small"
        scroll={{ x: 1800, y: tableScrollY }}
        pagination={false}
        virtual
      />
    </div>
  );
};
