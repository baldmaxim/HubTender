import React from 'react';
import { Button, Empty, Input, Popover, Skeleton, Space, Tag } from 'antd';
import {
  EnvironmentFilled,
  FileTextOutlined,
  LinkOutlined,
  PhoneOutlined,
} from '@ant-design/icons';
import type { TenderRegistryWithRelations } from '../../../lib/supabase';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  formatArea,
  formatDate,
  formatDateTime,
  formatMoney,
  formatRubPerSquare,
  getChronologyItems,
  getControlDate,
  getDashboardStatus,
  getDaysSinceControl,
  getDaysToSubmission,
  getPackageSummary,
  getStatusBadgeStyle,
  getTenderStatusDisplayLabel,
  type TenderMonitorSortDirection,
  type TenderMonitorSortField,
  type TenderMonitorTab,
} from '../utils/tenderMonitor';
import { getTenderMonitorPalette, type TenderMonitorPalette } from '../utils/tenderMonitorTheme';

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
  onAddTender?: () => void;
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
  { key: 'package', label: 'Тендерный пакет', template: '180px', align: 'center' },
  { key: 'status', label: 'Статус / время', template: '132px', align: 'center' },
  { key: 'timeline', label: 'Хронология', template: '84px', align: 'center' },
  { key: 'invite', label: 'Приглашение', template: '82px', align: 'center' },
];

const GRID_TEMPLATE = GRID_COLUMNS.map((column) => column.template).join(' ');

function parseCoordinates(value?: string | null): { lat: number; lon: number } | null {
  if (!value) {
    return null;
  }

  const parts = value.match(/-?\d+(?:[.,]\d+)?/g) || [];

  if (parts.length < 2) {
    return null;
  }

  const lat = Number(parts[0].replace(',', '.'));
  const lon = Number(parts[1].replace(',', '.'));

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return null;
  }

  return { lat, lon };
}

function getMapWidgetUrl(tender: TenderRegistryWithRelations): string | null {
  const coords = parseCoordinates(tender.object_coordinates);

  if (coords) {
    return `https://yandex.ru/map-widget/v1/?ll=${coords.lon},${coords.lat}&pt=${coords.lon},${coords.lat},pm2rdm&z=16`;
  }

  if (tender.object_address) {
    return `https://yandex.ru/map-widget/v1/?text=${encodeURIComponent(tender.object_address)}`;
  }

  return null;
}

function getMapPageUrl(tender: TenderRegistryWithRelations): string | null {
  const coords = parseCoordinates(tender.object_coordinates);

  if (coords) {
    return `https://yandex.ru/maps/?ll=${coords.lon},${coords.lat}&pt=${coords.lon},${coords.lat},pm2rdm&z=16`;
  }

  if (tender.object_address) {
    return `https://yandex.ru/maps/?text=${encodeURIComponent(tender.object_address)}`;
  }

  return null;
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

function MapPopover({ tender, palette }: { tender: TenderRegistryWithRelations; palette: TenderMonitorPalette }) {
  const widgetUrl = getMapWidgetUrl(tender);
  const mapPageUrl = getMapPageUrl(tender);

  if (!widgetUrl) {
    return null;
  }

  return (
    <Popover
      trigger="hover"
      placement="bottomLeft"
      mouseEnterDelay={0.15}
      destroyTooltipOnHide
      content={
        <div style={{ width: 300 }}>
          <iframe
            title={`map-${tender.id}`}
            src={widgetUrl}
            style={{ width: '100%', height: 220, border: 'none', borderRadius: 10 }}
            loading="lazy"
          />
          <div style={{ marginTop: 8, color: palette.textSecondary, fontSize: 12, lineHeight: 1.35 }}>
            {tender.object_address || 'Адрес не указан'}
          </div>
          {tender.object_coordinates ? (
            <div style={{ marginTop: 4, color: palette.muted, fontSize: 11 }}>{tender.object_coordinates}</div>
          ) : null}
          {mapPageUrl ? (
            <a
              href={mapPageUrl}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'inline-block', marginTop: 8, color: palette.info, fontSize: 11 }}
            >
              Открыть в Яндекс Картах
            </a>
          ) : null}
        </div>
      }
      overlayInnerStyle={{
        background: palette.panelBg,
        border: `1px solid ${palette.border}`,
        borderRadius: 12,
      }}
    >
      <button
        type="button"
        onClick={(event) => event.stopPropagation()}
        style={{
          border: 'none',
          background: 'transparent',
          color: palette.marker,
          padding: 0,
          display: 'inline-flex',
          alignItems: 'center',
          cursor: 'pointer',
        }}
        title="Показать объект на карте"
      >
        <EnvironmentFilled style={{ fontSize: 14 }} />
      </button>
    </Popover>
  );
}

