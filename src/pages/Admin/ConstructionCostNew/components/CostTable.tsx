/**
 * Компонент таблицы затрат с возможностью редактирования объемов
 */

import React from 'react';
import { Table, InputNumber, Typography, Spin } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { CostRow } from '../hooks/useCostData';
import { useTheme } from '../../../../contexts/ThemeContext';

const { Text } = Typography;

interface CostTableProps {
  data: CostRow[];
  viewMode: 'detailed' | 'summary' | 'simplified';
  loading: boolean;
  expandedRowKeys: string[];
  onExpandedRowsChange: (keys: string[]) => void;
  onVolumeChange: (value: number, record: CostRow) => void;
  areaSp: number;
}

const CostTable: React.FC<CostTableProps> = ({
  data,
  viewMode,
  loading,
  expandedRowKeys,
  onExpandedRowsChange,
  onVolumeChange,
  areaSp,
}) => {
  const { theme } = useTheme();

  // Базовые колонки (категория, вид, локация, объем, ед., цена за ед.)
  const baseColumns: ColumnsType<CostRow> = [
    {
      title: <div style={{ textAlign: 'center' }}>Категория</div>,
      dataIndex: 'cost_category_name',
      key: 'cost_category_name',
      width: 140,
      fixed: 'left',
      render: (value: string, record: CostRow) => {
        if (record.is_category) {
          return <Text strong style={{ fontSize: '14px' }}>{value}</Text>;
        }
        if (record.is_location) {
          return <Text strong style={{ fontSize: '13px' }}>{record.location_name}</Text>;
        }
        return null;
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Вид</div>,
      dataIndex: 'detail_category_name',
      key: 'detail_category_name',
      width: 180,
      render: (value: string, record: CostRow) => {
        if (record.is_category) return null;
        if (record.is_location) return null;
        return value;
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Локализация</div>,
      dataIndex: 'location_name',
      key: 'location_name',
      width: 110,
      render: (value: string, record: CostRow) => {
        if (record.is_category) return null;
        if (record.is_location) return null;
        return value;
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Объем</div>,
      dataIndex: 'volume',
      key: 'volume',
      width: 100,
      align: 'right',
      render: (value: number, record: CostRow) => {
        // Для категорий и локализаций - показываем InputNumber для ввода объема группы
        if (record.is_category || record.is_location) {
          return (
            <InputNumber
              value={value}
              onBlur={(e) => {
                const newValue = parseFloat(e.target.value.replace(',', '.').replace(/\s/g, ''));
                if (!isNaN(newValue)) {
                  onVolumeChange(newValue, record);
                }
              }}
              onPressEnter={(e) => {
                const target = e.target as HTMLInputElement;
                const newValue = parseFloat(target.value.replace(',', '.').replace(/\s/g, ''));
                if (!isNaN(newValue)) {
                  onVolumeChange(newValue, record);
                  target.blur();
                }
              }}
              min={0}
              step={0.01}
              precision={2}
              style={{ width: '100%' }}
              size="small"
              placeholder="Объем группы"
            />
          );
        }
        // Для деталей - обычный InputNumber
        return (
          <InputNumber
            value={value}
            onBlur={(e) => {
              const newValue = parseFloat(e.target.value.replace(',', '.').replace(/\s/g, ''));
              if (!isNaN(newValue)) {
                onVolumeChange(newValue, record);
              }
            }}
            onPressEnter={(e) => {
              const target = e.target as HTMLInputElement;
              const newValue = parseFloat(target.value.replace(',', '.').replace(/\s/g, ''));
              if (!isNaN(newValue)) {
                onVolumeChange(newValue, record);
                target.blur();
              }
            }}
            min={0}
            step={0.01}
            precision={2}
            style={{ width: '100%' }}
            size="small"
          />
        );
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Ед.</div>,
      dataIndex: 'unit',
      key: 'unit',
      width: 60,
      align: 'center',
      render: (value: string, record: CostRow) => (record.is_category || record.is_location) ? null : value,
    },
    {
      title: <div style={{ textAlign: 'center' }}>₽/ед.</div>,
      dataIndex: 'cost_per_unit',
      key: 'cost_per_unit',
      width: 110,
      align: 'right',
      render: (value: number, record: CostRow) => {
        // Для категорий и локализаций - показываем расчет стоимости за единицу, если введен объем
        if (record.is_category || record.is_location) {
          if (record.volume > 0) {
            const costPerUnit = record.total_cost / record.volume;
            return <Text strong style={{ color: '#0891b2' }}>{costPerUnit.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>;
          }
          return null;
        }
        return <Text strong>{value.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>;
      },
    },
  ];

  // Детальные колонки (мат., раб., суб-мат., суб-раб.)
  const detailedColumns: ColumnsType<CostRow> = [
    {
      title: <div style={{ textAlign: 'center' }}>Мат.</div>,
      key: 'materials_total',
      width: 110,
      align: 'right',
      render: (_: unknown, record: CostRow) => {
        const total = record.materials_cost + record.materials_comp_cost;
        return total.toLocaleString('ru-RU', { minimumFractionDigits: 0 });
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Раб.</div>,
      key: 'works_total',
      width: 110,
      align: 'right',
      render: (_: unknown, record: CostRow) => {
        const total = record.works_cost + record.works_comp_cost;
        return total.toLocaleString('ru-RU', { minimumFractionDigits: 0 });
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Суб-мат.</div>,
      dataIndex: 'sub_materials_cost',
      key: 'sub_materials_cost',
      width: 110,
      align: 'right',
      render: (value: number) => value.toLocaleString('ru-RU', { minimumFractionDigits: 0 }),
    },
    {
      title: <div style={{ textAlign: 'center' }}>Суб-раб.</div>,
      dataIndex: 'sub_works_cost',
      key: 'sub_works_cost',
      width: 110,
      align: 'right',
      render: (value: number) => value.toLocaleString('ru-RU', { minimumFractionDigits: 0 }),
    },
  ];

  // Итоговые колонки (итого работы, итого материалы)
  const summaryColumns: ColumnsType<CostRow> = [
    {
      title: <div style={{ textAlign: 'center' }}>Итого работы</div>,
      key: 'total_works',
      width: 130,
      align: 'right',
      render: (_: unknown, record: CostRow) => {
        const totalWorks = record.works_cost + record.sub_works_cost + record.works_comp_cost;
        return (
          <Text style={{ color: '#0891b2' }}>
            {Math.round(totalWorks).toLocaleString('ru-RU')}
          </Text>
        );
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Итого материалы</div>,
      key: 'total_materials',
      width: 150,
      align: 'right',
      render: (_: unknown, record: CostRow) => {
        const totalMaterials = record.materials_cost + record.sub_materials_cost + record.materials_comp_cost;
        return (
          <Text style={{ color: '#059669' }}>
            {totalMaterials.toLocaleString('ru-RU', { minimumFractionDigits: 0 })}
          </Text>
        );
      },
    },
  ];

  // Колонка итого
  const totalColumn: ColumnsType<CostRow> = [
    {
      title: <div style={{ textAlign: 'center' }}>Итого</div>,
      dataIndex: 'total_cost',
      key: 'total_cost',
      width: 120,
      align: 'right',
      fixed: 'right',
      render: (value: number) => (
        <Text strong style={{ color: '#10b981' }}>
          {value.toLocaleString('ru-RU', { minimumFractionDigits: 0 })}
        </Text>
      ),
    },
  ];

  // Упрощенные колонки для simplified режима
  const simplifiedColumns: ColumnsType<CostRow> = [
    {
      title: <div style={{ textAlign: 'center' }}>Итого</div>,
      dataIndex: 'total_cost',
      key: 'total_cost',
      width: 150,
      align: 'right',
      render: (value: number) => (
        <Text strong style={{ color: '#10b981' }}>
          {value.toLocaleString('ru-RU', { minimumFractionDigits: 0 })}
        </Text>
      ),
    },
    {
      title: <div style={{ textAlign: 'center' }}>Итого за ед общей площади</div>,
      key: 'cost_per_total_area',
      width: 200,
      align: 'right',
      fixed: 'right',
      render: (_: unknown, record: CostRow) => {
        if (!areaSp) return '-';
        const costPerArea = record.total_cost / areaSp;
        return (
          <Text strong style={{ color: '#0891b2' }}>
            {costPerArea.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </Text>
        );
      },
    },
  ];

  // Собираем все колонки в зависимости от режима просмотра
  const columns: ColumnsType<CostRow> =
    viewMode === 'simplified'
      ? [
          baseColumns[0], // Категория
          baseColumns[1], // Вид
          baseColumns[2], // Локализация
          ...simplifiedColumns,
        ]
      : [
          ...baseColumns,
          ...(viewMode === 'detailed' ? detailedColumns : summaryColumns),
          ...totalColumn,
        ];

  // Вычисляем итоговую строку
  const totals = data.reduce(
    (acc, row) => ({
      materials: acc.materials + row.materials_cost,
      works: acc.works + row.works_cost,
      subMaterials: acc.subMaterials + row.sub_materials_cost,
      subWorks: acc.subWorks + row.sub_works_cost,
      materialsComp: acc.materialsComp + row.materials_comp_cost,
      worksComp: acc.worksComp + row.works_comp_cost,
      totalWorks: acc.totalWorks + row.works_cost + row.sub_works_cost + row.works_comp_cost,
      totalMaterials: acc.totalMaterials + row.materials_cost + row.sub_materials_cost + row.materials_comp_cost,
      total: acc.total + row.total_cost,
    }),
    { materials: 0, works: 0, subMaterials: 0, subWorks: 0, materialsComp: 0, worksComp: 0, totalWorks: 0, totalMaterials: 0, total: 0 }
  );

  return (
    <>
      <style>{`
        .category-row > td {
          background-color: ${theme === 'dark' ? '#3a3a2a' : '#f5f5dc'} !important;
        }
        .category-row:hover > td {
          background-color: ${theme === 'dark' ? '#4a4a3a' : '#ede9d0'} !important;
        }
      `}</style>
      <Spin spinning={loading}>
        <Table
          columns={columns}
          dataSource={data}
          pagination={false}
          size="small"
          scroll={{ y: 'calc(100vh - 340px)' }}
          bordered
          rowClassName={(record) => record.is_category ? 'category-row' : ''}
          expandable={{
            expandedRowKeys: expandedRowKeys,
            onExpandedRowsChange: (keys) => onExpandedRowsChange(keys as string[]),
            childrenColumnName: 'children',
            indentSize: 20,
          }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={viewMode === 'simplified' ? 3 : 6}>
                  <Text strong>Итого:</Text>
                </Table.Summary.Cell>
                {viewMode === 'simplified' ? (
                  <>
                    <Table.Summary.Cell index={3} align="right">
                      <Text strong style={{ color: '#10b981', fontSize: 16 }}>
                        {totals.total.toLocaleString('ru-RU', { minimumFractionDigits: 0 })}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right">
                      <Text strong style={{ color: '#0891b2', fontSize: 16 }}>
                        {areaSp ? (totals.total / areaSp).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '-'}
                      </Text>
                    </Table.Summary.Cell>
                  </>
                ) : viewMode === 'detailed' ? (
                  <>
                    <Table.Summary.Cell index={6} align="right">
                      <Text strong>{(totals.materials + totals.materialsComp).toLocaleString('ru-RU', { minimumFractionDigits: 0 })}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={7} align="right">
                      <Text strong>{(totals.works + totals.worksComp).toLocaleString('ru-RU', { minimumFractionDigits: 0 })}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={8} align="right">
                      <Text strong>{totals.subMaterials.toLocaleString('ru-RU', { minimumFractionDigits: 0 })}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={9} align="right">
                      <Text strong>{totals.subWorks.toLocaleString('ru-RU', { minimumFractionDigits: 0 })}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={10} align="right">
                      <Text strong style={{ color: '#10b981', fontSize: 16 }}>
                        {totals.total.toLocaleString('ru-RU', { minimumFractionDigits: 0 })}
                      </Text>
                    </Table.Summary.Cell>
                  </>
                ) : (
                  <>
                    <Table.Summary.Cell index={6} align="right">
                      <Text strong style={{ color: '#0891b2' }}>
                        {Math.round(totals.totalWorks).toLocaleString('ru-RU')}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={7} align="right">
                      <Text strong style={{ color: '#059669' }}>
                        {totals.totalMaterials.toLocaleString('ru-RU', { minimumFractionDigits: 0 })}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={8} align="right">
                      <Text strong style={{ color: '#10b981', fontSize: 16 }}>
                        {totals.total.toLocaleString('ru-RU', { minimumFractionDigits: 0 })}
                      </Text>
                    </Table.Summary.Cell>
                  </>
                )}
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </Spin>
    </>
  );
};

export default CostTable;
