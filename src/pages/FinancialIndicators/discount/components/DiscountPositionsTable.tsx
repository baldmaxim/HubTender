import { memo, useMemo } from 'react';
import { Button, Card, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { collectSectionDescendants } from '../../../../utils/positions/collectSectionDescendants';
import type { PositionWithCostsRow } from '../../../../lib/api/positions';
import type { DiscountPositionRow } from '../utils/positionRows';

const { Text } = Typography;

const formatMoney = (value: number): string =>
  value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface DiscountPositionsTableProps {
  rows: DiscountPositionRow[];
  /** Порядок позиций как в БД — нужен, чтобы клик по разделу забрал потомков. */
  positions: PositionWithCostsRow[];
  selectedIds: Set<string>;
  disabled: boolean;
  onSelectionChange: (next: Set<string>) => void;
}

function DiscountPositionsTableImpl({
  rows,
  positions,
  selectedIds,
  disabled,
  onSelectionChange,
}: DiscountPositionsTableProps) {
  // Что можно выбрать. Set, а не массив: getCheckboxProps зовётся на каждую строку.
  //
  // Листовые строки — только с ненулёвой остаточной снижаемой стоимостью:
  // выбирать полностью снижённую или чисто-материальную строку смысла нет.
  //
  // Нелистовые строки (разделы) собственных BOQ-элементов не имеют, их
  // reducible = 0. Но раздел должен быть кликабельным, если внутри его
  // подчинения есть хоть одна снижаемая строка — тогда клик выберет их все,
  // как на «Перераспределении» (тот же collectSectionDescendants).
  const selectableIds = useMemo(() => {
    const directlyReducible = new Set(
      rows.filter((row) => row.reducible - row.alreadyReduced > 0.01).map((row) => row.positionId),
    );
    const set = new Set(directlyReducible);
    for (const row of rows) {
      if (row.isLeaf) continue;
      for (const id of collectSectionDescendants(positions, row.positionId)) {
        if (directlyReducible.has(id)) {
          set.add(row.positionId);
          break;
        }
      }
    }
    return set;
  }, [rows, positions]);

  const allSelected =
    selectableIds.size > 0 && [...selectableIds].every((id) => selectedIds.has(id));

  const totals = useMemo(() => {
    let selectedRemaining = 0;
    for (const row of rows) {
      if (selectedIds.has(row.positionId)) {
        selectedRemaining += Math.max(0, row.reducible - row.alreadyReduced);
      }
    }
    return { selectedRemaining, count: selectedIds.size };
  }, [rows, selectedIds]);

  // Колонки чисто презентационные: новая ссылка массива заставила бы Ant Table
  // считать схему изменившейся и ремоунтить header/ячейки на каждый ввод суммы.
  const columns = useMemo<ColumnsType<DiscountPositionRow>>(
    () => [
      { title: '№', dataIndex: 'positionNumber', key: 'positionNumber', width: 56, align: 'center' },
      {
        title: 'Наименование',
        key: 'name',
        render: (_, record) => {
          const itemNoColor = record.isLeaf ? '#52c41a' : '#ff7875';
          const inner = (
            <div
              style={{
                paddingLeft: record.isAdditional ? 16 : 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {record.isAdditional && (
                <Tag color="orange" style={{ marginRight: 6 }}>
                  ДОП
                </Tag>
              )}
              {record.itemNo && (
                <span style={{ marginRight: 6, color: itemNoColor, fontWeight: 600 }}>
                  {record.itemNo}
                </span>
              )}
              <span
                style={{
                  fontWeight: record.isLeaf ? undefined : 700,
                  fontFamily: record.isLeaf ? undefined : 'Georgia, "Times New Roman", serif',
                }}
              >
                {record.workName}
              </span>
            </div>
          );
          return <Tooltip title={record.workName}>{inner}</Tooltip>;
        },
      },
      {
        title: 'Доступно к снижению',
        key: 'remaining',
        width: 170,
        align: 'right',
        render: (_, record) => formatMoney(Math.max(0, record.reducible - record.alreadyReduced)),
      },
      {
        title: 'Уже снижено',
        dataIndex: 'alreadyReduced',
        key: 'alreadyReduced',
        width: 150,
        align: 'right',
        render: (value: number) =>
          value > 0 ? (
            <span style={{ color: '#cf1322', fontWeight: 500 }}>{`−${formatMoney(value)}`}</span>
          ) : (
            <Text type="secondary">—</Text>
          ),
      },
    ],
    [],
  );

  const rowSelection = {
    columnWidth: 40,
    selectedRowKeys: Array.from(selectedIds),
    // Клик по разделу забирает все его дочерние строки — общая утилита с
    // Перераспределением, чтобы «раздел» означал одно и то же на обеих страницах.
    onSelect: (record: DiscountPositionRow, selected: boolean) => {
      const ids = collectSectionDescendants(positions, record.positionId);
      const next = new Set(selectedIds);
      for (const id of ids) {
        if (!selectableIds.has(id)) continue;
        if (selected) next.add(id);
        else next.delete(id);
      }
      onSelectionChange(next);
    },
    onSelectAll: (selected: boolean) => {
      onSelectionChange(selected ? new Set(selectableIds) : new Set());
    },
    getCheckboxProps: (record: DiscountPositionRow) => ({
      disabled: disabled || !selectableIds.has(record.positionId),
    }),
  };

  return (
    <>
      {/* Фиксированная высота строк тела — обязательное условие для virtual:
          переменная высота запускает петлю переизмерения rc-virtual-list
          (collectHeight → syncScrollTop), см. ResultsTable/PositionsBlock. */}
      <style>{`
        .fi-discount-positions .ant-table-tbody .ant-table-cell { height: 34px; overflow: hidden; }
      `}</style>
      <Card
        size="small"
        className="fi-discount-positions"
        title={
          <Space wrap>
            <Text strong>Строки Заказчика</Text>
            <Button
              size="small"
              disabled={disabled || selectableIds.size === 0}
              onClick={() => onSelectionChange(allSelected ? new Set() : new Set(selectableIds))}
            >
              {allSelected ? 'Снять все' : 'Выбрать все'}
            </Button>
            <Button
              size="small"
              disabled={disabled || selectedIds.size === 0}
              onClick={() => onSelectionChange(new Set())}
            >
              Очистить
            </Button>
          </Space>
        }
        styles={{ body: { padding: 0 } }}
      >
        <Table<DiscountPositionRow>
          size="small"
          rowKey="positionId"
          columns={columns}
          dataSource={rows}
          rowSelection={rowSelection}
          pagination={false}
          scroll={{ y: 460 }}
          virtual
          summary={() => (
            <Table.Summary fixed="bottom">
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2} align="right">
                  <Text strong>{`Выбрано строк: ${totals.count}`}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <Text strong>{formatMoney(totals.selectedRemaining)}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">
                  <Text type="secondary">—</Text>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </Card>
    </>
  );
}

export const DiscountPositionsTable = memo(DiscountPositionsTableImpl);
