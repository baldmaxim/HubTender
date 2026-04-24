import { useMemo } from 'react';
import { Col, Empty, Row, Space, Typography, message } from 'antd';
import { AdjustmentControls } from './AdjustmentControls';
import { PositionsBlock } from './PositionsBlock';
import { buildBlockRows } from './blockRows';
import type { ResultRow } from '../Results/ResultsTableColumns';
import type { UsePositionAdjustmentReturn } from '../../hooks/usePositionAdjustment';
import type { ClientPosition } from '../../hooks';

const { Text } = Typography;

interface TabPositionAdjustmentProps {
  clientPositions: ClientPosition[];
  baseRows: ResultRow[];
  adjustment: UsePositionAdjustmentReturn;
}

export function TabPositionAdjustment({
  clientPositions,
  baseRows,
  adjustment,
}: TabPositionAdjustmentProps) {
  const {
    draft,
    appliedRule,
    previewDeltas,
    previewErrors,
    setMode,
    setAmount,
    setSourceIds,
    setTargetIds,
    apply,
    reset,
  } = adjustment;

  const blockRows = useMemo(
    () => buildBlockRows(baseRows, previewDeltas),
    [baseRows, previewDeltas]
  );

  const handleApply = () => {
    const errors = apply();
    if (errors.length === 0) {
      message.success('Корректировка применена к таблице результатов');
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
            <Text type="secondary">
              Выберите тендер со строками Заказчика.
            </Text>
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
      <AdjustmentControls
        mode={draft.mode}
        amount={draft.amount}
        errors={previewErrors}
        hasApplied={appliedRule !== null}
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
