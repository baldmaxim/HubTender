import type { CSSProperties, FC, ReactNode } from 'react';
import { DatePicker, Input, InputNumber, Select, Typography } from 'antd';
import dayjs from 'dayjs';
import type { TenderRegistryWithRelations } from '../../../lib/types';
import { inputEnterToSave, textareaEnterToSave } from '../../../utils/keyboardSave';
import {
  DATE_INPUT_FORMATS,
  formatArea,
  formatDate,
  formatMoneyFull,
  formatRubPerSquare,
  formatTime,
  getDashboardStatus,
  getLastCallFollowUpDate,
} from '../utils/tenderMonitor';
import type { ITenderInfoDraft } from '../utils/tenderMonitorDraft';
import type { TenderMonitorPalette } from '../utils/tenderMonitorTheme';

const { Text } = Typography;
const { TextArea } = Input;

export type InfoFieldSetter = <K extends keyof ITenderInfoDraft>(key: K, value: ITenderInfoDraft[K]) => void;

interface IOption {
  value: string;
  label: string;
}

interface IInfoField {
  key: string;
  label: string;
  content: ReactNode;
  /** Только десктоп и планшет: на телефоне это уже в шапке окна. */
  desktopOnly?: boolean;
}

interface ITenderMonitorInfoProps {
  tender: TenderRegistryWithRelations;
  palette: TenderMonitorPalette;
  isPhone: boolean;
  /** Черновик режима редактирования; null — просмотр. */
  draft: ITenderInfoDraft | null;
  scopeOptions: IOption[];
  statusOptions: IOption[];
  onChange: InfoFieldSetter;
  onSubmit: () => void;
}

type TextKey = 'title' | 'client_name' | 'tender_number' | 'object_coordinates' | 'site_visit_photo_url';
type DateKey = 'submission_date' | 'commission_date' | 'construction_start_date' | 'invitation_date';
type NumberKey = 'area' | 'manual_total_cost';

const FULL_WIDTH: CSSProperties = { width: '100%' };

const fieldId = (key: string) => `tender-field-${key}`;

const dateOrNull = (value?: string | null) => {
  const formatted = formatDate(value);
  return formatted === '—' ? null : formatted;
};

const toPickerValue = (value: string | null) => {
  const date = value ? dayjs(value) : null;
  return date?.isValid() ? date : null;
};

const isEmpty = (content: ReactNode) =>
  content == null || content === false || (typeof content === 'string' && !content.trim());

// Просмотр: только заполненные поля.
function buildViewFields(tender: TenderRegistryWithRelations, palette: TenderMonitorPalette): IInfoField[] {
  const lastCallDate = getLastCallFollowUpDate(tender);
  const submissionDate = dateOrNull(tender.submission_date);
  const submissionTime = formatTime(tender.submission_date);
  const cost = tender.manual_total_cost ?? tender.total_cost;
  const rubPerSquare = formatRubPerSquare(tender.total_cost || tender.manual_total_cost, tender.area);
  const siteUrl = tender.site_visit_photo_url?.trim();

  return [
    { key: 'title', label: 'Наименование', content: tender.title, desktopOnly: true },
    { key: 'client_name', label: 'Заказчик', content: tender.client_name, desktopOnly: true },
    { key: 'scope', label: 'Объем строительства', content: tender.construction_scope?.name, desktopOnly: true },
    {
      key: 'status',
      label: 'Статус',
      content: tender.status?.name || (getDashboardStatus(tender) === 'sent' ? 'Направлено' : null),
      desktopOnly: true,
    },
    { key: 'tender_number', label: 'Номер тендера', content: tender.tender_number, desktopOnly: true },
    { key: 'area', label: 'Площадь по СП', content: tender.area != null ? formatArea(tender.area) : null },
    { key: 'rate', label: 'Цена ₽/м²', content: rubPerSquare === '—' ? null : rubPerSquare },
    { key: 'cost', label: 'Стоимость КП', content: cost != null ? formatMoneyFull(cost) : null },
    {
      key: 'sent',
      label: 'Направлено КП',
      content: lastCallDate
        ? `${formatDate(tender.submission_date)} · контроль ${formatDate(lastCallDate)}`
        : submissionDate,
      desktopOnly: true,
    },
    {
      key: 'submission_date',
      label: 'Дата подачи КП',
      content: submissionDate && (submissionTime ? `${submissionDate} ${submissionTime}` : submissionDate),
    },
    { key: 'commission_date', label: 'Ввод в эксплуатацию', content: dateOrNull(tender.commission_date) },
    { key: 'construction_start_date', label: 'Выход на площадку', content: dateOrNull(tender.construction_start_date) },
    { key: 'invitation_date', label: 'Поступило приглашение', content: dateOrNull(tender.invitation_date) },
    { key: 'object_address', label: 'Адрес объекта', content: tender.object_address },
    { key: 'object_coordinates', label: 'Координаты', content: tender.object_coordinates },
    {
      key: 'site_visit_photo_url',
      label: 'Ссылка на посещение площадки',
      content: siteUrl ? (
        <a href={siteUrl} target="_blank" rel="noreferrer" style={{ color: palette.info }}>
          {siteUrl}
        </a>
      ) : null,
    },
  ];
}

