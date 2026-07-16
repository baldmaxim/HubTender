import { Alert, Button, Card, Descriptions, Space, Tag, Typography } from 'antd';
import { ApiOutlined, ReloadOutlined } from '@ant-design/icons';
import type { AiConnectionView } from '../../../lib/api/adminAi';
import {
  API_KEY_HINT,
  connectionStatusDisplay,
  keyUsageRows,
} from '../../../lib/quality/openRouterAdminPolicy';

const { Text } = Typography;

interface Props {
  connection: AiConnectionView | null;
  checking: boolean;
  onTestConnection: () => void;
}

/** §18.A: подключение OpenRouter. Поля ввода API key НЕТ по построению. */
export default function ConnectionSection({ connection, checking, onTestConnection }: Props) {
  const status = connectionStatusDisplay(connection);
  const usageRows = keyUsageRows(connection?.key);

  return (
    <Card
      size="small"
      title={
        <Space>
          <ApiOutlined />
          <span>Подключение OpenRouter</span>
          {connection?.api_key_configured ? (
            <Tag color="green">API key настроен</Tag>
          ) : (
            <Tag color="orange">API key не настроен</Tag>
          )}
        </Space>
      }
      extra={
        <Button
          icon={<ReloadOutlined />}
          onClick={onTestConnection}
          loading={checking}
          data-testid="ai-test-connection"
        >
          Проверить подключение
        </Button>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Alert type={status.tone} showIcon message={status.text} data-testid="ai-connection-status" />
        <Text type="secondary">{API_KEY_HINT}</Text>
        {usageRows.length > 0 && (
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2, md: 3 }}
            bordered
            items={usageRows.map((row, i) => ({
              key: String(i),
              label: row.label,
              children: row.value,
            }))}
          />
        )}
        {connection?.checked_at && (
          <Text type="secondary">
            Последняя проверка: {new Date(connection.checked_at).toLocaleString('ru-RU')}
          </Text>
        )}
      </Space>
    </Card>
  );
}
