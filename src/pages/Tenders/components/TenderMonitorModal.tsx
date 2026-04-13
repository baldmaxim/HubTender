import React, { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Input, InputNumber, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { CloseOutlined, DeleteOutlined, EditOutlined, PhoneOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { supabase } from '../../../lib/supabase';
import type {
  ChronologyItem,
  ConstructionScope,
  TenderRegistryWithRelations,
  TenderStatus,
} from '../../../lib/supabase';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  formatArea,
  formatDate,
  formatMoneyFull,
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

const { Text } = Typography;
const { TextArea } = Input;

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
  options,
  buildUpdatePayload,
  onUpdated,
}: EditableMonitorFieldProps) {
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

      const { error } = await supabase
        .from('tender_registry')
        .update(updatePayload)
        .eq('id', tenderId);

      if (error) {
        message.error(error.message);
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
        format="DD.MM.YYYY"
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

        {!editing ? (
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

interface EditableChronologySectionProps {
  tenderId: string;
  items: ChronologyItem[];
  palette: TenderMonitorPalette;
  onUpdated: () => Promise<void> | void;
}

function EditableChronologySection({ tenderId, items, palette, onUpdated }: EditableChronologySectionProps) {
  const [draftItems, setDraftItems] = useState<ChronologyItem[]>(items);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraftItems(items);
  }, [items]);

  const updateItem = (index: number, patch: Partial<ChronologyItem>) => {
    setDraftItems((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  const removeItem = (index: number) => {
    setDraftItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const addItem = () => {
    setDraftItems((prev) => [...prev, { date: dayjs().toISOString(), text: '', type: 'default' }]);
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      const chronologyItems = draftItems
        .map((item) => ({
          date: item.date ? dayjs(item.date).toISOString() : null,
          text: item.text.trim(),
          type: item.type || 'default',
        }))
        .filter((item) => item.text);

      const { error } = await supabase
        .from('tender_registry')
        .update({ chronology_items: chronologyItems })
        .eq('id', tenderId);

      if (error) {
        message.error(error.message);
        return;
      }

      await onUpdated();
      message.success('Хронология обновлена');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {draftItems.length > 0 ? (
        draftItems.map((item, index) => (
          <div
            key={`${item.date || 'empty'}-${index}`}
            style={{
              padding: '10px 12px',
              background: palette.sectionBg,
              borderRadius: 10,
              border: `1px solid ${item.type === 'call_follow_up' ? palette.dangerBorder : palette.borderSoft}`,
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '115px 128px minmax(0, 1fr) 32px', gap: 8, alignItems: 'start' }}>
              <Select
                size="small"
                value={item.type || 'default'}
                onChange={(value) => updateItem(index, { type: value })}
                options={[
                  { value: 'default', label: 'Событие' },
                  { value: 'call_follow_up', label: 'Звонок' },
                ]}
              />
              <DatePicker
                size="small"
                value={item.date ? dayjs(item.date) : null}
                onChange={(value) => updateItem(index, { date: value ? value.toISOString() : null })}
                format="DD.MM.YYYY"
                style={{ width: '100%' }}
              />
              <TextArea
                value={item.text}
                onChange={(event) => updateItem(index, { text: event.target.value })}
                autoSize={{ minRows: 1, maxRows: 3 }}
              />
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeItem(index)}
              />
            </div>
          </div>
        ))
      ) : (
        <Text style={{ color: palette.muted, fontSize: 12 }}>Хронология пока не заполнена</Text>
      )}

      <Space wrap size={8}>
        <Button size="small" icon={<PlusOutlined />} onClick={addItem}>
          Добавить строку
        </Button>
        <Button type="primary" size="small" onClick={() => void handleSave()} loading={saving}>
          Сохранить хронологию
        </Button>
      </Space>
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
            {canQuickCall && onQuickCall ? (
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
                value={tender.status?.name === 'Направлено' ? '__sent__' : tender.status_id}
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
              <EditableMonitorField tenderId={tender.id} field="submission_date" label="Дата подачи КП" value={tender.submission_date} displayValue={formatDate(tender.submission_date)} type="date" palette={palette} onUpdated={onUpdate} />
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
          ) : null}

          {activeTab === 'timeline' ? (
            <EditableChronologySection tenderId={tender.id} items={chronologyItems} palette={palette} onUpdated={onUpdate} />
          ) : null}

          {activeTab === 'package' ? (
            <div>
              {packageItems.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {packageItems.map((item, index) => (
                    <div
                      key={`${item.date || 'empty'}-${item.text}-${index}`}
                      style={{
                        display: 'flex',
                        gap: 12,
                        alignItems: 'center',
                        padding: '9px 10px',
                        background: palette.sectionBg,
                        borderRadius: 8,
                        border: `1px solid ${palette.borderSoft}`,
                      }}
                    >
                      <div style={{ minWidth: 82, color: palette.successStrong, fontWeight: 700, fontSize: 11 }}>{formatDate(item.date)}</div>
                      <div style={{ color: palette.text, fontSize: 12, lineHeight: 1.35 }}>{item.text}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <Text style={{ color: palette.muted, fontSize: 12 }}>Тендерный пакет не заполнен</Text>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
};

export default TenderMonitorModal;
