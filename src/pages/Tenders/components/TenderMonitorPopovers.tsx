import { useState } from 'react';
import { Popover, Tag, Modal } from 'antd';
import { EnvironmentFilled, FileTextOutlined } from '@ant-design/icons';
import { useIsMobile } from '../../../hooks/useIsMobile';
import type { TenderRegistryWithRelations } from '../../../lib/supabase';
import { formatDate, getChronologyItems } from '../utils/tenderMonitor';
import type { TenderMonitorPalette } from '../utils/tenderMonitorTheme';

function parseCoordinates(value?: string | null): { lat: number; lon: number } | null {
  if (!value) {
    return null;
  }

  const parts = value.match(/-?\d+(?:[.,]\d+)?/g) || [];

  if (parts.length < 2) {
    return null;
  }

  const lat = Number(parts[0]!.replace(',', '.'));
  const lon = Number(parts[1]!.replace(',', '.'));

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

export function MapPopover({ tender, palette }: { tender: TenderRegistryWithRelations; palette: TenderMonitorPalette }) {
  const widgetUrl = getMapWidgetUrl(tender);
  const mapPageUrl = getMapPageUrl(tender);
  const { isPhone } = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!widgetUrl) {
    return null;
  }

  const mapContent = (
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
  );

  const buttonElement = (
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
  );

  if (isPhone) {
    return (
      <>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setMobileOpen(true);
          }}
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
        <Modal
          open={mobileOpen}
          onCancel={(e) => {
            e.stopPropagation();
            setMobileOpen(false);
          }}
          footer={null}
          centered
          width={320}
          styles={{ body: { padding: 0 } }}
          maskStyle={{ background: 'rgba(0, 0, 0, 0.45)' }}
        >
          <div style={{ padding: 16 }}>{mapContent}</div>
        </Modal>
      </>
    );
  }

  return (
    <Popover
      trigger="hover"
      placement="bottomLeft"
      mouseEnterDelay={0.15}
      destroyTooltipOnHide
      content={mapContent}
      overlayInnerStyle={{
        background: palette.panelBg,
        border: `1px solid ${palette.border}`,
        borderRadius: 12,
      }}
    >
      {buttonElement}
    </Popover>
  );
}

export function ChronologyPopover({
  tender,
  palette,
  onOpenTimeline,
}: {
  tender: TenderRegistryWithRelations;
  palette: TenderMonitorPalette;
  onOpenTimeline: (tender: TenderRegistryWithRelations) => void;
}) {
  const chronologyItems = getChronologyItems(tender);
  const [open, setOpen] = useState(false);

  return (
    <Popover
      trigger="hover"
      placement="leftTop"
      mouseEnterDelay={0.15}
      open={open}
      onOpenChange={(next) => setOpen(next)}
      content={
        <div style={{ width: 340, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {chronologyItems.length > 0 ? (
            <div style={{ maxHeight: 260, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                    <span style={{ color: palette.warning, fontSize: 11, fontWeight: 700 }}>{formatDate(item.date)}</span>
                    {item.type === 'call_follow_up' ? <Tag color="error" style={{ marginInlineEnd: 0 }}>Звонок</Tag> : null}
                  </div>
                  <div style={{ color: palette.textSecondary, fontSize: 12, lineHeight: 1.35 }}>{item.text}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: palette.muted, fontSize: 13 }}>Хронология пока не заполнена</div>
          )}
        </div>
      }
      overlayInnerStyle={{
        background: palette.panelBg,
        border: `1px solid ${palette.border}`,
        borderRadius: 12,
      }}
    >
      <div
        onClick={(event) => {
          event.stopPropagation();
          setOpen(false);
          onOpenTimeline(tender);
        }}
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
          cursor: 'pointer',
        }}
        title="Клик — редактировать хронологию"
      >
        <FileTextOutlined />
        <span>{chronologyItems.length}</span>
      </div>
    </Popover>
  );
}
