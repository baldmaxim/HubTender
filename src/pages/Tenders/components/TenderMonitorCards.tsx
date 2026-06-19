import React from 'react';
import { Col, Row, Space } from 'antd';
import { LinkOutlined, PhoneOutlined } from '@ant-design/icons';
import { useIsMobile } from '../../../hooks/useIsMobile';
import type { TenderRegistryWithRelations } from '../../../lib/supabase';
import {
  formatArea,
  formatDate,
  formatMoney,
  formatRubPerSquare,
  formatTime,
  getControlDate,
  getDashboardStatus,
  getDaysSinceControl,
  getDaysToSubmission,
  getStatusBadgeStyle,
  getTenderStatusDisplayLabel,
} from '../utils/tenderMonitor';
import type { TenderMonitorPalette } from '../utils/tenderMonitorTheme';
import { MapPopover, ChronologyPopover, PackagePopover } from './TenderMonitorPopovers';

interface TenderSection {
  key: string;
  title: string;
  items: TenderRegistryWithRelations[];
}

// Палитра рамок карточек — циклично по позиции, как на «Текущие объекты» (ProjectCards).
const CARD_BORDER_COLORS = [
  '#1890ff', '#52c41a', '#faad14', '#722ed1',
  '#eb2f96', '#13c2c2', '#fa541c', '#2f54eb',
];

interface TenderMonitorCardsProps {
  sections: TenderSection[];
  onOpenTender: (tender: TenderRegistryWithRelations) => void;
  onOpenTimeline: (tender: TenderRegistryWithRelations) => void;
  onOpenPackage: (tender: TenderRegistryWithRelations) => void;
  onQuickCall: (tender: TenderRegistryWithRelations) => Promise<void> | void;
  palette: TenderMonitorPalette;
  readOnly?: boolean;
}

function CallButton({
  tender,
  palette,
  onQuickCall,
}: {
  tender: TenderRegistryWithRelations;
  palette: TenderMonitorPalette;
  onQuickCall: (tender: TenderRegistryWithRelations) => Promise<void> | void;
}) {
  return (
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
  );
}

