import React from 'react';
import { Empty, Input, Skeleton, Space } from 'antd';
import {
  LinkOutlined,
  PhoneOutlined,
} from '@ant-design/icons';
import type { TenderRegistryWithRelations } from '../../../lib/supabase';
import { useTheme } from '../../../contexts/ThemeContext';
import { useIsMobile } from '../../../hooks/useIsMobile';
import {
  formatArea,
  formatDate,
  formatMoney,
  formatRubPerSquare,
  getControlDate,
  getDashboardStatus,
  getDaysSinceControl,
  getDaysToSubmission,
  getPackageItems,
  getPackageLinkHref,
  getStatusBadgeStyle,
  getTenderPackageBadgeStyle,
  getTenderStatusDisplayLabel,
  type TenderMonitorSortDirection,
  type TenderMonitorSortField,
  type TenderMonitorTab,
} from '../utils/tenderMonitor';
import { getTenderMonitorPalette, type TenderMonitorPalette } from '../utils/tenderMonitorTheme';
import { MapPopover, ChronologyPopover } from './TenderMonitorPopovers';
import { TenderMonitorCards } from './TenderMonitorCards';

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
  onQuickCall: (tender: TenderRegistryWithRelations) => Promise<void> | void;
  onUpdate: () => Promise<void> | void;
  /** Режим «только просмотр» — скрывает кнопки звонка (Генеральный директор) */
  readOnly?: boolean;
}

type TableColumn = {
  key: string;
  label: string;
  template: string;
  align?: 'left' | 'center' | 'right';
};

const GRID_COLUMNS: TableColumn[] = [
  { key: 'index', label: '№', template: '42px', align: 'center' },
  { key: 'title', label: 'ЖК / объект', template: 'minmax(84px, 0.82fr)' },
  { key: 'client', label: 'Заказчик', template: 'minmax(64px, 0.5fr)' },
  { key: 'area', label: 'Площадь', template: '96px', align: 'center' },
  { key: 'cost', label: 'Стоимость КП', template: '116px', align: 'center' },
  { key: 'rate', label: '₽/м²', template: '86px', align: 'center' },
  { key: 'submission', label: 'Дата подачи', template: '204px', align: 'center' },
  { key: 'package', label: 'Тендерный пакет', template: 'minmax(180px, 0.7fr)', align: 'left' },
  { key: 'status', label: 'Статус / время', template: '132px', align: 'center' },
  { key: 'timeline', label: 'Хронология', template: '84px', align: 'center' },
  { key: 'invite', label: 'Приглашение', template: '82px', align: 'center' },
];

const GRID_TEMPLATE = GRID_COLUMNS.map((column) => column.template).join(' ');

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

function renderHeader(palette: TenderMonitorPalette) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: GRID_TEMPLATE,
        columnGap: 8,
        padding: '0 14px',
        alignItems: 'stretch',
        borderBottom: `1px solid ${palette.border}`,
      }}
    >
      {GRID_COLUMNS.map((column) => (
        <div
          key={column.key}
          style={{
            padding: '10px 0',
            textAlign: column.align || 'left',
            color: palette.muted,
            fontSize: 9,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            lineHeight: 1.25,
            whiteSpace: 'normal',
          }}
        >
          {column.label}
        </div>
      ))}
    </div>
  );
}

function SectionHeader({
  title,
  tenders,
  palette,
}: {
  title: string;
  tenders: TenderRegistryWithRelations[];
  palette: TenderMonitorPalette;
}) {
  const totalArea = tenders.reduce((sum, tender) => sum + (tender.area || 0), 0);
  const totalCost = tenders.reduce((sum, tender) => sum + (tender.total_cost || tender.manual_total_cost || 0), 0);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '11px 14px',
        borderBottom: `1px solid ${palette.border}`,
        background: palette.sectionBg,
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ color: palette.text, fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{title}</div>
      <div style={{ color: palette.muted, fontSize: 11 }}>
        {tenders.length} тендеров · {formatArea(totalArea)} · {formatMoney(totalCost)}
      </div>
    </div>
  );
}