// Редактирование: все поля, включая пустые; вычисляемые (₽/м², «Направлено КП») не показываем.
function buildEditFields(
  draft: ITenderInfoDraft,
  tender: TenderRegistryWithRelations,
  { scopeOptions, statusOptions, onChange, onSubmit }: Pick<ITenderMonitorInfoProps, 'scopeOptions' | 'statusOptions' | 'onChange' | 'onSubmit'>
): IInfoField[] {
  const onEnter = inputEnterToSave(onSubmit);

  const text = (key: TextKey, required = false) => (
    <Input
      id={fieldId(key)}
      value={draft[key]}
      onChange={(event) => onChange(key, event.target.value)}
      onKeyDown={onEnter}
      status={required && !draft[key].trim() ? 'error' : undefined}
      allowClear
    />
  );

  const date = (key: DateKey, withTime = false) => (
    <DatePicker
      id={fieldId(key)}
      value={toPickerValue(draft[key])}
      onChange={(next) => onChange(key, next ? next.toISOString() : null)}
      format={withTime ? 'DD.MM.YYYY HH:mm' : DATE_INPUT_FORMATS}
      showTime={withTime ? { format: 'HH:mm' } : undefined}
      placeholder={withTime ? 'Выберите дату и время' : 'Выберите дату'}
      style={FULL_WIDTH}
    />
  );

  const number = (key: NumberKey, placeholder?: string) => (
    <InputNumber<number>
      id={fieldId(key)}
      value={draft[key]}
      onChange={(next) => onChange(key, next ?? null)}
      onPressEnter={onSubmit}
      placeholder={placeholder}
      decimalSeparator=","
      controls={false}
      style={FULL_WIDTH}
    />
  );

  const select = (key: 'construction_scope_id' | 'status', options: IOption[]) => (
    <Select
      id={fieldId(key)}
      value={draft[key] ?? undefined}
      onChange={(next?: string) => onChange(key, next ?? null)}
      options={options}
      allowClear
      style={FULL_WIDTH}
    />
  );

  const calculatedCost =
    tender.manual_total_cost == null && tender.total_cost != null
      ? `по расчёту ${formatMoneyFull(tender.total_cost)}`
      : undefined;

  return [
    { key: 'title', label: 'Наименование', content: text('title', true) },
    { key: 'client_name', label: 'Заказчик', content: text('client_name', true) },
    { key: 'construction_scope_id', label: 'Объем строительства', content: select('construction_scope_id', scopeOptions) },
    { key: 'status', label: 'Статус', content: select('status', statusOptions) },
    { key: 'tender_number', label: 'Номер тендера', content: text('tender_number') },
    { key: 'area', label: 'Площадь по СП', content: number('area') },
    { key: 'manual_total_cost', label: 'Стоимость КП', content: number('manual_total_cost', calculatedCost) },
    { key: 'submission_date', label: 'Дата подачи КП', content: date('submission_date', true) },
    { key: 'commission_date', label: 'Ввод в эксплуатацию', content: date('commission_date') },
    { key: 'construction_start_date', label: 'Выход на площадку', content: date('construction_start_date') },
    { key: 'invitation_date', label: 'Поступило приглашение', content: date('invitation_date') },
    {
      key: 'object_address',
      label: 'Адрес объекта',
      content: (
        <TextArea
          id={fieldId('object_address')}
          value={draft.object_address}
          onChange={(event) => onChange('object_address', event.target.value)}
          onKeyDown={textareaEnterToSave(onSubmit, (value) => onChange('object_address', value))}
          autoSize={{ minRows: 2, maxRows: 4 }}
          allowClear
        />
      ),
    },
    { key: 'object_coordinates', label: 'Координаты', content: text('object_coordinates') },
    { key: 'site_visit_photo_url', label: 'Ссылка на посещение площадки', content: text('site_visit_photo_url') },
  ];
}

export const TenderMonitorInfo: FC<ITenderMonitorInfoProps> = ({ tender, palette, isPhone, draft, ...editProps }) => {
  const editing = draft != null;
  const fields = editing
    ? buildEditFields(draft, tender, editProps)
    : buildViewFields(tender, palette).filter((field) => !isEmpty(field.content) && !(isPhone && field.desktopOnly));

  if (fields.length === 0) {
    return <Text style={{ color: palette.muted, fontSize: 12 }}>Информация о тендере не заполнена</Text>;
  }

  const cardStyle: CSSProperties = {
    padding: '10px 12px',
    borderRadius: 10,
    background: palette.sectionBg,
    border: `1px solid ${palette.borderSoft}`,
    minWidth: 0,
  };
  const labelStyle: CSSProperties = {
    display: 'block',
    color: palette.muted,
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    marginBottom: 6,
  };
  const valueStyle: CSSProperties = {
    color: palette.text,
    fontSize: 12,
    lineHeight: 1.35,
    fontWeight: 600,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px 12px' }}>
      {fields.map((field) => (
        <div key={field.key} style={cardStyle}>
          {editing ? (
            <label htmlFor={fieldId(field.key)} style={labelStyle}>
              {field.label}
            </label>
          ) : (
            <div style={labelStyle}>{field.label}</div>
          )}
          {editing ? field.content : <div style={valueStyle}>{field.content}</div>}
        </div>
      ))}
    </div>
  );
};
