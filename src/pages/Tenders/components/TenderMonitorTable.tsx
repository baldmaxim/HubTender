import React from 'react';
import { Empty, Input, Skeleton, Space } from 'antd';
import type { TenderRegistryWithRelations } from '../../../lib/supabase';
import { useTheme } from '../../../contexts/ThemeContext';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useHorizontalSwipe } from '../../../hooks/useHorizontalSwipe';
import {
  getDashboardStatus,
  type TenderMonitorSortDirection,
  type TenderMonitorSortField,
  type TenderMonitorTab,
} from '../utils/tenderMonitor';
import { getTenderMonitorPalette, type TenderMonitorPalette } from '../utils/tenderMonitorTheme';
import { TenderMonitorCards } from './TenderMonitorCards';
import { DesktopTableHeader, SectionHeader, TenderRow } from './TenderMonitorDesktopRows';

interface TenderMonitorTableProps {
  tenders: TenderRegistryWithRelations[];
  loading: boolean;
  activeTab: TenderMonitorTab;
  searchValue: string;
  sortField: TenderMonitorSortField;
  sortDirection: TenderMonitorSortDirection;
  counts: Record<TenderMonitorTab, number>;
  onTabChange: (tab: TenderMonitorTab) => void;
  onSearchChange: (value: string) => void;
  onSortChange: (field: TenderMonitorSortField) => void;
  onOpenTender: (tender: TenderRegistryWithRelations) => void;
  onOpenTimeline: (tender: TenderRegistryWithRelations) => void;
  onOpenPackage: (tender: TenderRegistryWithRelations) => void;
  onQuickCall: (tender: TenderRegistryWithRelations) => Promise<void> | void;
  onUpdate: () => Promise<void> | void;
  /** Режим «только просмотр» — скрывает кнопки звонка (Генеральный директор) */
  readOnly?: boolean;
}

function SortButton({
  active,
  label,
  direction,
  onClick,
  palette,
}: {
  active: boolean;
  label: string;
  direction?: TenderMonitorSortDirection;
  onClick: () => void;
  palette: TenderMonitorPalette;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '7px 12px',
        borderRadius: 8,
        border: `1px solid ${active ? palette.warning : palette.border}`,
        background: palette.sectionBg,
        color: active ? palette.warning : palette.muted,
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      {label} {active ? (direction === 'asc' ? '↑' : '↓') : '↕'}
    </button>
  );
}

