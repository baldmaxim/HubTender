import React, { useState } from 'react';
import { DatePicker, Input, Select, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ChronologyItem, TenderPackageItem } from '../../../lib/types';
import { DATE_INPUT_FORMATS, formatDate, getPackageLinkHref } from '../utils/tenderMonitor';
import type { TenderMonitorPalette } from '../utils/tenderMonitorTheme';
import { nextDraftRowKey, type ChronologyDraftRow, type PackageDraftRow } from '../utils/tenderMonitorDraft';
import { inputEnterToSave, textareaEnterToSave } from '../../../utils/keyboardSave';

const { Text } = Typography;
const { TextArea } = Input;

type ChronologyType = 'default' | 'call_follow_up';

const CHRONOLOGY_TYPE_OPTIONS = [
  { value: 'default', label: 'Событие' },
  { value: 'call_follow_up', label: 'Звонок' },
];

// Оформление строки — как у полей вкладки «Информация».
function rowSectionStyle(palette: TenderMonitorPalette, danger: boolean): React.CSSProperties {
  return {
    padding: '10px 12px',
    background: palette.sectionBg,
    borderRadius: 10,
    border: `1px solid ${danger ? palette.dangerBorder : palette.borderSoft}`,
  };
}

const toPickerValue = (value: string | null) => {
  const date = value ? dayjs(value) : null;
  return date?.isValid() ? date : null;
};

// Отдельных кнопок «Удалить» у строк нет: строка без текста не сохраняется.
function EditorFooter({ hint, palette, onAdd }: { hint: string; palette: TenderMonitorPalette; onAdd: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <button type="button" className="tm-modal-btn tm-modal-btn--small" onClick={onAdd}>
        <PlusOutlined aria-hidden />
        Добавить строку
      </button>
      <Text style={{ color: palette.muted, fontSize: 11 }}>{hint}</Text>
    </div>
  );
}

// ----- Хронология ------------------------------------------------------------

interface IChronologyEditorProps {
  rows: ChronologyDraftRow[];
  palette: TenderMonitorPalette;
  onChange: (update: (rows: ChronologyDraftRow[]) => ChronologyDraftRow[]) => void;
  onSubmit: () => void;
}

export function ChronologyEditor({ rows, palette, onChange, onSubmit }: IChronologyEditorProps) {
  const [addedKey, setAddedKey] = useState<number | null>(null);

  const updateRow = (key: number, patch: Partial<ChronologyItem>) =>
    onChange((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const addRow = () => {
    const key = nextDraftRowKey();
    setAddedKey(key);
    onChange((prev) => [...prev, { key, date: dayjs().toISOString(), text: '', type: 'default' }]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((row) => (
        <div key={row.key} style={rowSectionStyle(palette, row.type === 'call_follow_up')}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 140px minmax(0, 1fr)', gap: 8, alignItems: 'start' }}>
            <Select
              value={(row.type as ChronologyType) || 'default'}
              onChange={(type: ChronologyType) => updateRow(row.key, { type })}
              options={CHRONOLOGY_TYPE_OPTIONS}
              aria-label="Тип события"
            />
            <DatePicker
              value={toPickerValue(row.date)}
              onChange={(date) => updateRow(row.key, { date: date ? date.toISOString() : null })}
              format={DATE_INPUT_FORMATS}
              placeholder="Выберите дату"
              style={{ width: '100%' }}
              aria-label="Дата события"
            />
            <TextArea
              value={row.text}
              onChange={(event) => updateRow(row.key, { text: event.target.value })}
              onKeyDown={textareaEnterToSave(onSubmit, (text) => updateRow(row.key, { text }))}
              autoSize={{ minRows: 1, maxRows: 6 }}
              autoFocus={row.key === addedKey}
              allowClear
              placeholder="Описание события"
              aria-label="Описание события"
            />
          </div>
        </div>
      ))}

      <EditorFooter hint="Чтобы удалить строку, очистите описание" palette={palette} onAdd={addRow} />
    </div>
  );
}

export function ReadOnlyChronologySection({
  items,
  palette,
}: {
  items: ChronologyItem[];
  palette: TenderMonitorPalette;
}) {
  if (items.length === 0) {
    return <Text style={{ color: palette.muted, fontSize: 12 }}>Хронология пока не заполнена</Text>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, index) => (
        <div key={`${item.date || 'empty'}-${index}`} style={rowSectionStyle(palette, item.type === 'call_follow_up')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ color: palette.warning, fontSize: 11, fontWeight: 700 }}>{formatDate(item.date)}</span>
            {item.type === 'call_follow_up' ? (
              <Tag color="error" style={{ marginInlineEnd: 0 }}>
                Звонок
              </Tag>
            ) : null}
          </div>
          <div style={{ color: palette.textSecondary, fontSize: 12, lineHeight: 1.35, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {item.text}
          </div>
        </div>
      ))}
    </div>
  );
}

