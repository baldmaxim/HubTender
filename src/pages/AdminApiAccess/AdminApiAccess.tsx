import { useCallback, useEffect, useState } from 'react';
import { Space, Tabs, Typography, message } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import {
  ApiKeysSection,
  ApiSettingsSection,
  CallLogSection,
  IssueKeyModal,
} from './components';
import type { ApiSettingsForm } from './components';
import {
  ApiAccessSettings,
  ApiCallLogEntry,
  ApiKey,
  CreateApiKeyInput,
  IssuedApiKey,
  createApiKey,
  deleteApiKey,
  getApiAccessSettings,
  listApiCallLog,
  listApiKeys,
  revokeApiKey,
  updateApiAccessSettings,
} from '../../lib/api/apiAccess';
import { getErrorMessage } from '../../utils/errors';

const { Title, Paragraph } = Typography;

/**
 * Настройки → Доступ к API.
 *
 * Управление машинной выдачей API архива смет: выпуск и отзыв ключей,
 * ограничение области (чтение/запись, список тендеров), тумблеры эндпоинтов с
 * потолками и журнал вызовов.
 *
 * Инварианты страницы:
 *   - секрет ключа приходит с сервера ОДИН раз при выпуске и нигде не
 *     сохраняется на клиенте: ни в state после закрытия окна, ни в localStorage;
 *   - страница гейтится ролью и на сервере (RequireRoles на /admin/api-access/*),
 *     а не только пунктом меню.
 */
export default function AdminApiAccess() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [settings, setSettings] = useState<ApiAccessSettings | null>(null);
  const [calls, setCalls] = useState<ApiCallLogEntry[]>([]);

  const [keysLoading, setKeysLoading] = useState(false);
  const [callsLoading, setCallsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [issuing, setIssuing] = useState(false);

  const [issueOpen, setIssueOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedApiKey | null>(null);

  const [filterKeyId, setFilterKeyId] = useState<string | undefined>();
  const [onlyErrors, setOnlyErrors] = useState(false);

  const loadKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      setKeys(await listApiKeys());
    } catch (e) {
      message.error(`Не удалось загрузить ключи: ${getErrorMessage(e)}`);
    } finally {
      setKeysLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await getApiAccessSettings());
    } catch (e) {
      message.error(`Не удалось загрузить настройки: ${getErrorMessage(e)}`);
    }
  }, []);

  const loadCalls = useCallback(async () => {
    setCallsLoading(true);
    try {
      setCalls(await listApiCallLog({ apiKeyId: filterKeyId, onlyErrors, limit: 200 }));
    } catch (e) {
      message.error(`Не удалось загрузить журнал: ${getErrorMessage(e)}`);
    } finally {
      setCallsLoading(false);
    }
  }, [filterKeyId, onlyErrors]);

  useEffect(() => {
    void loadKeys();
    void loadSettings();
  }, [loadKeys, loadSettings]);

  useEffect(() => {
    void loadCalls();
  }, [loadCalls]);

  const handleIssue = async (input: CreateApiKeyInput) => {
    setIssuing(true);
    try {
      const result = await createApiKey(input);
      setIssued(result);
      await loadKeys();
    } catch (e) {
      message.error(`Не удалось выпустить ключ: ${getErrorMessage(e)}`);
    } finally {
      setIssuing(false);
    }
  };

  const handleCloseIssue = () => {
    // Секрет живёт только пока открыто окно: после закрытия его негде взять.
    setIssueOpen(false);
    setIssued(null);
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeApiKey(id);
      message.success('Ключ отозван');
      await loadKeys();
    } catch (e) {
      message.error(`Не удалось отозвать ключ: ${getErrorMessage(e)}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteApiKey(id);
      message.success('Ключ удалён');
      await loadKeys();
    } catch (e) {
      message.error(`Не удалось удалить ключ: ${getErrorMessage(e)}`);
    }
  };

  const handleSaveSettings = async (values: ApiSettingsForm) => {
    setSaving(true);
    try {
      setSettings(await updateApiAccessSettings(values));
      message.success('Настройки сохранены');
    } catch (e) {
      message.error(`Не удалось сохранить настройки: ${getErrorMessage(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div>
        <Title level={3} style={{ marginBottom: 4 }}>
          <ApiOutlined /> Доступ к API
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Машинный доступ к архиву смет: выпуск ключей, ограничение прав, тумблеры
          эндпоинтов и журнал вызовов.
        </Paragraph>
      </div>

      <Tabs
        defaultActiveKey="keys"
        items={[
          {
            key: 'keys',
            label: 'Ключи',
            children: (
              <ApiKeysSection
                keys={keys}
                loading={keysLoading}
                onIssue={() => setIssueOpen(true)}
                onRevoke={handleRevoke}
                onDelete={handleDelete}
              />
            ),
          },
          {
            key: 'settings',
            label: 'Выдача API',
            children: (
              <ApiSettingsSection
                settings={settings}
                saving={saving}
                onSave={handleSaveSettings}
              />
            ),
          },
          {
            key: 'log',
            label: 'Журнал вызовов',
            children: (
              <CallLogSection
                entries={calls}
                keys={keys}
                loading={callsLoading}
                filterKeyId={filterKeyId}
                onlyErrors={onlyErrors}
                onFilterKey={setFilterKeyId}
                onToggleErrors={setOnlyErrors}
                onRefresh={() => void loadCalls()}
              />
            ),
          },
        ]}
      />

      <IssueKeyModal
        open={issueOpen}
        issuing={issuing}
        issued={issued}
        onSubmit={handleIssue}
        onClose={handleCloseIssue}
      />
    </Space>
  );
}
