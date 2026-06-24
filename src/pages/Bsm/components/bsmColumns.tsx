import { Tag, Input, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UnitType, BoqItemType } from '../../../lib/supabase';
import type { BoqItemData } from '../types';
import { getUnitColor, getItemTypeStyle, getMaterialTypeStyle } from '../utils/bsmStyles';

const { Link } = Typography;

/**
 * Колонки таблицы БСМ. readOnly (телефон) — ссылка на КП показывается ссылкой/текстом
 * вместо инпута; редактирование только на десктопе/планшете.
 */
export function buildBsmColumns(
  onUpdateQuoteLink: (record: BoqItemData, value: string) => void,
  readOnly: boolean,
): ColumnsType<BoqItemData> {
  return [
    {
      title: 'Вид строки',
      dataIndex: 'boq_item_type',
      key: 'boq_item_type',
      width: 110,
      align: 'center',
      render: (type: BoqItemType) => {
        const style = getItemTypeStyle(type);
        return (
          <Tag style={{ backgroundColor: style.backgroundColor, color: style.color, border: 'none', margin: 0 }}>
            {type}
          </Tag>
        );
      },
      sorter: (a: BoqItemData, b: BoqItemData) => a.boq_item_type.localeCompare(b.boq_item_type),
    },
    {
      title: 'Тип материала',
      dataIndex: 'material_type',
      key: 'material_type',
      width: 120,
      align: 'center',
      render: (type?: 'основн.' | 'вспомогат.') => {
        if (!type) return <span>—</span>;
        const style = getMaterialTypeStyle(type);
        return (
          <Tag style={{ backgroundColor: style.backgroundColor, color: style.color, border: 'none', margin: 0, fontSize: 11 }}>
            {type}
          </Tag>
        );
      },
      sorter: (a: BoqItemData, b: BoqItemData) =>
        (a.material_type || '').localeCompare(b.material_type || ''),
    },
    {
      title: 'Затрата',
      dataIndex: 'expense_label',
      key: 'expense_label',
      width: 240,
      align: 'center',
      render: (label: string) => (
        <span style={{ fontSize: 12, whiteSpace: 'normal', wordBreak: 'break-word' }}>{label || '—'}</span>
      ),
      sorter: (a: BoqItemData, b: BoqItemData) =>
        (a.expense_label || '').localeCompare(b.expense_label || '', 'ru'),
    },
    {
      title: 'Наименование',
      dataIndex: 'name',
      key: 'name',
      width: 300,
      onHeaderCell: () => ({ style: { textAlign: 'center' as const } }),
      render: (name: string) => (
        <div style={{ whiteSpace: 'normal', wordWrap: 'break-word', wordBreak: 'break-word' }}>{name}</div>
      ),
      sorter: (a: BoqItemData, b: BoqItemData) => a.name.localeCompare(b.name),
    },
    {
      title: 'Количество',
      dataIndex: 'total_quantity',
      key: 'total_quantity',
      width: 120,
      align: 'center',
      render: (qty: number) => <div style={{ textAlign: 'center' }}>{qty.toFixed(2)}</div>,
    },
    {
      title: 'Ед.изм.',
      dataIndex: 'unit_code',
      key: 'unit_code',
      width: 100,
      align: 'center',
      render: (unit: UnitType) => (unit ? <Tag color={getUnitColor(unit)}>{unit}</Tag> : <span>—</span>),
    },
    {
      title: 'Цена за ед.',
      dataIndex: 'price_per_unit',
      key: 'price_per_unit',
      width: 150,
      align: 'center',
      render: (price: number) => (
        <div style={{ textAlign: 'center' }}>
          {price.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
        </div>
      ),
      sorter: (a: BoqItemData, b: BoqItemData) => a.price_per_unit - b.price_per_unit,
    },
    {
      title: 'Сумма',
      dataIndex: 'total_amount',
      key: 'total_amount',
      width: 180,
      align: 'center',
      render: (amount: number) => (
        <div style={{ textAlign: 'center' }}>{Math.round(amount).toLocaleString('ru-RU')}</div>
      ),
      sorter: (a: BoqItemData, b: BoqItemData) => a.total_amount - b.total_amount,
    },
    {
      title: 'Кол-во позиций',
      dataIndex: 'usage_count',
      key: 'usage_count',
      width: 130,
      align: 'center',
      render: (count: number) => <div style={{ textAlign: 'center' }}>{count}</div>,
      sorter: (a: BoqItemData, b: BoqItemData) => a.usage_count - b.usage_count,
    },
    {
      title: 'Ссылка на КП',
      dataIndex: 'quote_link',
      key: 'quote_link',
      width: 325,
      align: 'center',
      render: (_: string, record: BoqItemData) =>
        readOnly ? (
          record.quote_link ? (
            <Link href={record.quote_link} target="_blank" ellipsis>{record.quote_link}</Link>
          ) : (
            <span>—</span>
          )
        ) : (
          <Input
            placeholder="Введите ссылку"
            defaultValue={record.quote_link || ''}
            onBlur={(e) => onUpdateQuoteLink(record, e.target.value)}
            onPressEnter={(e) => {
              e.currentTarget.blur();
            }}
            style={{ width: '100%' }}
          />
        ),
      sorter: (a: BoqItemData, b: BoqItemData) =>
        (a.quote_link || '').localeCompare(b.quote_link || ''),
    },
  ];
}
