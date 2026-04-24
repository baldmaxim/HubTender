import { Alert, Button, InputNumber, Radio, Space, Typography } from 'antd';
import type { RadioChangeEvent } from 'antd';
import type {
  PositionAdjustmentMode,
  PositionAdjustmentValidationError,
} from '../../types/positionAdjustment';

const { Text } = Typography;

interface AdjustmentControlsProps {
  mode: PositionAdjustmentMode;
  amount: number;
  errors: PositionAdjustmentValidationError[];
  hasApplied: boolean;
  onModeChange: (mode: PositionAdjustmentMode) => void;
  onAmountChange: (amount: number) => void;
  onApply: () => void;
  onReset: () => void;
}

export function AdjustmentControls({
  mode,
  amount,
  errors,
  hasApplied,
  onModeChange,
  onAmountChange,
  onApply,
  onReset,
}: AdjustmentControlsProps) {
  const handleModeChange = (event: RadioChangeEvent) => {
    onModeChange(event.target.value as PositionAdjustmentMode);
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space size="large" wrap align="center">
        <Radio.Group value={mode} onChange={handleModeChange}>
          <Radio value="deduct">Снижение цены</Radio>
          <Radio value="transfer">Перераспределение</Radio>
          <Radio value="add">Увеличение цены</Radio>
        </Radio.Group>

        <Space>
          <Text>Сумма операции:</Text>
          <InputNumber
            min={0}
            step={1000}
            value={amount}
            style={{ width: 200 }}
            formatter={(value) => {
              const str = String(value ?? '');
              return str.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
            }}
            parser={(value) => Number(String(value ?? '').replace(/\s/g, ''))}
            onChange={(value) => onAmountChange(Number(value ?? 0))}
            addonAfter="₽"
          />
        </Space>

        <Button type="primary" onClick={onApply}>
          Применить
        </Button>
        <Button onClick={onReset} disabled={!hasApplied && amount === 0}>
          Сбросить
        </Button>
      </Space>

      {errors.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="Правило не применено"
          description={
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {errors.map((error) => (
                <li key={error.code}>{error.message}</li>
              ))}
            </ul>
          }
        />
      )}
    </Space>
  );
}