function ChronologyPopover({ tender, palette }: { tender: TenderRegistryWithRelations; palette: TenderMonitorPalette }) {
  const chronologyItems = getChronologyItems(tender);

  return (
    <Popover
      trigger="hover"
      placement="leftTop"
      mouseEnterDelay={0.15}
      destroyTooltipOnHide
      content={
        chronologyItems.length > 0 ? (
          <div style={{ width: 320, maxHeight: 300, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {chronologyItems.map((item, index) => (
              <div
                key={`${item.date || 'empty'}-${item.text}-${index}`}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  background: palette.fieldBg,
                  border: `1px solid ${item.type === 'call_follow_up' ? palette.dangerBorder : palette.borderSoft}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ color: palette.warning, fontSize: 11, fontWeight: 700 }}>{formatDateTime(item.date)}</span>
                  {item.type === 'call_follow_up' ? <Tag color="error" style={{ marginInlineEnd: 0 }}>Звонок</Tag> : null}
                </div>
                <div style={{ color: palette.textSecondary, fontSize: 12, lineHeight: 1.35 }}>{item.text}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ width: 220, color: palette.muted, fontSize: 13 }}>Хронология пока не заполнена</div>
        )
      }
      overlayInnerStyle={{
        background: palette.panelBg,
        border: `1px solid ${palette.border}`,
        borderRadius: 12,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 7px',
          borderRadius: 8,
          background: chronologyItems.length > 0 ? palette.warningBg : palette.disabledBg,
          border: `1px solid ${chronologyItems.length > 0 ? palette.warningBorder : palette.border}`,
          color: chronologyItems.length > 0 ? palette.warning : palette.muted,
          fontSize: 11,
          cursor: 'default',
        }}
        title="Показать хронологию"
      >
        <FileTextOutlined />
        <span>{chronologyItems.length}</span>
      </div>
    </Popover>
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
  onQuickCall,
  palette,
}: {
  tender: TenderRegistryWithRelations;
  onOpenTender: (tender: TenderRegistryWithRelations) => void;
  onQuickCall: (tender: TenderRegistryWithRelations) => Promise<void> | void;
  palette: TenderMonitorPalette;
}) {
  const dashboardStatus = getDashboardStatus(tender);
  const badgeStyle = getStatusBadgeStyle(dashboardStatus);
  const packageSummary = getPackageSummary(tender);
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
          canSubmissionCall ? (
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

      <div style={{ padding: '12px 0', textAlign: 'center' }}>
        <div style={{ width: 72, height: 5, background: palette.sectionBg, borderRadius: 999, overflow: 'hidden', marginBottom: 6 }}>
          <div style={{ width: `${packageSummary.percent}%`, height: '100%', background: palette.success }} />
        </div>
        <div style={{ color: palette.muted, fontSize: 11 }}>
          {packageSummary.standardCount}/{5}
          {packageSummary.extraCount > 0 ? ` +${packageSummary.extraCount}` : ''}
        </div>
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
            {canQuickCall ? (
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

      <div style={{ padding: '12px 0', textAlign: 'center' }}>
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
          <ChronologyPopover tender={tender} palette={palette} />
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
  onAddTender,
}) => {
  void onOpenTimeline;

  const { theme } = useTheme();
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

          {onAddTender ? (
            <Button type="primary" onClick={onAddTender} size="small">
              Добавить тендер
            </Button>
          ) : null}
        </div>

        {loading ? (
          <div style={{ padding: 24 }}>
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        ) : sections.every((section) => section.items.length === 0) ? (
          <Empty description="Тендеры не найдены" style={{ padding: 48 }} />
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
                    onQuickCall={onQuickCall}
                    palette={palette}
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
