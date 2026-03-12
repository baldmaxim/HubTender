/**
 * Компонент управления сопоставлением
 */

import { Space, Button, Radio, Tooltip } from 'antd';
import type { RadioChangeEvent } from 'antd';
import {
  CheckCircleOutlined,
  CheckSquareOutlined,
  QuestionCircleOutlined,
  SwapOutlined,
  StarOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { VersionMatchState } from '../types';

interface MatchControlsProps {
  filter: VersionMatchState['filter'];
  onFilterChange: (filter: VersionMatchState['filter']) => void;
  onAutoMatch: () => void;
  onAcceptAllLowConfidence?: () => void;
  autoMatchDisabled?: boolean;
  acceptAllDisabled?: boolean;
  loading?: boolean;
}

/**
 * Компонент для управления фильтрацией и действиями
 *
 * Функции:
 * - Фильтрация отображаемых позиций
 * - Запуск автоматического сопоставления
 */
export function MatchControls({
  filter,
  onFilterChange,
  onAutoMatch,
  onAcceptAllLowConfidence,
  autoMatchDisabled = false,
  acceptAllDisabled = true,
  loading = false,
}: MatchControlsProps) {
  const handleFilterChange = (e: RadioChangeEvent) => {
    onFilterChange(e.target.value as VersionMatchState['filter']);
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {/* Кнопка автоматического сопоставления */}
      <Space>
        <Tooltip title="Выполнить автоматическое сопоставление на основе алгоритма схожести">
          <Button
            type="primary"
            icon={<SwapOutlined />}
            onClick={onAutoMatch}
            disabled={autoMatchDisabled}
            loading={loading}
            size="large"
          >
            Автоматическое сопоставление
          </Button>
        </Tooltip>

        {onAcceptAllLowConfidence && (
          <Tooltip title="Принять все строки с низкой уверенностью для переноса данных">
            <Button
              icon={<CheckSquareOutlined />}
              onClick={onAcceptAllLowConfidence}
              disabled={acceptAllDisabled}
              loading={loading}
              size="large"
            >
              Сопоставить все
            </Button>
          </Tooltip>
        )}
      </Space>

      {/* Фильтры отображения */}
      <Radio.Group
        value={filter}
        onChange={handleFilterChange}
        buttonStyle="solid"
        size="middle"
      >
        <Radio.Button value="all">
          <StarOutlined /> Все позиции
        </Radio.Button>

        <Radio.Button value="matched">
          <CheckCircleOutlined /> Сопоставленные
        </Radio.Button>

        <Radio.Button value="low_confidence">
          <WarningOutlined /> Низкая уверенность (&lt;80%)
        </Radio.Button>

        <Radio.Button value="unmatched">
          <QuestionCircleOutlined /> Несопоставленные
        </Radio.Button>
      </Radio.Group>
    </Space>
  );
}
