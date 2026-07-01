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
    // Коалесим пачку resize-тиков поворота в один кадр (rAF) + bailout при неизменных
    // размерах — иначе на каждый тик новый объект vp перерисовывает таблицу.
    let frame = 0;
    const apply = () => {
      frame = 0;
      const next = getViewport();
      setVp((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    const handleResize = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  // Телефон-портрет: «Наименование» ≈ половина экрана, остальные колонки — скроллом вправо.
  // Внутренний вертикальный скролл включён (scroll.y) → работает виртуализация AntD:
  // на крупном тендере в DOM держим только видимые строки, а не все сразу.
  const phonePortrait = isPhone && !fitToScreen;
  const tableScrollY = Math.max(vp.height - 350, 320);
  const nameWidth = phonePortrait ? Math.max(Math.round(vp.width * 0.5), 140) : 300;

  const columns = useMemo(
    () => getResultsTableColumns(fitToScreen, nameWidth, phonePortrait),
    [fitToScreen, nameWidth, phonePortrait],
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
    <div style={{ width: '100%' }} className={phonePortrait ? 'crr-results-portrait' : undefined}>
      {phonePortrait && (
        // Единая высота строк тела: при virtual строки с Tag и без него иначе разной высоты,
        // что запускает петлю переизмерения rc-virtual-list (collectHeight → syncScrollTop) на
        // каждом кадре скролла. Фиксированная высота делает itemHeight детерминированным.
        <style>{`
          .crr-results-portrait .ant-table-row .ant-table-cell { height: 34px; overflow: hidden; }
        `}</style>
      )}
      <Table
        columns={columns}
        dataSource={rows}
        rowKey="key"
        loading={loading}
        bordered
        size="small"
        tableLayout={fitToScreen ? 'fixed' : undefined}
        style={fitToScreen ? { width: RESULTS_TABLE_WIDTH } : undefined}
        scroll={fitToScreen ? undefined : { x: 1800, y: tableScrollY }}
        pagination={false}
        virtual={!fitToScreen}
      />
    </div>
  );
};