export const TenderMonitorTable: React.FC<TenderMonitorTableProps> = ({
  tenders,
  loading,
  activeTab,
  searchValue,
  sortField,
  sortDirection,
  counts,
  onTabChange,
  onSearchChange,
  onSortChange,
  onOpenTender,
  onOpenTimeline,
  onOpenPackage,
  onQuickCall,
  onUpdate,
  readOnly,
}) => {
  void onUpdate;

  const { theme } = useTheme();
  const { screens, isPhone } = useIsMobile();
  const palette = getTenderMonitorPalette(theme === 'dark');
  const isCardView = !screens.xl;

  const sections =
    activeTab === 'all'
      ? [
          { key: 'calc' as const, title: 'В расчете', items: tenders.filter((tender) => getDashboardStatus(tender) === 'calc') },
          { key: 'sent' as const, title: 'Направлено', items: tenders.filter((tender) => getDashboardStatus(tender) === 'sent') },
          {
            key: 'waiting_pd' as const,
            title: 'Ожидание ПД',
            items: tenders.filter((tender) => getDashboardStatus(tender) === 'waiting_pd'),
          },
        ]
      : [
          {
            key: activeTab,
            title:
              activeTab === 'archive'
                ? 'Архив'
                : activeTab === 'sent'
                  ? 'Направлено'
                  : activeTab === 'waiting_pd'
                    ? 'Ожидание ПД'
                    : 'В расчете',
            items: tenders,
          },
        ];

  const tabs: Array<{ key: TenderMonitorTab; label: string }> = [
    { key: 'all', label: 'Все' },
    { key: 'calc', label: 'В расчете' },
    { key: 'sent', label: 'Направлено' },
    { key: 'waiting_pd', label: 'Ожидание ПД' },
    { key: 'archive', label: 'Архив' },
  ];

  const goToTabOffset = (delta: number) => {
    const index = tabs.findIndex((tab) => tab.key === activeTab);
    const next = Math.min(Math.max(index + delta, 0), tabs.length - 1);
    if (next !== index) {
      onTabChange(tabs[next].key);
    }
  };

  const cardSwipe = useHorizontalSwipe({
    onSwipeLeft: () => goToTabOffset(1),
    onSwipeRight: () => goToTabOffset(-1),
  });

  const tabsBlock = (
    <div style={{ display: 'flex', gap: 14, borderBottom: `1px solid ${palette.border}`, marginBottom: 16, flexWrap: 'wrap' }}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onTabChange(tab.key)}
          style={{
            padding: '0 0 8px',
            border: 'none',
            borderBottom: activeTab === tab.key ? `2px solid ${palette.warning}` : '2px solid transparent',
            background: 'transparent',
            color: activeTab === tab.key ? palette.warning : palette.muted,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {tab.label}{' '}
          <span
            style={{
              display: 'inline-flex',
              minWidth: 18,
              height: 18,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              background: activeTab === tab.key ? palette.warningBg : palette.tabBadgeBg,
              color: activeTab === tab.key ? palette.warning : palette.muted,
              fontSize: 10,
            }}
          >
            {counts[tab.key]}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div>
      {!isCardView && tabsBlock}

      <div
        style={{
          border: isPhone ? 'none' : `1px solid ${palette.border}`,
          borderRadius: isPhone ? 0 : 14,
          overflow: 'hidden',
          background: isPhone ? 'transparent' : palette.cardBgAlt,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            padding: isPhone ? '4px 0 10px' : '10px 12px',
            borderBottom: isPhone ? 'none' : `1px solid ${palette.border}`,
            flexWrap: 'wrap',
          }}
        >
          <Space wrap size={12}>
            <Input
              allowClear
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Поиск по ЖК или заказчику..."
              style={{ width: 220 }}
              size="small"
            />
            <SortButton
              active={sortField === 'submission_date'}
              label="По дате"
              direction={sortField === 'submission_date' ? sortDirection : undefined}
              onClick={() => onSortChange('submission_date')}
              palette={palette}
            />
            <SortButton
              active={sortField === 'area'}
              label="По площади"
              direction={sortField === 'area' ? sortDirection : undefined}
              onClick={() => onSortChange('area')}
              palette={palette}
            />
            <SortButton
              active={sortField === 'total_cost'}
              label="По сумме"
              direction={sortField === 'total_cost' ? sortDirection : undefined}
              onClick={() => onSortChange('total_cost')}
              palette={palette}
            />
          </Space>
        </div>

        {isCardView && tabsBlock}

        {loading ? (
          <div style={{ padding: 24 }}>
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        ) : sections.every((section) => section.items.length === 0) ? (
          <Empty description="Тендеры не найдены" style={{ padding: 48 }} />
        ) : isCardView ? (
          <div {...cardSwipe} style={{ touchAction: 'pan-y' }}>
            <TenderMonitorCards
              sections={sections}
              onOpenTender={onOpenTender}
              onOpenTimeline={onOpenTimeline}
              onOpenPackage={onOpenPackage}
              onQuickCall={onQuickCall}
              palette={palette}
              readOnly={readOnly}
            />
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.key}>
              <SectionHeader title={section.title} tenders={section.items} palette={palette} />
              <DesktopTableHeader palette={palette} />
              {section.items.length > 0 ? (
                section.items.map((tender) => (
                  <TenderRow
                    key={tender.id}
                    tender={tender}
                    onOpenTender={onOpenTender}
                    onOpenTimeline={onOpenTimeline}
                    onQuickCall={onQuickCall}
                    palette={palette}
                    readOnly={readOnly}
                  />
                ))
              ) : (
                <div style={{ padding: 36, color: palette.muted, textAlign: 'center' }}>Нет тендеров</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default TenderMonitorTable;
