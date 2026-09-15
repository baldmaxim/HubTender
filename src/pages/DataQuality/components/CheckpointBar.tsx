import React from 'react';
import { Alert, Button, Card, Popconfirm, Space, Switch, Tag, Typography } from 'antd';
import { FlagOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { QualityReport } from '../../../lib/api/quality';

const { Text } = Typography;

interface Props {
  report: QualityReport;
  newCount: number;
  showOnlyNew: boolean;
  onShowOnlyNewChange: (v: boolean) => void;
  checkpointing: boolean;
  onCheckpoint: () => void;
  isPhone: boolean;
}

/**
 * Цикл проверки: «Проверка завершена» фиксирует момент, после которого находки
 * считаются новыми. Так при следующем заходе видна только дельта, а уже
 * просмотренное не приходится пересматривать.
 */
export const CheckpointBar: React.FC<Props> = ({
  report,
  newCount,
  showOnlyNew,
  onShowOnlyNewChange,
  checkpointing,
  onCheckpoint,
  isPhone,
}) => {
  if (!report.history_available) {
    return (
      <Alert
        type="info"
        showIcon
        message="История находок недоступна — новые находки не отмечаются."
      />
    );
  }

  const checkpoint = report.checkpoint_at
    ? dayjs(report.checkpoint_at).format('DD.MM.YYYY HH:mm')
    : null;

  return (
    <Card size="small">
      <Space direction={isPhone ? 'vertical' : 'horizontal'} size={12} wrap style={{ width: '100%' }}>
        <Text type="secondary">
          {checkpoint ? `Проверка завершена: ${checkpoint}` : 'Проверка ещё не отмечалась завершённой'}
        </Text>
        {checkpoint && (
          <Tag color={newCount > 0 ? 'magenta' : 'green'}>Новых с отметки: {newCount}</Tag>
        )}
        {checkpoint && (
          <Space size={8}>
            <Switch checked={showOnlyNew} onChange={onShowOnlyNewChange} size="small" />
            <Text>Только новые</Text>
          </Space>
        )}
        <Popconfirm
          title="Отметить проверку завершённой?"
          description="Всё найденное сейчас будет считаться просмотренным. Новыми станут только находки, появившиеся после этого момента."
          okText="Отметить"
          cancelText="Отмена"
          onConfirm={onCheckpoint}
        >
          <Button icon={<FlagOutlined />} loading={checkpointing}>
            Проверка завершена
          </Button>
        </Popconfirm>
      </Space>
    </Card>
  );
};
