/**
 * Конфигурация колонок для таблицы результатов
 */

import { Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RedistributionAmountCell } from './RedistributionAmountCell';

export interface ResultRow {
  key: string;
  position_id: string;
  position_number: number;
  section_number: string | null;
  position_name: string;
  item_no: string | null;
  work_name: string;
  client_volume: number | null;
  manual_volume: number | null;
  unit_code: string;
  quantity: number;
  material_unit_price: number;
  work_unit_price_before: number;
  work_unit_price_after: number;
  total_materials: number;
  total_works_before: number;
  total_works_after: number;
  redistribution_amount: number;
  manual_note: string | null;
  isLeaf: boolean;
  is_additional: boolean;

  // Округленные значения
  rounded_material_unit_price?: number;
  rounded_work_unit_price_after?: number;
  rounded_total_materials?: number;
  rounded_total_works?: number;
}

export const getResultsTableColumns = (): ColumnsType<ResultRow> => {
  return [
    {
      title: <div style={{ textAlign: 'center' }}>Наименование</div>,
      key: 'name',
      fixed: 'left',
      width: 300,
      render: (_, record) => {
        const itemNoColor = record.isLeaf ? '#52c41a' : '#ff7875';
        const paddingLeft = record.is_additional ? 20 : 0;
        return (
          <div style={{ paddingLeft }}>
            <div style={{ fontWeight: 500 }}>
              {record.is_additional ? (
                <Tag color="orange" style={{ marginRight: 8 }}>
                  ДОП
                </Tag>
              ) : record.section_number ? (
                <Tag color="blue" style={{ marginRight: 8 }}>
                  {record.section_number}
                </Tag>
              ) : null}
              {record.item_no && (
                <span style={{ marginRight: 8, color: itemNoColor, fontWeight: 600 }}>
                  {record.item_no}
                </span>
              )}
              <span
                style={{
                  fontWeight: record.isLeaf ? undefined : 700,
                  fontFamily: record.isLeaf ? undefined : 'Georgia, "Times New Roman", serif',
                }}
              >
                {record.work_name}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Кол-во заказчика</div>,
      dataIndex: 'client_volume',
      key: 'client_volume',
      width: 120,
      align: 'center',
      render: (value) => (value != null ? value.toFixed(2) : '—'),
    },
    {
      title: <div style={{ textAlign: 'center' }}>Кол-во ГП</div>,
      dataIndex: 'manual_volume',
      key: 'manual_volume',
      width: 120,
      align: 'center',
      render: (value) => (value != null ? value.toFixed(2) : '—'),
    },
    {
      title: <div style={{ textAlign: 'center' }}>Ед. изм.</div>,
      dataIndex: 'unit_code',
      key: 'unit_code',
      width: 100,
      align: 'center',
    },
    {
      title: <div style={{ textAlign: 'center' }}>Цена за ед. мат-ал в КП</div>,
      dataIndex: 'material_unit_price',
      key: 'material_unit_price',
      width: 150,
      align: 'center',
      render: (_, record) => {
        const value = record.rounded_material_unit_price ?? record.material_unit_price;
        return value.toLocaleString('ru-RU', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Цена за ед. раб</div>,
      key: 'work_unit_price',
      width: 200,
      children: [
        {
          title: <div style={{ textAlign: 'center' }}>До</div>,
          dataIndex: 'work_unit_price_before',
          key: 'work_unit_price_before',
          width: 120,
          align: 'center',
          render: (value) =>
            value.toLocaleString('ru-RU', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }),
        },
        {
          title: <div style={{ textAlign: 'center' }}>После</div>,
          dataIndex: 'work_unit_price_after',
          key: 'work_unit_price_after',
          width: 120,
          align: 'center',
          render: (_, record) => {
            const value = record.rounded_work_unit_price_after ?? record.work_unit_price_after;
            return value.toLocaleString('ru-RU', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });
          },
        },
      ],
    },
    {
      title: <div style={{ textAlign: 'center' }}>Итого материалы</div>,
      dataIndex: 'total_materials',
      key: 'total_materials',
      width: 150,
      align: 'center',
      render: (_, record) => {
        const value = record.rounded_total_materials ?? record.total_materials;
        return value.toLocaleString('ru-RU', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Итого работы</div>,
      key: 'total_works',
      width: 250,
      children: [
        {
          title: <div style={{ textAlign: 'center' }}>До</div>,
          dataIndex: 'total_works_before',
          key: 'total_works_before',
          width: 130,
          align: 'center',
          render: (value) =>
            value.toLocaleString('ru-RU', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }),
        },
        {
          title: <div style={{ textAlign: 'center' }}>После</div>,
          dataIndex: 'total_works_after',
          key: 'total_works_after',
          width: 130,
          align: 'center',
          render: (_, record) => {
            const value = record.rounded_total_works ?? record.total_works_after;
            return value.toLocaleString('ru-RU', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });
          },
        },
      ],
    },
    {
      title: <div style={{ textAlign: 'center' }}>Сумма перераспределения</div>,
      dataIndex: 'redistribution_amount',
      key: 'redistribution_amount',
      width: 180,
      align: 'center',
      render: (value) => <RedistributionAmountCell amount={value} />,
    },
    {
      title: <div style={{ textAlign: 'center' }}>Примечание ГП</div>,
      dataIndex: 'manual_note',
      key: 'manual_note',
      width: 200,
      align: 'center',
      ellipsis: true,
      render: (value) => value || '—',
    },
  ];
};
