// Панель ИИ-разбора на странице: сколько разобрано, запуск, скрытие «похоже на норму».
import { FC } from 'react';
import { Button, Card, Space, Switch, Tag, Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import type { TenderAIAssessments } from '../../../lib/api/verificationAI';
import { availabilityText, type AICounts } from '../../../lib/quality/aiTriagePolicy';

const { Text } = Typography;

interface IAITriageBarProps {
  data: TenderAIAssessments | null;
  counts: AICounts;
  total: number;
  starting: boolean;
  hideLikelyOk: boolean;
  onHideLikelyOkChange: (v: boolean) => void;
  onStart: () => void;
  isPhone: boolean;
}

export const AITriageBar: FC<IAITriageBarProps> = ({
  data, counts, total, starting, hideLikelyOk, onHideLikelyOkChange, onStart, isPhone,
}) => {
  if (!data) return null;
  const unavailable = availabilityText(data.availability);
  // Выключенный разбор без единой оценки — панель не нужна.
  if (unavailable && counts.assessed === 0) return null;

  return (
    <Card size="small">
      <Space direction={isPhone ? 'vertical' : 'horizontal'} size={12} wrap style={{ width: '100%' }}>
        <Space size={6} wrap>
          <RobotOutlined />
          <Text strong>ИИ-разбор</Text>
          <Text type="secondary">
            оценено {counts.assessed} из {total}
          </Text>
          {counts.error > 0 && <Tag color="red">похоже на ошибку: {counts.error}</Tag>}
          {counts.ok > 0 && <Tag color="green">похоже на норму: {counts.ok}</Tag>}
          {counts.unsure > 0 && <Tag>не уверен: {counts.unsure}</Tag>}
          {data.running && <Tag color="processing">идёт разбор…</Tag>}
        </Space>
        <Space size={8} wrap>
          <Switch size="small" checked={hideLikelyOk} onChange={onHideLikelyOkChange} />
          <Text>Скрыть «похоже на норму»</Text>
        </Space>
        {unavailable ? (
          <Text type="secondary">{unavailable}</Text>
        ) : (
          <Button
            size="small"
            icon={<RobotOutlined />}
            loading={starting || data.running}
            onClick={onStart}
          >
            Разобрать новые находки
          </Button>
        )}
      </Space>
    </Card>
  );
};
