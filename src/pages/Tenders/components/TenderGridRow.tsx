import React, { useState } from 'react';
import { Tag } from 'antd';
import type { TenderRegistryWithRelations } from '../../../lib/supabase';
import { getStatusDotColor, formatArea } from '../utils/design';

const SCOPE_COLOR_MAP: Record<string, string> = {
  'генподряд': 'orange',
  'коробка': 'lime',
  'монолит': 'blue',
  'монолит подземной части': 'red',
  'монолит+нулевой цикл': 'purple',
};
import dayjs from 'dayjs';

// Цветовые схемы для темной и светлой темы
const getRowColors = (isDark: boolean) => ({
  rowBg: isDark ? 'rgba(255,255,255,0.012)' : 'rgba(0,0,0,0.015)',
  rowBgHovered: isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)',
  rowBgSelected: isDark ? 'rgba(52,211,153,0.04)' : 'rgba(52,211,153,0.06)',
  rowBgDragOver: isDark ? 'rgba(52,211,153,0.06)' : 'rgba(52,211,153,0.08)',
  rowBgDragging: isDark ? 'rgba(52,211,153,0.1)' : 'rgba(52,211,153,0.12)',
  border: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)',
  borderSelected: isDark ? 'rgba(52,211,153,0.15)' : 'rgba(52,211,153,0.3)',
  borderDragOver: isDark ? 'rgba(52,211,153,0.4)' : 'rgba(52,211,153,0.5)',
  titleText: isDark ? '#e8e8e8' : '#1a1a1a',
  normalText: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.65)',
  mutedText: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.45)',
});

interface TenderGridRowProps {
  tender: TenderRegistryWithRelations;
  isSelected: boolean;
  onRowClick: () => void;
  onDragStart?: (e: React.DragEvent, tender: TenderRegistryWithRelations) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, tender: TenderRegistryWithRelations) => void;
  isDragging?: boolean;
  isDragOver?: boolean;
  isDark: boolean;
}

export const TenderGridRow: React.FC<TenderGridRowProps> = ({
  tender,
  isSelected,
  onRowClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isDragging = false,
  isDragOver = false,
  isDark,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const statusColor = getStatusDotColor((tender.status as { name?: string } | null | undefined)?.name);
  const colors = getRowColors(isDark);

  return (
    <div
      draggable={true}
      onDragStart={(e) => onDragStart?.(e, tender)}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop?.(e, tender)}
      onClick={onRowClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '100px 1fr 180px 150px 150px 130px 180px',
        alignItems: 'center',
        padding: '7px 14px',
        cursor: isDragging ? 'grabbing' : 'grab',
        background: isDragging
          ? colors.rowBgDragging
          : isDragOver
          ? colors.rowBgDragOver
          : isSelected
          ? colors.rowBgSelected
          : isHovered
          ? colors.rowBgHovered
          : colors.rowBg,
        border: isDragOver
          ? `2px solid ${colors.borderDragOver}`
          : isSelected
          ? `1px solid ${colors.borderSelected}`
          : `1px solid ${colors.border}`,
        borderRadius: 10,
        transition: 'all 0.15s',
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {/* Номер тендера */}
      <span
        style={{
          fontSize: 13,
          color: colors.normalText,
          fontFamily: "'DM Mono', monospace",
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: statusColor,
            flexShrink: 0,
          }}
        />
        {tender.tender_number || '—'}
      </span>

      {/* Наименование */}
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: colors.titleText,
          lineHeight: 1.4,
          paddingRight: 12,
        }}
      >
        <div
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {tender.title}
        </div>
      </div>

      {/* Заказчик */}
      <div
        style={{
          fontSize: 13,
          color: colors.normalText,
          textAlign: 'center',
        }}
      >
        {tender.client_name}
      </div>

      {/* Объем строительства */}
      <div style={{ textAlign: 'center' }}>
        {(() => {
          const scopeName = (tender.construction_scope as { name?: string } | null | undefined)?.name;
          if (!scopeName) return <span style={{ fontSize: 11, color: colors.mutedText }}>—</span>;
          const color = SCOPE_COLOR_MAP[scopeName.toLowerCase()] || 'default';
          return <Tag color={color} style={{ margin: 0, fontSize: 11 }}>{scopeName}</Tag>;
        })()}
      </div>

      {/* Общая стоимость */}
      <div
        style={{
          fontSize: 11,
          color: colors.normalText,
          textAlign: 'center',
          fontFamily: "'DM Mono', monospace",
        }}
      >
        {tender.total_cost
          ? tender.total_cost.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
          : '—'}
      </div>

      {/* Площадь */}
      <div
        style={{
          fontSize: 12,
          color: colors.normalText,
          textAlign: 'center',
          fontFamily: "'DM Mono', monospace",
        }}
      >
        {formatArea(tender.area)}
      </div>

      {/* Дата выхода на площадку */}
      <div
        style={{
          fontSize: 12,
          color: colors.mutedText,
          textAlign: 'center',
          fontFamily: "'DM Mono', monospace",
        }}
      >
        {tender.construction_start_date
          ? dayjs(tender.construction_start_date).format('DD.MM.YYYY')
          : '-'}
      </div>
    </div>
  );
};