function TenderRow({
  tender,
  onOpenTender,
  onOpenTimeline,
  onQuickCall,
  palette,
  readOnly,
}: {
  tender: TenderRegistryWithRelations;
  onOpenTender: (tender: TenderRegistryWithRelations) => void;
  onOpenTimeline: (tender: TenderRegistryWithRelations) => void;
  onQuickCall: (tender: TenderRegistryWithRelations) => Promise<void> | void;
  palette: TenderMonitorPalette;
  readOnly?: boolean;
}) {
  const dashboardStatus = getDashboardStatus(tender);
  const badgeStyle = getStatusBadgeStyle(dashboardStatus);
  const packageItems = getPackageItems(tender).filter((item) => item.text?.trim());
  const daysToSubmission = getDaysToSubmission(tender);
  const daysSinceControl = getDaysSinceControl(tender);
  const canQuickCall = dashboardStatus === 'sent' && (daysSinceControl ?? 0) > 7;
  const controlDate = getControlDate(tender);
  const canSubmissionCall = dashboardStatus === 'calc' && controlDate != null && (daysSinceControl ?? 0) >= 7;

  return (
    <div
      onClick={() => onOpenTender(tender)}
      style={{
        display: 'grid',
        gridTemplateColumns: GRID_TEMPLATE,
        columnGap: 8,
        padding: '0 14px',
        alignItems: 'center',
        borderBottom: `1px solid ${palette.borderSoft}`,
        cursor: 'pointer',
        background: palette.cardBgAlt,
      }}
    >
      <div style={{ padding: '12px 0', color: palette.subtleText, fontSize: 11, textAlign: 'center' }}>{tender.sort_order}</div>

      <div style={{ padding: '12px 0', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div
            style={{
              color: palette.text,
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.25,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {tender.title}
          </div>
          <MapPopover tender={tender} palette={palette} />
        </div>
        {tender.tender_number ? <div style={{ color: palette.muted, fontSize: 11, marginTop: 3 }}>{tender.tender_number}</div> : null}
      </div>

      <div
        style={{
          padding: '12px 0',
          color: palette.muted,
          fontSize: 13,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {tender.client_name || '—'}
      </div>

      <div style={{ padding: '12px 0', color: palette.text, textAlign: 'center', fontSize: 13, fontWeight: 600 }}>{formatArea(tender.area)}</div>
      <div style={{ padding: '12px 0', color: palette.text, textAlign: 'center', fontSize: 13, fontWeight: 600 }}>
        {formatMoney(tender.total_cost || tender.manual_total_cost)}
      </div>
      <div style={{ padding: '12px 0', color: palette.muted, textAlign: 'center', fontSize: 12 }}>
        {formatRubPerSquare(tender.total_cost || tender.manual_total_cost, tender.area)}
      </div>

      <div style={{ padding: '12px 0', textAlign: 'center' }}>
        <div style={{ color: dashboardStatus === 'calc' ? palette.warning : palette.textSecondary, fontSize: 12, fontWeight: 700 }}>
          {formatDate(tender.submission_date)}
        </div>
        {dashboardStatus === 'calc' && daysToSubmission != null ? (
          canSubmissionCall && !readOnly ? (
            <div style={{ marginTop: 5 }}>
              <button
                type="button"
                className="tender-monitor-call-button"
                onClick={(event) => {
                  event.stopPropagation();
                  void onQuickCall(tender);
                }}
                style={{
                  border: `1px solid ${palette.dangerBorder}`,
                  background: palette.dangerBg,
                  color: palette.danger,
                  borderRadius: 6,
                  padding: '2px 7px',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                <PhoneOutlined style={{ marginRight: 6 }} />
                Позвонить
              </button>
            </div>
          ) : (
            <div style={{ color: daysToSubmission < 0 && controlDate ? palette.success : '#ff9f43', fontSize: 11, marginTop: 3 }}>
              {daysToSubmission < 0 && controlDate ? `${daysSinceControl ?? 0}/7 дн` : `${daysToSubmission} дн`}
            </div>
          )
        ) : null}
      </div>

      <div style={{ padding: '12px 0', minWidth: 0 }}>
        {packageItems.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            {packageItems.map((item, index) => {
              const href = getPackageLinkHref(item.link);

              return href ? (
                <a
                  key={`${item.text}-${item.date || 'empty'}-${index}`}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  style={{
                    display: 'inline-flex',
                    alignSelf: 'flex-start',
                    padding: '3px 8px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    textDecoration: 'none',
                    wordBreak: 'break-word',
                    ...getTenderPackageBadgeStyle(item.text),
                  }}
                >
                  {item.text}
                </a>
              ) : (
                <div
                  key={`${item.text}-${item.date || 'empty'}-${index}`}
                  style={{
                    display: 'inline-flex',
                    alignSelf: 'flex-start',
                    padding: '3px 8px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    wordBreak: 'break-word',
                    ...getTenderPackageBadgeStyle(item.text),
                  }}
                >
                  {item.text}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ color: palette.muted, fontSize: 12 }}>—</div>
        )}
      </div>

      <div style={{ padding: '12px 0', textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-flex',
            padding: '3px 8px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            ...badgeStyle,
          }}
        >
          {getTenderStatusDisplayLabel(tender)}
        </div>
        {dashboardStatus === 'sent' && daysSinceControl != null ? (
          <div style={{ marginTop: 6 }}>
            <span style={{ color: palette.danger, fontSize: 12, marginRight: 6 }}>{daysSinceControl}д</span>
            {canQuickCall && !readOnly ? (
              <button
                type="button"
                className="tender-monitor-call-button"
                onClick={(event) => {
                  event.stopPropagation();
                  void onQuickCall(tender);
                }}
                style={{
                  border: `1px solid ${palette.dangerBorder}`,
                  background: palette.dangerBg,
                  color: palette.danger,
                  borderRadius: 6,
                  padding: '2px 7px',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                <PhoneOutlined style={{ marginRight: 6 }} />
                Позвонить
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        style={{ padding: '12px 0', textAlign: 'center' }}
        onClick={(event) => event.stopPropagation()}
      >
        <Space size={8}>
          <button
            type="button"
            disabled={!tender.site_visit_photo_url}
            onClick={(event) => {
              event.stopPropagation();
              if (tender.site_visit_photo_url) {
                window.open(tender.site_visit_photo_url, '_blank', 'noopener,noreferrer');
              }
            }}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              border: `1px solid ${tender.site_visit_photo_url ? `${palette.info}55` : palette.border}`,
              background: tender.site_visit_photo_url ? `${palette.info}1f` : palette.disabledBg,
              color: tender.site_visit_photo_url ? palette.info : palette.disabledText,
              cursor: tender.site_visit_photo_url ? 'pointer' : 'not-allowed',
            }}
            title="Посещение площадки"
          >
            <LinkOutlined />
          </button>
          <ChronologyPopover tender={tender} palette={palette} onOpenTimeline={onOpenTimeline} />
        </Space>
      </div>

      <div style={{ padding: '12px 0', color: palette.muted, textAlign: 'center', fontSize: 12 }}>
        {formatDate(tender.invitation_date)}
      </div>
    </div>
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
  onQuickCall,
  onUpdate,
  readOnly,
}) => {
  void onUpdate;

  const { theme } = useTheme();
  const { screens } = useIsMobile();
  const palette = getTenderMonitorPalette(theme === 'dark');

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

  return (
    <div>
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

      <div
        style={{
          border: `1px solid ${palette.border}`,
          borderRadius: 14,
          overflow: 'hidden',
          background: palette.cardBgAlt,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 12px',
            borderBottom: `1px solid ${palette.border}`,
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

        {loading ? (
          <div style={{ padding: 24 }}>
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        ) : sections.every((section) => section.items.length === 0) ? (
          <Empty description="Тендеры не найдены" style={{ padding: 48 }} />
        ) : !screens.lg ? (
          <TenderMonitorCards
            sections={sections}
            onOpenTender={onOpenTender}
            onOpenTimeline={onOpenTimeline}
            onQuickCall={onQuickCall}
            palette={palette}
            readOnly={readOnly}
          />
        ) : (
          sections.map((section) => (
            <div key={section.key}>
              <SectionHeader title={section.title} tenders={section.items} palette={palette} />
              {renderHeader(palette)}
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
