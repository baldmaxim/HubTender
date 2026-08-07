import { useState } from 'react';
import {
  Alert, Button, Card, Descriptions, Input, Modal, Popconfirm, Space, Tag, Typography,
} from 'antd';
import { ApiOutlined, DeleteOutlined, KeyOutlined, ReloadOutlined } from '@ant-design/icons';
import type { AiConnectionView } from '../../../lib/api/adminAi';
import {
  API_KEY_HINT,
  PROXY_LIMITS_UNKNOWN,
  connectionStatusDisplay,
  keyUsageRows,
  proxyStatusRows,
} from '../../../lib/quality/openRouterAdminPolicy';

const { Text } = Typography;

interface Props {
  connection: AiConnectionView | null;
  checking: boolean;
  onTestConnection: () => void;
  /** feature/ai-key-ui: сохранить ключ (write-only; назад не читается). */
  onSetKey: (apiKey: string) => Promise<void>;
  /** Удалить UI-ключ (возврат к env-ключу, если задан). */
  onDeleteKey: () => Promise<void>;
  keySaving: boolean;
}

/**
 * Подключение OpenRouter. Ключ вводится write-only в модале и НИКОГДА не
 * отображается назад (только суффикс …xxxx и источник ui/env).
 */
export default function ConnectionSection({
  connection, checking, onTestConnection, onSetKey, onDeleteKey, keySaving,
}: Props) {
  const status = connectionStatusDisplay(connection);
  const isProxy = connection?.provider_mode === 'proxy_llm';
  // В proxy-режиме лимитов ключа не существует: usageRows пуст, и вместо них
  // показываются достижимость прокси и фактически ответившая модель.
  const usageRows = isProxy ? proxyStatusRows(connection?.proxy) : keyUsageRows(connection?.key);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');

  const keySource = connection?.key_source ?? 'none';
  const sourceTag =
    keySource === 'ui' ? (
      <Tag color="green">Ключ из UI {connection?.key_suffix ?? ''}</Tag>
    ) : keySource === 'env' ? (
      <Tag color="green">Ключ из env сервера</Tag>
    ) : (
      <Tag color="orange">API key не настроен</Tag>
    );

  const submitKey = async () => {
    const value = keyDraft.trim();
    if (!value) return;
    await onSetKey(value);
    // Ключ немедленно забываем на клиенте.
    setKeyDraft('');
    setKeyModalOpen(false);
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <ApiOutlined />
          <span>Подключение OpenRouter</span>
          {sourceTag}
        </Space>
      }
      extra={
        <Space>
          <Button
            icon={<KeyOutlined />}
            onClick={() => setKeyModalOpen(true)}
            data-testid="ai-add-key"
          >
            {keySource === 'ui' ? 'Заменить ключ' : 'Добавить ключ'}
          </Button>
          {keySource === 'ui' && (
            <Popconfirm
              title="Удалить ключ, заданный из UI?"
              description={
                connection?.env_key_available
                  ? 'Будет действовать ключ из env сервера.'
                  : 'Ключей не останется — AI-функции станут «не настроено».'
              }
              okText="Удалить"
              cancelText="Отмена"
              onConfirm={() => void onDeleteKey()}
            >
              <Button danger icon={<DeleteOutlined />} loading={keySaving} data-testid="ai-delete-key">
                Удалить
              </Button>
            </Popconfirm>
          )}
          <Button
            icon={<ReloadOutlined />}
            onClick={onTestConnection}
            loading={checking}
            data-testid="ai-test-connection"
          >
            Проверить подключение
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Alert type={status.tone} showIcon message={status.text} data-testid="ai-connection-status" />
        {isProxy && (
          <>
            <Tag color="processing" data-testid="ai-provider-mode">Режим: LLM-прокси (модель выбирает прокси)</Tag>
            <Alert type="warning" showIcon message={PROXY_LIMITS_UNKNOWN} data-testid="ai-proxy-limits-unknown" />
          </>
        )}
        {keySource === 'ui' && connection?.key_set_at && (
          <Text type="secondary">
            Ключ задан из UI {new Date(connection.key_set_at).toLocaleString('ru-RU')}
            {connection.env_key_available ? ' (env-ключ остаётся резервным)' : ''}
          </Text>
        )}
        {!isProxy && keySource !== 'ui' && <Text type="secondary">{API_KEY_HINT}</Text>}
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

      <Modal
        title="OpenRouter API-ключ"
        open={keyModalOpen}
        onCancel={() => {
          setKeyDraft('');
          setKeyModalOpen(false);
        }}
        onOk={() => void submitKey()}
        okText="Сохранить и проверить"
        cancelText="Отмена"
        confirmLoading={keySaving}
        okButtonProps={{ disabled: !keyDraft.trim().startsWith('sk-or-') || keyDraft.trim().length < 20 }}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Text type="secondary">
            Ключ вида <Text code>sk-or-…</Text> из личного кабинета OpenRouter. Хранится на сервере
            в зашифрованном виде, назад не показывается — только суффикс. После сохранения
            подключение проверится автоматически.
          </Text>
          <Input.Password
            placeholder="sk-or-…"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            autoComplete="off"
            data-testid="ai-key-input"
          />
        </Space>
      </Modal>
    </Card>
  );
}
