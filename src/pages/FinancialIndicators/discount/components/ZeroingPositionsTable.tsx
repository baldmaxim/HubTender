import { memo, useMemo, type ReactNode } from 'react';
import { Button, Card, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { collectSectionDescendants } from '../../../../utils/positions/collectSectionDescendants';
import type { PositionWithCostsRow } from '../../../../lib/api/positions';
import type { ZeroingPositionRow } from '../utils/positionRows';

const { Text } = Typography;

const formatMoney = (value: number): string =>
  value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ZeroingPositionsTableProps {
  rows: ZeroingPositionRow[];
  /** Порядок позиций как в БД — для выбора раздела по клику. */
  positions: PositionWithCostsRow[];
  selectedIds: Set<string>;
  disabled: boolean;
  onSelectionChange: (next: Set<string>) => void;
  /** Правый угол шапки (кнопка «Сохранить»). */
  extra?: ReactNode;
}

function ZeroingPositionsTableImpl({
  rows,
  positions,
  selectedIds,
  disabled,
  onSelectionChange,
  extra,
}: ZeroingPositionsTableProps) {
  const allIds = useMemo(() => rows.map((r) => r.positionId), [rows]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));

  const totals = useMemo(() => {
    let selectedSum = 0;
    for (const row of rows) if (selectedIds.has(row.positionId)) selectedSum += row.commercial;
    return { selectedSum, count: selectedIds.size };
  }, [rows, selectedIds]);

  const columns = useMemo<ColumnsType<ZeroingPositionRow>>(
    () => [
      { title: '№', dataIndex: 'positionNumber', key: 'positionNumber', width: 56, align: 'center' },
      {
        title: 'Наименование',
        key: 'name',
        render: (_, record) => {
          const itemNoColor = record.isLeaf ? '#52c41a' : '#ff7875';
          const inner = (
            <div style={{ paddingLeft: record.isAdditional ? 16 : 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {record.isAdditional && <Tag color="orange" style={{ marginRight: 6 }}>ДОП</Tag>}
              {record.itemNo && <span style={{ marginRight: 6, color: itemNoColor, fontWeight: 600 }}>{record.itemNo}</span>}
              <span style={{ fontWeight: record.isLeaf ? undefined : 700, fontFamily: record.isLeaf ? undefined : 'Georgia, "Times New Roman", serif' }}>
                {record.workName}
              </span>
            </div>
          );
          return <Tooltip title={record.workName}>{inner}</Tooltip>;
        },
      },
      {
        title: 'Полная стоимость',
        dataIndex: 'commercial',
        key: 'commercial',
        width: 180,
        align: 'right',
        render: (value: number) => formatMoney(value),
      },
    ],
    [],
  );

  const rowSelection = {
    columnWidth: 40,
    selectedRowKeys: Array.from(selectedIds),
    // Клик по разделу забирает все его дочерние строки (общая утилита).
    onSelect: (record: ZeroingPositionRow, selected: boolean) => {
      const ids = collectSectionDescendants(positions, record.positionId);
      const next = new Set(selectedIds);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      onSelectionChange(next);
    },
    onSelectAll: (selected: boolean) => {
      onSelectionChange(selected ? new Set(allIds) : new Set());
    },
    getCheckboxProps: () => ({ disabled }),
  };

  return (
    <>
      {/* Фикс. высота строк — обязательна для virtual (петля переизмерения). */}
      <style>{`.fi-zeroing-positions .ant-table-tbody .ant-table-cell { height: 34px; overflow: hidden; }`}</style>
      <Card
        size="small"
        className="fi-zeroing-positions"
        title={
          <Space wrap>
            <Text strong>Строки для обнуления</Text>
            <Button size="small" disabled={disabled || allIds.length === 0} onClick={() => onSelectionChange(allSelected ? new Set() : new Set(allIds))}>
              {allSelected ? 'Снять все' : 'Выбрать все'}
            </Button>
            <Button size="small" disabled={disabled || selectedIds.size === 0} onClick={() => onSelectionChange(new Set())}>
              Очистить
            </Button>
          </Space>
        }
        extra={extra}
        styles={{ body: { padding: 0 } }}
      >
        <Table<ZeroingPositionRow>
          size="small"
          rowKey="positionId"
          columns={columns}
          dataSource={rows}
          rowSelection={rowSelection}
          pagination={false}
          scroll={{ y: 600 }}
          virtual
          summary={() => (
            <Table.Summary fixed="bottom">
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2} align="right">
                  <Text strong>{`Выбрано строк: ${totals.count}`}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <Text strong>{formatMoney(totals.selectedSum)}</Text>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </Card>
    </>
  );
}

export const ZeroingPositionsTable = memo(ZeroingPositionsTableImpl);
