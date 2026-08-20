import { FC, useEffect } from 'react';
import { Button, Card, Col, Form, InputNumber, Row, Space, Switch, Typography } from 'antd';
import type { ApiAccessSettings } from '../../../lib/api/apiAccess';
import { formatDateTime } from '../utils/format';

const { Text } = Typography;

export type ApiSettingsForm = Omit<
  ApiAccessSettings,
  'updated_at' | 'updated_by' | 'updated_by_name'
>;

interface IApiSettingsSectionProps {
  settings: ApiAccessSettings | null;
  saving: boolean;
  onSave: (values: ApiSettingsForm) => void;
}

const ENDPOINT_TOGGLES: Array<{ name: keyof ApiSettingsForm; label: string; hint: string }> = [
  {
    name: 'archive_search_enabled',
    label: 'Поиск по архиву',
    hint: 'GET /api/v1/archive/positions/search',
  },
  {
    name: 'archive_suggest_enabled',
    label: 'Подбор аналогов',
    hint: 'POST /api/v1/archive/positions/suggest',
  },
  {
    name: 'archive_read_enabled',
    label: 'Чтение позиции',
    hint: 'GET /api/v1/archive/positions/{id}',
  },
  {
    name: 'archive_compose_enabled',
    label: 'Сборка смет',
    hint: 'POST /api/v1/archive/compose — запись в тендер',
  },
];

export const ApiSettingsSection: FC<IApiSettingsSectionProps> = ({ settings, saving, onSave }) => {
  const [form] = Form.useForm<ApiSettingsForm>();

  useEffect(() => {
    if (settings) form.setFieldsValue(settings);
  }, [settings, form]);

  return (
    <Card
      title="Выдача API"
      extra={
        settings?.updated_at ? (
          <Text type="secondary">
            изменено {formatDateTime(settings.updated_at)}
            {settings.updated_by_name ? ` · ${settings.updated_by_name}` : ''}
          </Text>
        ) : null
      }
    >
      <Form form={form} layout="vertical" onFinish={onSave} disabled={!settings}>
        <Row gutter={[16, 8]}>
          {ENDPOINT_TOGGLES.map((t) => (
            <Col xs={24} md={12} key={String(t.name)}>
              <Form.Item
                name={t.name}
                label={t.label}
                valuePropName="checked"
                extra={<Text type="secondary" style={{ fontSize: 12 }}>{t.hint}</Text>}
              >
                <Switch checkedChildren="вкл" unCheckedChildren="выкл" />
              </Form.Item>
            </Col>
          ))}
        </Row>

        <Row gutter={[16, 8]}>
          <Col xs={24} md={8}>
            <Form.Item
              name="max_search_limit"
              label="Максимум строк в выдаче"
              rules={[{ required: true, type: 'number', min: 1, max: 1000 }]}
            >
              <InputNumber min={1} max={1000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="max_candidate_limit"
              label="Максимум кандидатов префильтра"
              rules={[{ required: true, type: 'number', min: 50, max: 20000 }]}
              extra="Влияет на нагрузку поиска по архиву."
            >
              <InputNumber min={50} max={20000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="max_suggest_queries"
              label="Максимум запросов в батче"
              rules={[{ required: true, type: 'number', min: 1, max: 500 }]}
            >
              <InputNumber min={1} max={500} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="rate_limit_per_minute"
              label="Запросов в минуту на ключ"
              rules={[{ required: true, type: 'number', min: 0, max: 100000 }]}
              extra="0 — без ограничения."
            >
              <InputNumber min={0} max={100000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="call_log_retention_days"
              label="Хранить журнал, дней"
              rules={[{ required: true, type: 'number', min: 1, max: 365 }]}
            >
              <InputNumber min={1} max={365} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Space>
          <Button type="primary" htmlType="submit" loading={saving}>
            Сохранить
          </Button>
          <Button onClick={() => settings && form.setFieldsValue(settings)} disabled={saving}>
            Отменить правки
          </Button>
        </Space>
      </Form>
    </Card>
  );
};
