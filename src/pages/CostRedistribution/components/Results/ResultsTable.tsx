/**
 * Таблица результатов перераспределения
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Table, Alert } from 'antd';
import { getResultsTableColumns, RESULTS_TABLE_WIDTH, type ResultRow } from './ResultsTableColumns';
import { useIsMobile } from '../../../../hooks/useIsMobile';

function getViewport(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: 1200, height: 800 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

interface ResultsTableProps {
  rows: ResultRow[];
  hasResults: boolean;
  loading?: boolean;
  /** Для ландшафтного оверлея: без внутреннего скролла/виртуализации и без fixed-колонок. */
  fitToScreen?: boolean;
}

export const ResultsTable: React.FC<ResultsTableProps> = ({
  rows,
  hasResults,
  loading = false,
  fitToScreen = false,
}) => {
  const { isPhone } = useIsMobile();
  const [vp, setVp] = useState(getViewport);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const handleResize = () => setVp(getViewport());
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  // Телефон-портрет: «Наименование» ≈ половина экрана, остальные колонки — скроллом вправо.
  // Внутренний вертикальный скролл выключаем — таблица скроллится страницей до верха.
  const phonePortrait = isPhone && !fitToScreen;
  const tableScrollY = Math.max(vp.height - 350, 320);
  const nameWidth = phonePortrait ? Math.max(Math.round(vp.width * 0.5), 140) : 300;

  const columns = useMemo(
    () => getResultsTableColumns(fitToScreen, nameWidth),
    [fitToScreen, nameWidth],
  );

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
        tableLayout={fitToScreen ? 'fixed' : undefined}
        style={fitToScreen ? { width: RESULTS_TABLE_WIDTH } : undefined}
        scroll={fitToScreen ? undefined : phonePortrait ? { x: 1800 } : { x: 1800, y: tableScrollY }}
        pagination={false}
        virtual={!fitToScreen && !phonePortrait}
      />
    </div>
  );
};
