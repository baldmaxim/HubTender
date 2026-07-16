import { useMemo, useState } from 'react';
import { AutoComplete, Input, InputNumber, Select, Tag } from 'antd';
import type { CurrencyType } from '../../../../lib/types';
import { getCurrencyRate } from '../../utils/boqFieldPatch';
import type { NameOptionDraft } from '../../utils/boqFieldPatch';
import { getWorkTypeColor } from '../editFormColors';
import type { SheetControlSpec, SheetCtx } from './sheetFieldTypes';

interface SheetControlProps {
  spec: SheetControlSpec;
  draft: unknown;
  setDraft: (v: unknown) => void;
  ctx: SheetCtx;
  /** Enter в текстовом/числовом поле = «Сохранить». */
  onCommit: () => void;
  disabled: boolean;
}

const CURRENCY_OPTIONS: Array<{ value: CurrencyType; label: string }> = [
  { value: 'RUB', label: '₽ Рубль' },
  { value: 'USD', label: '$ Доллар' },
  { value: 'EUR', label: '€ Евро' },
  { value: 'CNY', label: '¥ Юань' },
];

const FULL = { width: '100%' } as const;
// Дропдауны внутри Drawer'а клипаются на iOS — портируем в body безусловно.
const popupToBody = () => document.body;

/**
 * Единственный компонент-рендерер контролов листа: switch по spec.kind.
 * Идиома MaterialsEditableCell (Библиотека), а не фабрика компонентов —
 * иначе каждый рендер давал бы новую identity и инпут терял бы фокус.
 */
const SheetControl: React.FC<SheetControlProps> = ({
  spec,
  draft,
  setDraft,
  ctx,
  onCommit,
  disabled,
}) => {
  switch (spec.kind) {
    case 'number':
      return (
        <InputNumber
          value={draft as number | null}
          onChange={(v) => setDraft(v)}
          onPressEnter={onCommit}
          disabled={disabled}
          autoFocus
          precision={spec.precision}
          style={FULL}
          // type="number" нельзя: запятая-разделитель + parser требуют текстового инпута.
          inputMode="decimal"
          decimalSeparator=","
          parser={(value) => parseFloat((value ?? '').replace(/\s/g, '').replace(/,/g, '.'))}
        />
      );

    case 'text':
      return spec.textarea ? (
        <Input.TextArea
          value={(draft as string) ?? ''}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
          autoFocus
          allowClear
          autoSize={{ minRows: 2, maxRows: 4 }}
          style={FULL}
        />
      ) : (
        <Input
          value={(draft as string) ?? ''}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={onCommit}
          disabled={disabled}
          autoFocus
          allowClear
          style={FULL}
        />
      );

    case 'select':
      return (
        <Select
          value={draft as string}
          onChange={(v) => setDraft(v)}
          disabled={disabled}
          autoFocus
          style={FULL}
          getPopupContainer={popupToBody}
          options={spec.options}
        />
      );

    case 'currency':
      return (
        <Select
          value={draft as CurrencyType}
          onChange={(v) => setDraft(v)}
          disabled={disabled}
          autoFocus
          style={FULL}
          getPopupContainer={popupToBody}
          options={CURRENCY_OPTIONS.map((o) => ({
            ...o,
            // Валюта без курса в тендере уронила бы PATCH в 400 (MISSING_FX_RATE).
            disabled: getCurrencyRate(o.value, ctx.currencyRates) <= 0,
          }))}
        />
      );

    case 'name':
      return <NameControl spec={spec} draft={draft} setDraft={setDraft} ctx={ctx} disabled={disabled} />;

    case 'cost':
      return <CostControl draft={draft} setDraft={setDraft} ctx={ctx} disabled={disabled} />;

    case 'parent':
      return <ParentControl draft={draft} setDraft={setDraft} ctx={ctx} disabled={disabled} />;

    default:
      return null;
  }
};

// ─── Наименование (номенклатура) ─────────────────────────────────────────────

