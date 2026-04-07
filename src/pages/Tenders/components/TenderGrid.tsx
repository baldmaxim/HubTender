import React from 'react';
import { Spin, Empty, Pagination } from 'antd';
import { TenderGridRow } from './TenderGridRow';
import type { TenderRegistryWithRelations, TenderRegistry } from '../../../lib/supabase';
import { useTheme } from '../../../contexts/ThemeContext';

interface TenderGridProps {
  dataSource: TenderRegistryWithRelations[];
  loading: boolean;
  currentPage: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number, pageSize: number) => void;
  onRowClick: (record: TenderRegistryWithRelations) => void;
  onReorder?: (draggedId: string, targetId: string) => void;
}

export const TenderGrid: React.FC<TenderGridProps> = ({
  dataSource,
  loading,
  currentPage,
  pageSize,
  totalCount,
  onPageChange,
  onRowClick,
  onReorder,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [draggedId, setDraggedId] = React.useState<string | null>(null);
  const [dragOverId, setDragOverId] = React.useState<string | null>(null);

  const handleRowClick = (record: TenderRegistryWithRelations) => {
    setSelectedId(record.id);
    onRowClick(record);
  };

  const handleDragStart = (e: React.DragEvent, tender: TenderRegistryWithRelations) => {
    setDraggedId(tender.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget.innerHTML);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetTender: TenderRegistryWithRelations) => {
    e.preventDefault();
    if (draggedId && draggedId !== targetTender.id && onReorder) {
      onReorder(draggedId, targetTender.id);
    }
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnter = (tender: TenderRegistryWithRelations) => {
    if (draggedId && draggedId !== tender.id) {
      setDragOverId(tender.id);
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const paginatedData = dataSource.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (dataSource.length === 0) {
    return (
      <Empty
        description="Нет данных"
        style={{ padding: 60 }}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Заголовки колонок */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '100px 1fr 180px 150px 150px 130px 180px',
          alignItems: 'center',
          padding: '0 14px',
          fontSize: 11,
          fontWeight: 600,
          color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.45)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        <span>№ Тендера</span>
        <span>Наименование</span>
        <span style={{ textAlign: 'center' }}>Заказчик</span>
        <span style={{ textAlign: 'center', fontSize: 10 }}>Объем строительства</span>
        <span style={{ textAlign: 'center', fontSize: 10 }}>Общая стоимость</span>
        <span style={{ textAlign: 'center', fontSize: 10 }}>Площадь, м²</span>
        <span style={{ textAlign: 'center', fontSize: 10 }}>Дата выхода на площадку</span>
      </div>

      {/* Список тендеров */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {paginatedData.map((tender) => (
          <div
            key={tender.id}
            onDragEnter={() => handleDragEnter(tender)}
            onDragLeave={handleDragLeave}
          >
            <TenderGridRow
              tender={tender}
              isSelected={tender.id === selectedId}
              onRowClick={() => handleRowClick(tender)}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              isDragging={tender.id === draggedId}
              isDragOver={tender.id === dragOverId}
              isDark={isDark}
            />
          </div>
        ))}
      </div>

      {/* Пагинация */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16 }}>
        <Pagination
          current={currentPage}
          pageSize={pageSize}
          total={totalCount}
          onChange={onPageChange}
          showSizeChanger
          showTotal={(total) => `Всего ${total} записей`}
          pageSizeOptions={['10', '25', '50', '100']}
        />
      </div>
    </div>
  );
};
