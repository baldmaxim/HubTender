import { currencySymbols } from '../boqColors';
import { formatRu } from '../../../../utils/format/currency';
import { isLinked } from '../../utils/boqFieldPatch';
import type { NameOptionDraft } from '../../utils/boqFieldPatch';
import type { SheetCtx, SheetField } from './sheetFieldTypes';

const DASH = '—';

const nameDraft = (ctx: SheetCtx): NameOptionDraft | null =>
  ctx.item.material_name_id ? { id: ctx.item.material_name_id, unit: ctx.item.unit_code } : null;

/**
 * Набор полей листа для материала (мат / суб-мат / мат-комп.).
 *
 * Ключевая асимметрия, задающая карандаши:
 * - привязанный материал: Кол-во = кол-во работы × К перев × К расх → это ВЫХОД
 *   формулы, карандаша нет; пересчёт делает сервер после правки коэффициента;
 * - непривязанный: К расх бьёт по ИТОГУ, а не по количеству, поэтому Кол-во
 *   правится напрямую и тянет за собой base_quantity.
 */
export const MATERIAL_SHEET_FIELDS: SheetField[] = [
  {
    key: 'boq_item_type',
    label: 'Тип',
    group: 'classification',
    editKey: 'boq_item_type',
    pairKey: 'type',
    render: (ctx) => ctx.item.boq_item_type,
    toDraft: (ctx) => ctx.item.boq_item_type,
    control: {
      kind: 'select',
      options: [
        { value: 'мат', label: 'мат' },
        { value: 'суб-мат', label: 'суб-мат' },
        { value: 'мат-комп.', label: 'мат-комп.' },
      ],
    },
  },
  {
    key: 'material_type',
    label: 'Вид',
    group: 'classification',
    editKey: 'material_type',
    pairKey: 'type',
    render: (ctx) => ctx.item.material_type || DASH,
    toDraft: (ctx) => ctx.item.material_type || 'основн.',
    control: {
      kind: 'select',
      options: [
        { value: 'основн.', label: 'основн.' },
        { value: 'вспомогат.', label: 'вспомогат.' },
      ],
    },
  },
  {
    key: 'material_name_id',
    label: 'Наименование',
    group: 'classification',
    editKey: 'material_name_id',
    needsRefs: true,
    render: (ctx) => ctx.item.material_name || DASH,
    toDraft: nameDraft,
    control: { kind: 'name', source: 'material' },
  },
  {
    key: 'parent_work_item_id',
    label: 'Привязка',
    group: 'classification',
    editKey: 'parent_work_item_id',
    render: (ctx) => ctx.item.parent_work_name || 'Без привязки',
    toDraft: (ctx) => ctx.item.parent_work_item_id ?? null,
    control: { kind: 'parent' },
  },
  {
    key: 'conversion_coefficient',
    label: 'К перев',
    group: 'quantity',
    editKey: 'conversion_coefficient',
    pairKey: 'coef',
    // У непривязанного материала колонка очищена (null) — поле не показываем,
    // и пара 'coef' сама схлопывается до одного «К расх».
    visible: (ctx) => isLinked(ctx.item),
    render: (ctx) =>
      ctx.item.conversion_coefficient != null ? ctx.item.conversion_coefficient.toFixed(5) : DASH,
    toDraft: (ctx) => ctx.item.conversion_coefficient ?? 1,
    control: { kind: 'number', precision: 5 },
  },
  {
    key: 'consumption_coefficient',
    label: 'К расх',
    group: 'quantity',
    editKey: 'consumption_coefficient',
    pairKey: 'coef',
    render: (ctx) =>
      ctx.item.consumption_coefficient != null ? ctx.item.consumption_coefficient.toFixed(5) : DASH,
    toDraft: (ctx) => ctx.item.consumption_coefficient ?? 1,
    control: { kind: 'number', precision: 5 },
  },
  {
    key: 'quantity',
    label: 'Кол-во',
    group: 'quantity',
    // Карандаш только у непривязанного: у привязанного это выход формулы.
    editKey: undefined,
    pairKey: 'qty',
    render: (ctx) => (ctx.item.quantity != null ? ctx.item.quantity.toFixed(5) : DASH),
    toDraft: (ctx) => ctx.item.quantity ?? null,
    control: { kind: 'number', precision: 5 },
  },
  {
    key: 'unit_code',
    label: 'Ед. изм.',
    group: 'quantity',
    pairKey: 'qty',
    render: (ctx) => ctx.item.unit_code || DASH,
  },
  {
    key: 'unit_rate',
    label: 'Цена за ед.',
    group: 'quantity',
    editKey: 'unit_rate',
    pairKey: 'price',
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
    pairKey: 'price',
    render: (ctx) => currencySymbols[ctx.item.currency_type || 'RUB'],
    toDraft: (ctx) => ctx.item.currency_type || 'RUB',
    control: { kind: 'currency' },
  },
  {
    key: 'delivery_price_type',
    label: 'Доставка',
    group: 'quantity',
    editKey: 'delivery_price_type',
    pairKey: 'delivery',
    render: (ctx) => ctx.item.delivery_price_type || 'в цене',
    toDraft: (ctx) => ctx.item.delivery_price_type || 'в цене',
    control: {
      kind: 'select',
      options: [
        { value: 'в цене', label: 'в цене' },
        { value: 'не в цене', label: 'не в цене' },
        { value: 'суммой', label: 'суммой' },
      ],
    },
  },
  {
    key: 'delivery_amount',
    label: 'Сум. дост.',
    group: 'quantity',
    editKey: 'delivery_amount',
    pairKey: 'delivery',
    // Вне режима «суммой» колонка не используется — пара схлопывается до «Доставки».
    visible: (ctx) => ctx.item.delivery_price_type === 'суммой',
    render: (ctx) => (ctx.item.delivery_amount != null ? formatRu(ctx.item.delivery_amount) : DASH),
    toDraft: (ctx) => ctx.item.delivery_amount ?? 0,
    control: { kind: 'number', precision: 2 },
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

/**
 * Кол-во у НЕпривязанного материала редактируемо, у привязанного — нет.
 * Дескрипторы статичны, поэтому ключ проставляем на лету по живой записи.
 */
export const materialFieldsFor = (ctx: SheetCtx): SheetField[] =>
  MATERIAL_SHEET_FIELDS.map((f) =>
    f.key === 'quantity' && !isLinked(ctx.item) ? { ...f, editKey: 'quantity' as const } : f,
  );