// ----- Тендерный пакет -------------------------------------------------------

interface IPackageEditorProps {
  rows: PackageDraftRow[];
  palette: TenderMonitorPalette;
  onChange: (update: (rows: PackageDraftRow[]) => PackageDraftRow[]) => void;
  onSubmit: () => void;
}

export function PackageEditor({ rows, palette, onChange, onSubmit }: IPackageEditorProps) {
  const [addedKey, setAddedKey] = useState<number | null>(null);

  const updateRow = (key: number, patch: Partial<TenderPackageItem>) =>
    onChange((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const addRow = () => {
    const key = nextDraftRowKey();
    setAddedKey(key);
    onChange((prev) => [...prev, { key, date: dayjs().toISOString(), text: '', link: '' }]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((row) => (
        <div key={row.key} style={rowSectionStyle(palette, false)}>
          <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)', gap: 8, alignItems: 'start' }}>
            <DatePicker
              value={toPickerValue(row.date)}
              onChange={(date) => updateRow(row.key, { date: date ? date.toISOString() : null })}
              format={DATE_INPUT_FORMATS}
              placeholder="Выберите дату"
              style={{ width: '100%' }}
              aria-label="Дата"
            />
            <TextArea
              value={row.text}
              onChange={(event) => updateRow(row.key, { text: event.target.value })}
              onKeyDown={textareaEnterToSave(onSubmit, (text) => updateRow(row.key, { text }))}
              autoSize={{ minRows: 1, maxRows: 6 }}
              autoFocus={row.key === addedKey}
              allowClear
              placeholder="Наименование"
              aria-label="Наименование"
            />
          </div>
          <Input
            value={row.link || ''}
            onChange={(event) => updateRow(row.key, { link: event.target.value })}
            onKeyDown={inputEnterToSave(onSubmit)}
            allowClear
            placeholder="Ссылка"
            aria-label="Ссылка"
            style={{ marginTop: 8 }}
          />
        </div>
      ))}

      <EditorFooter hint="Чтобы удалить строку, очистите наименование" palette={palette} onAdd={addRow} />
    </div>
  );
}

export function ReadOnlyPackageSection({
  items,
  palette,
}: {
  items: TenderPackageItem[];
  palette: TenderMonitorPalette;
}) {
  const visibleItems = items.filter((item) => item.text?.trim());

  if (visibleItems.length === 0) {
    return <Text style={{ color: palette.muted, fontSize: 12 }}>Тендерный пакет не заполнен</Text>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {visibleItems.map((item, index) => {
        const href = getPackageLinkHref(item.link);

        return (
          <div key={`${item.date || 'empty'}-${index}`} style={rowSectionStyle(palette, false)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <div style={{ color: palette.text, fontSize: 12, fontWeight: 600, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {item.text}
              </div>
              {item.date ? (
                <span style={{ color: palette.muted, fontSize: 11, flexShrink: 0 }}>{formatDate(item.date)}</span>
              ) : null}
            </div>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                style={{ color: palette.info, fontSize: 11, wordBreak: 'break-word' }}
              >
                Открыть ссылку
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
