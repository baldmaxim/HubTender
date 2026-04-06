/**
 * Таблица коммерческих стоимостей позиций
 */

import { Table, Typography, Tag, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { PositionWithCommercialCost } from '../types';
import { formatCommercialCost } from '../../../utils/markupCalculator';

const { Text } = Typography;

interface CommerceTableProps {
  positions: PositionWithCommercialCost[];
  selectedTenderId: string | undefined;
  onNavigateToPosition: (positionId: string) => void;
  referenceTotal: number;
  insuranceTotal?: number;
}

export default function CommerceTable({
  positions,
  selectedTenderId,
  onNavigateToPosition,
  referenceTotal,
  insuranceTotal = 0,
}: CommerceTableProps) {
  // Определение конечной позиции (листового узла) на основе иерархии
  const isLeafPosition = (record: PositionWithCommercialCost, index: number): boolean => {
    // Дополнительные работы всегда листовые
    if (record.is_additional) {
      return true;
    }

    // Последняя строка всегда конечная
    if (index === positions.length - 1) {
      return true;
    }

    const currentLevel = record.hierarchy_level || 0;

    // Пропускаем дополнительные работы при поиске следующей позиции
    let nextIndex = index + 1;
    while (nextIndex < positions.length && positions[nextIndex].is_additional) {
      nextIndex++;
    }

    // Если после пропуска доп. работ позиций не осталось — это листовой узел
    if (nextIndex >= positions.length) {
      return true;
    }

    const nextLevel = positions[nextIndex].hierarchy_level || 0;

    // Если текущий уровень >= следующего, значит это листовой узел
    return currentLevel >= nextLevel;
  };

  const columns: ColumnsType<PositionWithCommercialCost> = [
    {
      title: 'Наименование',
      key: 'work_name',
      width: 350,
      render: (_, record, index) => {
        const isLeaf = isLeafPosition(record, index);
        const itemNoColor = isLeaf ? '#52c41a' : '#ff7875';
        const paddingLeft = record.is_additional ? 20 : 0;

        return (
          <div
            style={{
              paddingLeft,
              cursor: isLeaf ? 'pointer' : 'default',
            }}
            onClick={() => {
              if (isLeaf && selectedTenderId) {
                onNavigateToPosition(record.id);
              }
            }}
          >
            <div style={{ fontWeight: 500 }}>
              {record.is_additional ? (
                <Tag color="orange" style={{ marginRight: 8 }}>
                  ДОП
                </Tag>
              ) : record.position_number ? (
                <Tag color="blue" style={{ marginRight: 8 }}>
                  {record.position_number}
                </Tag>
              ) : null}
              {record.item_no && (
                <span style={{ marginRight: 8, color: itemNoColor, fontWeight: 600 }}>
                  {record.item_no}
                </span>
              )}
              <span style={{ textDecoration: isLeaf ? 'underline' : 'none' }}>
                {record.work_name}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      title: 'Кол-во',
      key: 'volume',
      width: 100,
      render: (_, record) => {
        const gpVolume = record.manual_volume || 0;
        const clientVolume = record.volume || 0;
        const volumesMatch = gpVolume === clientVolume && gpVolume > 0;

        return (
          <div>
            <div style={{ color: volumesMatch ? '#ff4d4f' : undefined, fontWeight: volumesMatch ? 600 : undefined }}>
              {gpVolume} {record.unit_code || ''}
            </div>
            <div style={{ fontSize: '11px', color: '#999' }}>
              {clientVolume} {record.unit_code || ''}
            </div>
          </div>
        );
      },
    },
    {
      title: 'Цена за единицу',
      key: 'per_unit',
      width: 150,
      align: 'right',
      render: (_, record) => {
        if (!record.manual_volume || record.manual_volume === 0) return '-';
        const perUnit = (record.commercial_total || 0) / record.manual_volume;
        return (
          <Text type="secondary">
            {formatCommercialCost(perUnit)}
          </Text>
        );
      },
    },
    {
      title: 'Цена за единицу материалов, Руб.',
      key: 'per_unit_material',
      width: 130,
      align: 'right',
      render: (_, record) => {
        if (!record.manual_volume || record.manual_volume === 0) return '-';
        const perUnitMaterial = (record.material_cost_total || 0) / record.manual_volume;
        return (
          <Text type="secondary" style={{ color: '#1890ff' }}>
            {formatCommercialCost(perUnitMaterial)}
          </Text>
        );
      },
    },
    {
      title: 'Цена за единицу работ, Руб.',
      key: 'per_unit_work',
      width: 130,
      align: 'right',
      render: (_, record) => {
        if (!record.manual_volume || record.manual_volume === 0) return '-';
        const perUnitWork = (record.work_cost_total || 0) / record.manual_volume;
        return (
          <Text type="secondary" style={{ color: '#52c41a' }}>
            {formatCommercialCost(perUnitWork)}
          </Text>
        );
      },
    },
    {
      title: 'Базовая стоимость',
      key: 'base_total',
      width: 140,
      align: 'right',
      render: (_, record) => (
        <Text>{formatCommercialCost(record.base_total || 0)}</Text>
      ),
    },
    {
      title: 'Итого материалов (КП), руб',
      key: 'material_cost_total',
      width: 160,
      align: 'right',
      render: (_, record) => {
        const materialCost = record.material_cost_total || 0;
        const total = record.commercial_total || 0;
        const percentage = total > 0 ? ((materialCost / total) * 100).toFixed(1) : '0.0';

        return (
          <div>
            <Text>{formatCommercialCost(materialCost)}</Text>
            <div style={{ fontSize: '10px', color: '#1890ff', fontWeight: 500 }}>
              ({percentage}%)
            </div>
          </div>
        );
      },
    },
    {
      title: 'Итого работ (КП), руб',
      key: 'work_cost_total',
      width: 160,
      align: 'right',
      render: (_, record) => {
        const workCost = record.work_cost_total || 0;
        const total = record.commercial_total || 0;
        const percentage = total > 0 ? ((workCost / total) * 100).toFixed(1) : '0.0';

        return (
          <div>
            <Text>{formatCommercialCost(workCost)}</Text>
            <div style={{ fontSize: '10px', color: '#52c41a', fontWeight: 500 }}>
              ({percentage}%)
            </div>
          </div>
        );
      },
    },
    {
      title: 'Коммерческая стоимость',
      key: 'commercial_total',
      width: 160,
      align: 'right',
      render: (_, record) => (
        <Text strong style={{ color: '#52c41a' }}>
          {formatCommercialCost(record.commercial_total || 0)}
        </Text>
      ),
    },
    {
      title: 'Коэфф.',
      key: 'markup',
      width: 100,
      align: 'center',
      render: (_, record) => {
        const coefficient = record.markup_percentage || 1;
        const color = coefficient > 1 ? 'green' : coefficient < 1 ? 'red' : 'default';
        return (
          <Tag color={color}>
            {coefficient.toFixed(4)}
          </Tag>
        );
      },
    },
    {
      title: 'Примечание ГП',
      dataIndex: 'manual_note',
      key: 'manual_note',
      width: 200,
      responsive: ['lg'],
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={positions}
      rowKey="id"
      size="small"
      locale={{
        emptyText: <Empty description="Нет позиций заказчика" />
      }}
      pagination={false}
      scroll={{ y: 'calc(100vh - 360px)' }}
      summary={() => {
        const totalBase = positions.reduce((sum, pos) => sum + (pos.base_total || 0), 0);
        const totalMaterials = positions.reduce((sum, pos) => sum + (pos.material_cost_total || 0), 0);
        const totalWorks = positions.reduce((sum, pos) => sum + (pos.work_cost_total || 0), 0);
        const totalCommercial = positions.reduce((sum, pos) => sum + (pos.commercial_total || 0), 0);

        const materialPercent = totalCommercial > 0 ? ((totalMaterials / totalCommercial) * 100).toFixed(1) : '0.0';
        const workPercent = totalCommercial > 0 ? ((totalWorks / totalCommercial) * 100).toFixed(1) : '0.0';

        // Расчет итогового коэффициента наценки
        const totalMarkupCoefficient = totalBase > 0 ? totalCommercial / totalBase : 1;
        const markupColor = totalMarkupCoefficient > 1 ? 'green' : totalMarkupCoefficient < 1 ? 'red' : 'default';

        // Проверка соответствия базовой стоимости эталонной сумме из позиций заказчика
        const baseTotalMatches = Math.abs(totalBase - referenceTotal) < 0.01;
        const baseColor = baseTotalMatches ? '#52c41a' : '#ff4d4f';

        return (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={5}>
                <Text strong>Итого:</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right">
                <Text strong style={{ color: baseColor }}>{formatCommercialCost(totalBase)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right">
                <div>
                  <Text strong>{formatCommercialCost(totalMaterials)}</Text>
                  <div style={{ fontSize: '10px', color: '#1890ff', fontWeight: 500 }}>
                    ({materialPercent}%)
                  </div>
                </div>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={7} align="right">
                <div>
                  <Text strong>{formatCommercialCost(totalWorks)}</Text>
                  <div style={{ fontSize: '10px', color: '#52c41a', fontWeight: 500 }}>
                    ({workPercent}%)
                  </div>
                </div>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={8} align="right">
                <Text strong style={{ color: '#52c41a' }}>
                  {formatCommercialCost(totalCommercial)}
                </Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={9} align="center">
                <Tag color={markupColor}>
                  {totalMarkupCoefficient.toFixed(4)}
                </Tag>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={10} />
            </Table.Summary.Row>
            {insuranceTotal > 0 && (
              <Table.Summary.Row style={{ background: 'rgba(16,185,129,0.08)' }}>
                <Table.Summary.Cell index={0} colSpan={7}>
                  <Text strong style={{ color: '#10b981' }}>Страхование от судимостей:</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={7} align="right">
                  <Text strong style={{ color: '#10b981' }}>
                    + {formatCommercialCost(insuranceTotal)}
                  </Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={8} align="right">
                  <Text strong style={{ color: '#10b981' }}>
                    {formatCommercialCost(totalCommercial + insuranceTotal)}
                  </Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={9} />
                <Table.Summary.Cell index={10} />
              </Table.Summary.Row>
            )}
          </Table.Summary>
        );
      }}
    />
  );
}
