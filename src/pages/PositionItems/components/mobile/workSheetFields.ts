import { currencySymbols } from '../boqColors';
import { formatRu } from '../../../../utils/format/currency';
import type { NameOptionDraft } from '../../utils/boqFieldPatch';
import type { SheetCtx, SheetField } from './sheetFieldTypes';

const DASH = '—';

const nameDraft = (ctx: SheetCtx): NameOptionDraft | null =>
  ctx.item.work_name_id ? { id: ctx.item.work_name_id, unit: ctx.item.unit_code } : null;

/**
 * Набор полей листа для работы (раб / суб-раб / раб-комп.).
 * Опции типа жёстко ограничены семейством работ: смена семейства нарушила бы
 * boq_items_material_check, поэтому в UI она невозможна.
 */
export const WORK_SHEET_FIELDS: SheetField[] = [
  {
    key: 'boq_item_type',
    label: 'Тип',
    group: 'classification',
    editKey: 'boq_item_type',
    render: (ctx) => ctx.item.boq_item_type,
    toDraft: (ctx) => ctx.item.boq_item_type,
    control: {
      kind: 'select',
      options: [
        { value: 'раб', label: 'раб' },
        { value: 'суб-раб', label: 'суб-раб' },
        { value: 'раб-комп.', label: 'раб-комп.' },
      ],
    },
  },
  {
    key: 'work_name_id',
    label: 'Наименование',
    group: 'classification',
    editKey: 'work_name_id',
    needsRefs: true,
    render: (ctx) => ctx.item.work_name || DASH,
    toDraft: nameDraft,
    control: { kind: 'name', source: 'work' },
  },
  // Портрет: две пары («Кол-во · Ед. изм.», «Цена за ед. · Валюта»).
  // Ландшафт: все четыре в одну строку — там хватает ширины.
  {
    key: 'quantity',
    label: 'Кол-во',
    group: 'quantity',
    editKey: 'quantity',
    rowKey: 'qty',
    rowKeyLandscape: 'qty4',
    render: (ctx) => (ctx.item.quantity != null ? ctx.item.quantity.toFixed(5) : DASH),
    toDraft: (ctx) => ctx.item.quantity ?? null,
    control: { kind: 'number', precision: 5 },
  },
  {
    key: 'unit_code',
    label: 'Ед. изм.',
    group: 'quantity',
    rowKey: 'qty',
    rowKeyLandscape: 'qty4',
    // Производное от номенклатуры — правится только через Наименование.
    render: (ctx) => ctx.item.unit_code || DASH,
  },
  {
    key: 'unit_rate',
    label: 'Цена за ед.',
    group: 'quantity',
    editKey: 'unit_rate',
    rowKey: 'price',
    rowKeyLandscape: 'qty4',
    render: (ctx) =>
      ctx.item.unit_rate != null
        ? `${formatRu(ctx.item.unit_rate)} ${currencySymbols[ctx.item.currency_type || 'RUB']}`
        : DASH,
    toDraft: (ctx) => ctx.item.unit_rate ?? null,
    control: { kind: 'number', precision: 2 },
  },
  {
    key: 'currency_type',
    label: 'Валюта',
    group: 'quantity',
    editKey: 'currency_type',
    rowKey: 'price',
    rowKeyLandscape: 'qty4',
    render: (ctx) => currencySymbols[ctx.item.currency_type || 'RUB'],
    toDraft: (ctx) => ctx.item.currency_type || 'RUB',
    control: { kind: 'currency' },
  },
  {
    key: 'detail_cost_category_id',
    label: 'Затрата на строительство',
    group: 'other',
    editKey: 'detail_cost_category_id',
    needsRefs: true,
    render: (ctx) => ctx.item.detail_cost_category_full || DASH,
    toDraft: (ctx) => ctx.item.detail_cost_category_id ?? null,
    control: { kind: 'cost' },
  },
  {
    key: 'quote_link',
    label: 'Ссылка на КП',
    group: 'other',
    editKey: 'quote_link',
    render: (ctx) => ctx.item.quote_link || DASH,
    toDraft: (ctx) => ctx.item.quote_link || '',
    control: { kind: 'text' },
  },
  {
    key: 'description',
    label: 'Примечание',
    group: 'other',
    editKey: 'description',
    render: (ctx) => ctx.item.description || DASH,
    toDraft: (ctx) => ctx.item.description || '',
    control: { kind: 'text', textarea: true },
  },
];
