import React, { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Input, InputNumber, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { CloseOutlined, EditOutlined, PhoneOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { patchTenderRegistryFields } from '../../../lib/api/tenderRegistry';
import type {
  ConstructionScope,
  TenderRegistryWithRelations,
  TenderStatus,
} from '../../../lib/supabase';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  DATE_INPUT_FORMATS,
  formatArea,
  formatDate,
  formatMoneyFull,
  formatTime,
  formatRubPerSquare,
  getChronologyItems,
  getDashboardStatus,
  getDashboardStatusByStatusName,
  getLastCallFollowUpDate,
  getPackageItems,
  getStatusBadgeStyle,
  getTenderStatusDisplayLabel,
  shouldShowCallAction,
} from '../utils/tenderMonitor';
import { getTenderMonitorPalette, type TenderMonitorPalette } from '../utils/tenderMonitorTheme';
import {
  EditableChronologySection,
  EditablePackageSection,
  ReadOnlyChronologySection,
  ReadOnlyPackageSection,
} from './TenderMonitorTabs';

const { Text } = Typography;
const { TextArea } = Input;

// Режим «только просмотр» полей карточки (Генеральный директор) —
// прокидывается через контекст, чтобы не передавать проп в каждое поле.
const FieldReadOnlyContext = React.createContext(false);

type ModalTab = 'info' | 'timeline' | 'package';
type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select';

interface EditableMonitorFieldProps {
  tenderId: string;
  field: string;
  label: string;
  value: string | number | null | undefined;
  displayValue: React.ReactNode;
  palette: TenderMonitorPalette;
  type?: FieldType;
  withTime?: boolean;
  options?: Array<{ value: string; label: string }>;
  buildUpdatePayload?: (draft: string | number | null) => Record<string, unknown>;
  onUpdated: () => Promise<void> | void;
}

function EditableMonitorField({
  tenderId,
  field,
  label,
  value,
  displayValue,
  palette,
  type = 'text',
  withTime = false,
  options,
  buildUpdatePayload,
  onUpdated,
}: EditableMonitorFieldProps) {
  const readOnly = React.useContext(FieldReadOnlyContext);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<string | number | null>(value ?? null);

  useEffect(() => {
    setDraft(value ?? null);
    setEditing(false);
  }, [value]);

  const handleSave = async () => {
    setSaving(true);

    try {
      let payload: string | number | null = draft;

      if (type === 'text' || type === 'textarea') {
        payload = typeof draft === 'string' ? draft.trim() || null : null;
      }

      if (type === 'number') {
        payload = draft == null || draft === '' ? null : Number(draft);
        if (payload != null && Number.isNaN(payload)) {
          payload = null;
        }
      }

      if (type === 'date') {
        payload = typeof draft === 'string' && draft ? dayjs(draft).toISOString() : null;
      }

      if (type === 'select') {
        payload = typeof draft === 'string' && draft ? draft : null;
      }

      const updatePayload = buildUpdatePayload ? buildUpdatePayload(payload) : { [field]: payload };

      try {
        await patchTenderRegistryFields(tenderId, updatePayload);
      } catch (err) {
        message.error((err as Error).message);
        return;
      }

      await onUpdated();
      setEditing(false);
      message.success('Поле обновлено');
    } finally {
      setSaving(false);
    }
  };

  let editor: React.ReactNode;

  if (type === 'textarea') {
    editor = (
      <TextArea
        value={typeof draft === 'string' ? draft : ''}
        onChange={(event) => setDraft(event.target.value)}
        autoSize={{ minRows: 2, maxRows: 4 }}
      />
    );
  } else if (type === 'number') {
    editor = (
      <InputNumber
        value={typeof draft === 'number' ? draft : draft != null ? Number(draft) : null}
        onChange={(next) => setDraft(next)}
        style={{ width: '100%' }}
        controls={false}
      />
    );
  } else if (type === 'date') {
    editor = (
      <DatePicker
        value={typeof draft === 'string' && draft ? dayjs(draft) : null}
        onChange={(next) => setDraft(next ? next.toISOString() : null)}
        style={{ width: '100%' }}
        format={withTime ? 'DD.MM.YYYY HH:mm' : DATE_INPUT_FORMATS}
        showTime={withTime ? { format: 'HH:mm' } : undefined}
        size="small"
      />
    );
  } else if (type === 'select') {
    editor = (
      <Select
        value={typeof draft === 'string' && draft ? draft : undefined}
        onChange={(next) => setDraft(next)}
        style={{ width: '100%' }}
        allowClear
        options={options}
        size="small"
      />
    );
  } else {
    editor = (
      <Input
        value={typeof draft === 'string' ? draft : draft == null ? '' : String(draft)}
        onChange={(event) => setDraft(event.target.value)}
        size="small"
      />
    );
  }

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 10,
        background: palette.sectionBg,
        border: `1px solid ${palette.borderSoft}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: palette.muted,
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            {label}
          </div>

          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {editor}
              <Space size={6}>
                <Button type="primary" size="small" onClick={() => void handleSave()} loading={saving}>
                  Сохранить
                </Button>
                <Button size="small" onClick={() => setEditing(false)} disabled={saving}>
                  Отмена
                </Button>
              </Space>
            </div>
          ) : (
            <div
              style={{
                color: palette.text,
                fontSize: 12,
                lineHeight: 1.35,
                fontWeight: 600,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {displayValue || '—'}
            </div>
          )}
        </div>

        {!editing && !readOnly ? (
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => setEditing(true)}
            style={{ color: palette.warning, flexShrink: 0 }}
          />
        ) : null}
      </div>
    </div>
  );
}

function InfoCard({ label, value, palette }: { label: string; value: React.ReactNode; palette: TenderMonitorPalette }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 10,
        background: palette.sectionBg,
        border: `1px solid ${palette.borderSoft}`,
      }}
    >
      <div style={{ color: palette.muted, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ color: palette.text, fontSize: 12, lineHeight: 1.35, fontWeight: 600 }}>{value || '—'}</div>
    </div>
  );
}

interface TenderMonitorModalProps {
  open: boolean;
  tender: TenderRegistryWithRelations | null;
  initialTab?: ModalTab;
  statuses: TenderStatus[];
  constructionScopes: ConstructionScope[];
  onClose: () => void;
  onQuickCall?: (tender: TenderRegistryWithRelations) => Promise<void> | void;
  onUpdate: () => Promise<void> | void;
  /** Режим «только просмотр» — скрывает ярлыки редактирования и кнопку звонка (Генеральный директор) */
  readOnly?: boolean;
}

export const TenderMonitorModal: React.FC<TenderMonitorModalProps> = ({
  open,
  tender,
  initialTab = 'info',
  statuses,
  constructionScopes,
  onClose,
  onQuickCall,
  onUpdate,
  readOnly,
}) => {
  const { theme } = useTheme();
  const palette = getTenderMonitorPalette(theme === 'dark');
  const [activeTab, setActiveTab] = useState<ModalTab>(initialTab);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [initialTab, open, tender?.id]);

  const chronologyItems = useMemo(() => (tender ? getChronologyItems(tender) : []), [tender]);
  const packageItems = useMemo(() => (tender ? getPackageItems(tender) : []), [tender]);

  if (!tender) {
    return null;
  }

  const dashboardStatus = getDashboardStatus(tender);
  const statusStyle = getStatusBadgeStyle(dashboardStatus);
  const canQuickCall = shouldShowCallAction(tender);
  const lastCallDate = getLastCallFollowUpDate(tender);

  const constructionScopeOptions = constructionScopes.map((scope) => ({
    value: scope.id,
    label: scope.name,
  }));

  const statusOptions = statuses.map((status) => ({
    value: status.id,
    label: status.name,
  }));

  const statusOptionsWithSent = [
    { value: '__sent__', label: 'Направлено' },
    ...statusOptions,
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closeIcon={null}
      width={860}
      centered
      styles={{
        content: {
          background: palette.cardBg,
          border: `1px solid ${palette.warningBorder}`,
          borderRadius: 14,
          padding: 0,
          overflow: 'hidden',
        },
        body: {
          padding: 0,
        },
        mask: {
          backdropFilter: 'blur(4px)',
        },
      }}
    >
      <div style={{ padding: '18px 18px 14px', borderRight: `3px solid ${palette.warning}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div
                style={{
                  color: palette.title,
                  fontSize: 18,
                  lineHeight: 1.2,
                  fontWeight: 700,
                  letterSpacing: '0.01em',
                }}
              >
                {tender.title}
              </div>
              <Tag style={{ margin: 0, paddingInline: 8, fontSize: 11, lineHeight: '18px', ...statusStyle }}>
                {getTenderStatusDisplayLabel(tender)}
              </Tag>
            </div>
            <Text style={{ color: palette.muted, display: 'block', marginTop: 6, fontSize: 11 }}>
              {(tender.construction_scope?.name || 'Объект') + ' · ' + (tender.client_name || 'Клиент не указан')}
            </Text>
          </div>

          <Space size={6}>
            {canQuickCall && onQuickCall && !readOnly ? (
              <Button type="primary" danger icon={<PhoneOutlined />} size="small" onClick={() => void onQuickCall(tender)}>
                Позвонить
              </Button>
            ) : null}
            <Button type="text" icon={<CloseOutlined />} size="small" onClick={onClose} style={{ color: palette.muted }} />
          </Space>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, borderBottom: `1px solid ${palette.border}`, flexWrap: 'wrap' }}>
          {[
            { key: 'info' as const, label: 'Информация' },
            { key: 'timeline' as const, label: `Хронология (${chronologyItems.length})` },
            { key: 'package' as const, label: `Тендерный пакет (${packageItems.length})` },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{
                border: 'none',
                borderBottom: activeTab === tab.key ? `2px solid ${palette.warning}` : '2px solid transparent',
                background: 'transparent',
                color: activeTab === tab.key ? palette.warning : palette.muted,
                padding: '0 0 8px',
                marginRight: 14,
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ paddingTop: 14 }}>
          {activeTab === 'info' ? (
            <FieldReadOnlyContext.Provider value={!!readOnly}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '10px 12px',
              }}
            >
              <EditableMonitorField tenderId={tender.id} field="title" label="Наименование" value={tender.title} displayValue={tender.title} palette={palette} onUpdated={onUpdate} />
              <EditableMonitorField tenderId={tender.id} field="client_name" label="Заказчик" value={tender.client_name} displayValue={tender.client_name || '—'} palette={palette} onUpdated={onUpdate} />
              <EditableMonitorField tenderId={tender.id} field="construction_scope_id" label="Объем строительства" value={tender.construction_scope_id} displayValue={tender.construction_scope?.name || '—'} type="select" options={constructionScopeOptions} palette={palette} onUpdated={onUpdate} />
              <EditableMonitorField
                tenderId={tender.id}
                field="status_id"
                label="Статус"
                value={dashboardStatus === 'sent' ? '__sent__' : tender.status_id}
                displayValue={tender.status?.name || (dashboardStatus === 'sent' ? 'Направлено' : '—')}
                type="select"
                options={statusOptionsWithSent}
                palette={palette}
                buildUpdatePayload={(draft) => {
                  if (draft === '__sent__') {
                    return {
                      status_id: null,
                      dashboard_status: 'sent',
                      is_archived: false,
                    };
                  }

                  const selectedStatus = statuses.find((status) => status.id === draft);
                  const mappedDashboardStatus = getDashboardStatusByStatusName(selectedStatus?.name);

                  return {
                    status_id: draft,
                    dashboard_status: mappedDashboardStatus || tender.dashboard_status || 'calc',
                    is_archived: mappedDashboardStatus === 'archive',
                  };
                }}
                onUpdated={onUpdate}
              />
              <EditableMonitorField tenderId={tender.id} field="tender_number" label="Номер тендера" value={tender.tender_number} displayValue={tender.tender_number || '—'} palette={palette} onUpdated={onUpdate} />
              <EditableMonitorField tenderId={tender.id} field="area" label="Площадь по СП" value={tender.area} displayValue={formatArea(tender.area)} type="number" palette={palette} onUpdated={onUpdate} />
              <InfoCard label="Цена ₽/м²" value={formatRubPerSquare(tender.total_cost || tender.manual_total_cost, tender.area)} palette={palette} />
              <EditableMonitorField tenderId={tender.id} field="manual_total_cost" label="Стоимость КП" value={tender.manual_total_cost} displayValue={formatMoneyFull(tender.manual_total_cost ?? tender.total_cost)} type="number" palette={palette} onUpdated={onUpdate} />
              <InfoCard label="Направлено КП" value={lastCallDate ? `${formatDate(tender.submission_date)} · контроль ${formatDate(lastCallDate)}` : formatDate(tender.submission_date)} palette={palette} />
              <EditableMonitorField tenderId={tender.id} field="submission_date" label="Дата подачи КП" value={tender.submission_date} displayValue={`${formatDate(tender.submission_date)}${formatTime(tender.submission_date) ? ' ' + formatTime(tender.submission_date) : ''}`} type="date" withTime palette={palette} onUpdated={onUpdate} />
              <EditableMonitorField tenderId={tender.id} field="commission_date" label="Ввод в эксплуатацию" value={tender.commission_date} displayValue={formatDate(tender.commission_date)} type="date" palette={palette} onUpdated={onUpdate} />
              <EditableMonitorField tenderId={tender.id} field="construction_start_date" label="Выход на площадку" value={tender.construction_start_date} displayValue={formatDate(tender.construction_start_date)} type="date" palette={palette} onUpdated={onUpdate} />
              <EditableMonitorField tenderId={tender.id} field="invitation_date" label="Поступило приглашение" value={tender.invitation_date} displayValue={formatDate(tender.invitation_date)} type="date" palette={palette} onUpdated={onUpdate} />
              <EditableMonitorField tenderId={tender.id} field="object_address" label="Адрес объекта" value={tender.object_address} displayValue={tender.object_address || '—'} type="textarea" palette={palette} onUpdated={onUpdate} />
              <EditableMonitorField tenderId={tender.id} field="object_coordinates" label="Координаты" value={tender.object_coordinates} displayValue={tender.object_coordinates || '—'} palette={palette} onUpdated={onUpdate} />
              <EditableMonitorField
                tenderId={tender.id}
                field="site_visit_photo_url"
                label="Ссылка на посещение площадки"
                value={tender.site_visit_photo_url}
                displayValue={
                  tender.site_visit_photo_url ? (
                    <a href={tender.site_visit_photo_url} target="_blank" rel="noreferrer" style={{ color: palette.info, fontSize: 12 }}>
                      {tender.site_visit_photo_url}
                    </a>
                  ) : (
                    '—'
                  )
                }
                palette={palette}
                onUpdated={onUpdate}
              />
            </div>
            </FieldReadOnlyContext.Provider>
          ) : null}

          {activeTab === 'timeline' ? (
            readOnly ? (
              <ReadOnlyChronologySection items={chronologyItems} palette={palette} />
            ) : (
              <EditableChronologySection tenderId={tender.id} items={chronologyItems} palette={palette} onUpdated={onUpdate} />
            )
          ) : null}

          {activeTab === 'package' ? (
            readOnly ? (
              <ReadOnlyPackageSection items={packageItems} palette={palette} />
            ) : (
              <EditablePackageSection tenderId={tender.id} items={packageItems} palette={palette} onUpdated={onUpdate} />
            )
          ) : null}
        </div>
      </div>
    </Modal>
  );
};

export default TenderMonitorModal;
