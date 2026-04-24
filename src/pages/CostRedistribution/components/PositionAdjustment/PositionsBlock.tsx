import { useMemo } from 'react';
import { Button, Card, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ClientPosition } from '../../hooks';
import { collectSectionDescendants } from '../../../../utils/positions/collectSectionDescendants';
import type { BlockRow } from './blockRows';

const { Text } = Typography;

interface PositionsBlockProps {
  title: string;
  rows: BlockRow[];
  selectedIds: Set<string>;
  disabledIds?: Set<string>;
  clientPositions: ClientPosition[];
  onSelectionChange: (next: Set<string>) => void;
}

function formatNumber(value: number): string {
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function DeltaCell({ value }: { value: number }) {
  if (!value) {
    return <Text type="secondary">—</Text>;
  }
  const color = value > 0 ? '#389e0d' : '#cf1322';
  const sign = value > 0 ? '+' : '';
  return <span style={{ color, fontWeight: 500 }}>{`${sign}${formatNumber(value)}`}</span>;
}

export function PositionsBlock({
  title,
  rows,
  selectedIds,
  disabledIds,
  clientPositions,
  onSelectionChange,
}: PositionsBlockProps) {
  const selectableIds = useMemo(() => {
    const disabled = disabledIds ?? new Set<string>();
    return rows.filter((row) => !disabled.has(row.position_id)).map((row) => row.position_id);
  }, [rows, disabledIds]);

  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  const totals = useMemo(() => {
    let selectedSum = 0;
    let deltaSum = 0;
    for (const row of rows) {
      if (selectedIds.has(row.position_id)) {
        selectedSum += row.total;
      }
      deltaSum += row.preview_delta;
    }
    return { selectedSum, deltaSum, count: selectedIds.size };
  }, [rows, selectedIds]);

  const handleSelectAll = () => {
    onSelectionChange(new Set(selectableIds));
  };

  const handleClear = () => {
    onSelectionChange(new Set());
  };

  const columns: ColumnsType<BlockRow> = [
    {
      title: '№',
      dataIndex: 'position_number',
      key: 'position_number',
      width: 60,
      align: 'center',
    },
    {
      title: 'Наименование',
      key: 'name',
      render: (_, record) => {
        const itemNoColor = record.isLeaf ? '#52c41a' : '#ff7875';
        const paddingLeft = record.is_additional ? 16 : 0;
        return (
          <div style={{ paddingLeft }}>
            {record.is_additional ? (
              <Tag color="orange" style={{ marginRight: 6 }}>
                ДОП
              </Tag>
            ) : record.section_number ? (
              <Tag color="blue" style={{ marginRight: 6 }}>
                {record.section_number}
              </Tag>
            ) : null}
            {record.item_no && (
              <span style={{ marginRight: 6, color: itemNoColor, fontWeight: 600 }}>
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
        );
      },
    },
    {
      title: 'Итого работы',
      dataIndex: 'total',
      key: 'total',
      width: 140,
      align: 'right',
      render: (value: number) => formatNumber(value),
    },
    {
      title: 'Δ',
      dataIndex: 'preview_delta',
      key: 'preview_delta',
      width: 140,
      align: 'right',
      render: (value: number) => <DeltaCell value={value} />,
    },
  ];

  const rowSelection = {
    selectedRowKeys: Array.from(selectedIds),
    onSelect: (record: BlockRow, selected: boolean) => {
      const ids = collectSectionDescendants(clientPositions, record.position_id);
      const disabled = disabledIds ?? new Set<string>();
      const next = new Set(selectedIds);
      for (const id of ids) {
        if (disabled.has(id)) continue;
        if (selected) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      onSelectionChange(next);
    },
    onSelectAll: (selected: boolean) => {
      if (selected) {
        handleSelectAll();
      } else {
        handleClear();
      }
    },
    getCheckboxProps: (record: BlockRow) => ({
      disabled: disabledIds?.has(record.position_id) ?? false,
    }),
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <Text strong>{title}</Text>
          <Button size="small" onClick={allSelected ? handleClear : handleSelectAll}>
            {allSelected ? 'Снять все' : 'Выбрать все'}
          </Button>
          <Button size="small" onClick={handleClear} disabled={selectedIds.size === 0}>
            Очистить
          </Button>
        </Space>
      }
      styles={{ body: { padding: 0 } }}
    >
      <Table<BlockRow>
        size="small"
        columns={columns}
        dataSource={rows}
        rowSelection={rowSelection}
        pagination={false}
        scroll={{ y: 520 }}
        summary={() => (
          <Table.Summary fixed="bottom">
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={2} align="right">
                <Text strong>Выбрано: {totals.count}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <Text strong>{formatNumber(totals.selectedSum)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">
                <DeltaCell value={totals.deltaSum} />
              </Table.Summary.Cell>
            </Table.Summary.Row>
          </Table.Summary>
        )}
      />
    </Card>
  );
}