const NameControl: React.FC<{
  spec: Extract<SheetControlSpec, { kind: 'name' }>;
  draft: unknown;
  setDraft: (v: unknown) => void;
  ctx: SheetCtx;
  disabled: boolean;
}> = ({ spec, draft, setDraft, ctx, disabled }) => {
  const current = draft as NameOptionDraft | null;
  const initialText =
    spec.source === 'work' ? ctx.item.work_name || '' : ctx.item.material_name || '';
  const [text, setText] = useState<string>(initialText);

  const options = useMemo(() => {
    if (text.trim().length < 2) return [];
    const src = spec.source === 'work' ? ctx.workNames : ctx.materialNames;
    const q = text.toLowerCase();
    return src
      .filter((n) => (n.name || '').toLowerCase().includes(q))
      .slice(0, 50)
      .map((n) => ({ value: n.id, label: n.name, unit: n.unit }));
  }, [text, spec.source, ctx.workNames, ctx.materialNames]);

  return (
    <AutoComplete
      // value — подпись, а не id: показываем человекочитаемое имя.
      value={text}
      options={options}
      disabled={disabled}
      autoFocus
      style={FULL}
      getPopupContainer={popupToBody}
      placeholder="Введите минимум 2 символа"
      onSearch={(v) => {
        setText(v);
        // Ручной ввод без выбора из списка = нет id → ✓ останется disabled.
        if (current) setDraft(null);
      }}
      onSelect={(_v, option) => {
        setText(option.label as string);
        setDraft({ id: option.value as string, unit: option.unit } as NameOptionDraft);
      }}
    />
  );
};

// ─── Затрата на строительство ────────────────────────────────────────────────

const CostControl: React.FC<{
  draft: unknown;
  setDraft: (v: unknown) => void;
  ctx: SheetCtx;
  disabled: boolean;
}> = ({ draft, setDraft, ctx, disabled }) => {
  const currentId = draft as string | null;
  const initial = ctx.costCategories.find((c) => c.value === currentId)?.label ?? '';
  const [text, setText] = useState<string>(initial);

  const options = useMemo(() => {
    const q = text.toLowerCase();
    return ctx.costCategories
      .filter((c) => c.label.toLowerCase().includes(q))
      .slice(0, 50)
      .map((c) => ({ value: c.value, label: c.label }));
  }, [text, ctx.costCategories]);

  return (
    <AutoComplete
      value={text}
      options={options}
      disabled={disabled}
      autoFocus
      style={FULL}
      getPopupContainer={popupToBody}
      placeholder="Категория / Детализация / Локация"
      onSearch={(v) => {
        setText(v);
        // Очистка затраты не поддерживается (паритет с десктопом) — id гасим,
        // чтобы ✓ был disabled, пока не выбрана валидная опция.
        if (currentId) setDraft(null);
      }}
      onSelect={(v, option) => {
        setText(option.label as string);
        setDraft(v as string);
      }}
    />
  );
};

// ─── Привязка к работе ───────────────────────────────────────────────────────

const ParentControl: React.FC<{
  draft: unknown;
  setDraft: (v: unknown) => void;
  ctx: SheetCtx;
  disabled: boolean;
}> = ({ draft, setDraft, ctx, disabled }) => (
  <Select
    value={(draft as string | null) ?? undefined}
    onChange={(v) => setDraft(v ?? null)}
    disabled={disabled}
    autoFocus
    allowClear
    showSearch
    optionFilterProp="label"
    style={FULL}
    getPopupContainer={popupToBody}
    placeholder="Без привязки"
    options={ctx.workItems.map((w) => ({
      value: w.id,
      label: w.work_name || '—',
      type: w.boq_item_type,
    }))}
    optionRender={(option) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Tag color={getWorkTypeColor(option.data.type)} style={{ margin: 0, fontSize: 11 }}>
          {option.data.type}
        </Tag>
        <span style={{ whiteSpace: 'normal' }}>{option.data.label}</span>
      </div>
    )}
  />
);

export default SheetControl;