function Field({
  label,
  value,
  palette,
  align = 'left',
  isPhone = false,
}: {
  label: string;
  value: React.ReactNode;
  palette: TenderMonitorPalette;
  align?: 'left' | 'right';
  isPhone?: boolean;
}) {
  return (
    <div style={{ minWidth: 0, textAlign: align }}>
      <div style={{ color: palette.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ color: palette.text, fontSize: isPhone ? 12 : 13, fontWeight: 600, marginTop: 2, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

function TenderCard({
  tender,
  onOpenTender,
  onOpenTimeline,
  onOpenPackage,
  onQuickCall,
  palette,
  readOnly,
  isPhone = false,
  borderColor,
}: {
  tender: TenderRegistryWithRelations;
  onOpenTender: (tender: TenderRegistryWithRelations) => void;
  onOpenTimeline: (tender: TenderRegistryWithRelations) => void;
  onOpenPackage: (tender: TenderRegistryWithRelations) => void;
  onQuickCall: (tender: TenderRegistryWithRelations) => Promise<void> | void;
  palette: TenderMonitorPalette;
  readOnly?: boolean;
  isPhone?: boolean;
  borderColor: string;
}) {
  const dashboardStatus = getDashboardStatus(tender);
  const badgeStyle = getStatusBadgeStyle(dashboardStatus);
  const daysToSubmission = getDaysToSubmission(tender);
  const daysSinceControl = getDaysSinceControl(tender);
  const controlDate = getControlDate(tender);
  const canQuickCall = dashboardStatus === 'sent' && (daysSinceControl ?? 0) > 7;
  const canSubmissionCall = dashboardStatus === 'calc' && controlDate != null && (daysSinceControl ?? 0) >= 7;

  return (
    <div
      onClick={() => onOpenTender(tender)}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: isPhone ? 8 : 10,
        padding: isPhone ? 8 : 12,
        borderRadius: 12,
        border: `1px solid ${palette.border}`,
        borderTop: `4px solid ${borderColor}`,
        background: palette.cardBgAlt,
        cursor: 'pointer',
      }}
    >
      {/* Заголовок */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
        {!isPhone && (
          <span style={{ color: palette.subtleText, fontSize: 11, fontWeight: 700, marginTop: 2 }}>{tender.sort_order}</span>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
            <span style={{ color: palette.text, fontSize: isPhone ? 13 : 15, fontWeight: 700, lineHeight: 1.25, wordBreak: 'break-word' }}>
              {tender.title}
            </span>
            {isPhone && (
              <span style={{ color: palette.muted, fontSize: 12, wordBreak: 'break-word' }}>{tender.client_name || '—'}</span>
            )}
            <MapPopover tender={tender} palette={palette} />
          </div>
          {!isPhone && tender.tender_number ? <div style={{ color: palette.muted, fontSize: 11, marginTop: 2 }}>{tender.tender_number}</div> : null}
          {!isPhone && <div style={{ color: palette.muted, fontSize: 12, marginTop: 2 }}>{tender.client_name || '—'}</div>}
        </div>
        <div
          style={{
            display: 'inline-flex',
            padding: '3px 8px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            flexShrink: 0,
            ...badgeStyle,
          }}
        >
          {getTenderStatusDisplayLabel(tender)}
        </div>
      </div>

      {/* Показатели */}
      <Row gutter={[8, 8]}>
        <Col span={8}><Field label="Площадь" value={formatArea(tender.area)} palette={palette} isPhone={isPhone} /></Col>
        <Col span={8}><Field label="Стоимость КП" value={formatMoney(tender.total_cost || tender.manual_total_cost)} palette={palette} isPhone={isPhone} /></Col>
        <Col span={8}><Field label="₽/м²" value={formatRubPerSquare(tender.total_cost || tender.manual_total_cost, tender.area)} palette={palette} isPhone={isPhone} /></Col>
        {!isPhone && (
          <>
            <Col span={8}><Field label="Дата подачи" value={`${formatDate(tender.submission_date)}${formatTime(tender.submission_date) ? ' ' + formatTime(tender.submission_date) : ''}`} palette={palette} isPhone={isPhone} /></Col>
            <Col span={8}><Field label="Приглашение" value={formatDate(tender.invitation_date)} palette={palette} isPhone={isPhone} /></Col>
            <Col span={8}>
              <Field
                label="Контроль"
                palette={palette}
                isPhone={isPhone}
                value={
                  dashboardStatus === 'sent' && daysSinceControl != null ? (
                    <span style={{ color: palette.danger }}>{daysSinceControl}д</span>
                  ) : dashboardStatus === 'calc' && daysToSubmission != null ? (
                    <span style={{ color: daysToSubmission < 0 && controlDate ? palette.success : '#ff9f43' }}>
                      {daysToSubmission < 0 && controlDate ? `${daysSinceControl ?? 0}/7 дн` : `${daysToSubmission} дн`}
                    </span>
                  ) : (
                    '—'
                  )
                }
              />
            </Col>
          </>
        )}
      </Row>

      {/* Действия */}
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'auto' }}
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
              width: 28,
              height: 28,
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
          <PackagePopover tender={tender} palette={palette} onOpenPackage={onOpenPackage} />
        </Space>
        {!readOnly && (canQuickCall || canSubmissionCall) ? (
          <CallButton tender={tender} palette={palette} onQuickCall={onQuickCall} />
        ) : null}
      </div>
    </div>
  );
}

export const TenderMonitorCards: React.FC<TenderMonitorCardsProps> = ({
  sections,
  onOpenTender,
  onOpenTimeline,
  onOpenPackage,
  onQuickCall,
  palette,
  readOnly,
}) => {
  const { isPhone } = useIsMobile();
  let runningIndex = 0;
  return (
    <div style={{ padding: isPhone ? '4px 0' : 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {sections.map((section) => {
        const totalArea = section.items.reduce((sum, tender) => sum + (tender.area || 0), 0);
        const totalCost = section.items.reduce(
          (sum, tender) => sum + (tender.total_cost || tender.manual_total_cost || 0),
          0
        );
        const baseIndex = runningIndex;
        runningIndex += section.items.length;

        return (
          <div key={section.key} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ color: palette.text, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{section.title}</div>
              <div style={{ color: palette.textSecondary, fontSize: 14, fontWeight: 600 }}>
                {section.items.length} · {formatArea(totalArea)} · {formatMoney(totalCost)}
              </div>
            </div>

            {section.items.length > 0 ? (
              <Row gutter={isPhone ? [8, 8] : [12, 12]}>
                {section.items.map((tender, index) => (
                  <Col xs={24} sm={24} key={tender.id}>
                    <TenderCard
                      tender={tender}
                      onOpenTender={onOpenTender}
                      onOpenTimeline={onOpenTimeline}
                      onOpenPackage={onOpenPackage}
                      onQuickCall={onQuickCall}
                      palette={palette}
                      readOnly={readOnly}
                      isPhone={isPhone}
                      borderColor={CARD_BORDER_COLORS[(baseIndex + index) % CARD_BORDER_COLORS.length]}
                    />
                  </Col>
                ))}
              </Row>
            ) : (
              <div style={{ padding: 24, color: palette.muted, textAlign: 'center' }}>Нет тендеров</div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TenderMonitorCards;
