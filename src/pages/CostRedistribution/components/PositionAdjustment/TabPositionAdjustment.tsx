import { memo, useMemo } from 'react';
import { Button, Card, Col, Empty, List, Row, Space, Tag, Typography, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { AdjustmentControls } from './AdjustmentControls';
import { PositionsBlock } from './PositionsBlock';
import { buildBlockRows } from './blockRows';
import type { ResultRow } from '../Results/ResultsTableColumns';
import type { UsePositionAdjustmentReturn } from '../../hooks/usePositionAdjustment';
import type { ClientPosition } from '../../hooks';
import type {
  PositionAdjustmentMode,
  PositionAdjustmentRule,
} from '../../types/positionAdjustment';

const { Text } = Typography;

const MODE_LABEL: Record<PositionAdjustmentMode, string> = {
  deduct: 'Снижение',
  transfer: 'Перераспределение',
  add: 'Увеличение',
};

const MODE_COLOR: Record<PositionAdjustmentMode, string> = {
  deduct: 'red',
  transfer: 'blue',
  add: 'green',
};

function formatAmount(value: number): string {
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function iterationSummary(rule: PositionAdjustmentRule): string {
  if (rule.mode === 'transfer') {
    return `${rule.sourceIds.length} → ${rule.targetIds.length} строк`;
  }
  const count = rule.mode === 'deduct' ? rule.sourceIds.length : rule.targetIds.length;
  return `${count} строк`;
}

interface TabPositionAdjustmentProps {
  clientPositions: ClientPosition[];
  baseRows: ResultRow[];
  adjustment: UsePositionAdjustmentReturn;
}

function TabPositionAdjustmentImpl({
  clientPositions,
  baseRows,
  adjustment,
}: TabPositionAdjustmentProps) {
  const {
    draft,
    appliedRules,
    appliedDeltas,
    previewDeltas,
    previewErrors,
    setMode,
    setAmount,
    setSourceIds,
    setTargetIds,
    apply,
    removeIteration,
    reset,
  } = adjustment;

  const blockRows = useMemo(
    () => buildBlockRows(baseRows, previewDeltas, appliedDeltas),
    [baseRows, previewDeltas, appliedDeltas]
  );

  const handleApply = () => {
    const errors = apply();
    if (errors.length === 0) {
      message.success(`Итерация ${appliedRules.length + 1} применена`);
    } else {
      message.warning('Проверьте параметры операции');
    }
  };

  if (baseRows.length === 0) {
    return (
      <Empty
        description={
          <Space direction="vertical" size={4}>
            <Text strong>Нет строк для перераспределения</Text>
            <Text type="secondary">Выберите тендер со строками Заказчика.</Text>
          </Space>
        }
      />
    );
  }

  const showSource = draft.mode === 'deduct' || draft.mode === 'transfer';
  const showTarget = draft.mode === 'add' || draft.mode === 'transfer';

  const sourceSet = draft.sourceIds;
  const targetSet = draft.targetIds;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {appliedRules.length > 0 && (
        <Card
          size="small"
          title={
            <Space>
              <Text strong>Применённые итерации</Text>
              <Tag color="purple">{appliedRules.length}</Tag>
            </Space>
          }
          extra={
            <Button danger size="small" onClick={reset}>
              Сбросить все
            </Button>
          }
          styles={{ body: { padding: 0 } }}
        >
          <List
            size="small"
            dataSource={appliedRules}
            renderItem={(rule, index) => (
              <List.Item
                actions={[
                  <Button
                    key="remove"
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => removeIteration(index)}
                  />,
                ]}
              >
                <Space size="middle">
                  <Text strong>#{index + 1}</Text>
                  <Tag color={MODE_COLOR[rule.mode]}>{MODE_LABEL[rule.mode]}</Tag>
                  <Text>{formatAmount(rule.amount)} ₽</Text>
                  <Text type="secondary">{iterationSummary(rule)}</Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      )}

      <AdjustmentControls
        mode={draft.mode}
        amount={draft.amount}
        errors={previewErrors}
        hasApplied={appliedRules.length > 0}
        onModeChange={setMode}
        onAmountChange={setAmount}
        onApply={handleApply}
        onReset={reset}
      />

      <Row gutter={16}>
        {showSource && (
          <Col xs={24} lg={showTarget ? 12 : 24}>
            <PositionsBlock
              title="Откуда (источник)"
              rows={blockRows}
              selectedIds={sourceSet}
              disabledIds={draft.mode === 'transfer' ? targetSet : undefined}
              clientPositions={clientPositions}
              onSelectionChange={setSourceIds}
            />
          </Col>
        )}
        {showTarget && (
          <Col xs={24} lg={showSource ? 12 : 24}>
            <PositionsBlock
              title="Куда (получатель)"
              rows={blockRows}
              selectedIds={targetSet}
              disabledIds={draft.mode === 'transfer' ? sourceSet : undefined}
              clientPositions={clientPositions}
              onSelectionChange={setTargetIds}
            />
          </Col>
        )}
      </Row>
    </Space>
  );
}

// Вкладка рендерится каждый тик autosave/nonce главной страницы; memo
// отсекает ре-рендеры, пока baseRows/adjustment стабильны по ссылке
// (adjustment стабилизирован useMemo внутри usePositionAdjustment).
export const TabPositionAdjustment = memo(TabPositionAdjustmentImpl);
