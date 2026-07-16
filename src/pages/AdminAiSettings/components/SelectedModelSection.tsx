import { Alert, Button, Card, Descriptions, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined, ExperimentOutlined, PoweroffOutlined, SaveOutlined,
} from '@ant-design/icons';
import type { AiModelTestReport, AiScenarioResult, AiSettingsView } from '../../../lib/api/adminAi';
import {
  LIMITS_READONLY_HINT,
  activationEligibility,
  pricePerMillionDisplay,
  rolloutDisplay,
  testStatusDisplay,
} from '../../../lib/quality/openRouterAdminPolicy';

const { Text } = Typography;

interface Props {
  settings: AiSettingsView | null;
  lastReport: AiModelTestReport | null;
  draftModelId: string | null; // выбранная в таблице, ещё не сохранённая
  saving: boolean;
  testing: boolean;
  activating: boolean;
  onSaveDraft: () => void;
  onTestModel: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
}

/** §18.C-E: выбранная модель, тест, активация, лимиты (read-only), rollout. */
export default function SelectedModelSection({
  settings, lastReport, draftModelId, saving, testing, activating,
  onSaveDraft, onTestModel, onActivate, onDeactivate,
}: Props) {
  const model = settings?.selected_model ?? null;
  const test = testStatusDisplay(settings?.model_test);
  const eligibility = activationEligibility(settings);
  const rollout = rolloutDisplay(settings);
  const dirty = !!draftModelId && draftModelId !== (model?.id ?? null);

  const scenarioColumns: ColumnsType<AiScenarioResult> = [
    { title: 'Сценарий', dataIndex: 'title', key: 'title' },
    {
      title: 'Результат',
      key: 'status',
      width: 110,
      render: (_, s) =>
        s.status === 'passed' ? <Tag color="green">пройден</Tag> : <Tag color="red">провален</Tag>,
    },
    { title: 'Причина', dataIndex: 'reason', key: 'reason', render: (v) => v || '—' },
  ];

  return (
    <Card
      size="small"
      title={
        <Space>
          <ExperimentOutlined />
          <span>Выбранная модель</span>
          {settings?.enabled ? (
            <Tag color="green">конфигурация активна</Tag>
          ) : (
            <Tag>не активирована</Tag>
          )}
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size={10}>
        {settings?.needs_review_reason && (
          <Alert
            type="error"
            showIcon
            message="Конфигурация требует внимания"
            description={settings.needs_review_reason}
            data-testid="ai-needs-review"
          />
        )}

        {dirty && (
          <Alert
            type="info"
            showIcon
            message={`В таблице выбрана модель ${draftModelId} — нажмите «Сохранить выбор», чтобы сделать её черновиком.`}
          />
        )}

        {model ? (
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Название">{model.name || model.id}</Descriptions.Item>
            <Descriptions.Item label="Точный ID">
              <Text copyable>{model.id}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Контекст">
              {model.context_length === null ? '—' : model.context_length.toLocaleString('ru-RU')}
            </Descriptions.Item>
            <Descriptions.Item label="Макс. вывод">
              {model.max_completion_tokens === null
                ? '—'
                : model.max_completion_tokens.toLocaleString('ru-RU')}
            </Descriptions.Item>
            <Descriptions.Item label="Вход / 1M">
              {pricePerMillionDisplay(model.price_per_1m_input_tokens)}
            </Descriptions.Item>
            <Descriptions.Item label="Выход / 1M">
              {pricePerMillionDisplay(model.price_per_1m_output_tokens)}
            </Descriptions.Item>
            <Descriptions.Item label="Поддерживаемые параметры" span={2}>
              <Space wrap size={4}>
                {(model.supported_parameters ?? []).map((p) => (
                  <Tag key={p} style={{ marginInlineEnd: 0 }}>
                    {p}
                  </Tag>
                ))}
              </Space>
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Alert type="info" showIcon message="Модель не выбрана. Выберите модель в каталоге выше." />
        )}

        <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }} title="Политика и версии">
          <Descriptions.Item label="Privacy">
            ZDR: обязателен · data collection: {settings?.data_collection_policy ?? 'deny'} ·
            require_parameters: {String(settings?.require_parameters ?? true)} · fallbacks:{' '}
            {String(settings?.allow_provider_fallbacks ?? false)}
          </Descriptions.Item>
          <Descriptions.Item label="Prompt version">{settings?.prompt_version ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Config hash">
            <Text code>{settings?.current_config_hash?.slice(0, 12) || '—'}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Adapter / schema">
            {settings?.adapter_version} · {settings?.schema_version}
          </Descriptions.Item>
        </Descriptions>

        <Alert type={test.tone} showIcon message={test.text} data-testid="ai-test-status" />
        {settings?.model_test?.tested_at && (
          <Text type="secondary">
            Последний тест: {new Date(settings.model_test.tested_at).toLocaleString('ru-RU')}
            {settings.model_test.latency_ms != null && ` · ${settings.model_test.latency_ms} мс`}
            {settings.model_test.input_tokens != null &&
              ` · токены: ${settings.model_test.input_tokens}→${settings.model_test.output_tokens ?? 0}`}
            {settings.model_test.estimated_cost_usd &&
              ` · ≈$${settings.model_test.estimated_cost_usd}`}
          </Text>
        )}

        {lastReport?.scenarios && lastReport.scenarios.length > 0 && (
          <Table<AiScenarioResult>
            size="small"
            rowKey="key"
            columns={scenarioColumns}
            dataSource={lastReport.scenarios}
            pagination={false}
            data-testid="ai-test-scenarios"
          />
        )}

        {!eligibility.canActivate && eligibility.reasons.length > 0 && !settings?.enabled && (
          <Alert
            type="warning"
            showIcon
            message="Активация недоступна"
            description={eligibility.reasons.join('; ')}
            data-testid="ai-activation-blockers"
          />
        )}

        <Space wrap>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            disabled={!dirty}
            loading={saving}
            onClick={onSaveDraft}
            data-testid="ai-save-draft"
          >
            Сохранить выбор
          </Button>
          <Button
            icon={<ExperimentOutlined />}
            disabled={!model}
            loading={testing}
            onClick={onTestModel}
            data-testid="ai-test-model"
          >
            Проверить модель
          </Button>
          <Button
            type="primary"
            ghost
            icon={<CheckCircleOutlined />}
            disabled={!eligibility.canActivate}
            loading={activating}
            onClick={onActivate}
            data-testid="ai-activate"
          >
            Активировать конфигурацию
          </Button>
          <Popconfirm
            title="Отключить OpenRouter?"
            description="Provider вернётся в состояние «отключён»; ручной Smart Import продолжит работать."
            okText="Отключить"
            cancelText="Отмена"
            onConfirm={onDeactivate}
            disabled={!settings?.enabled}
          >
            <Button
              danger
              icon={<PoweroffOutlined />}
              disabled={!settings?.enabled}
              data-testid="ai-deactivate"
            >
              Отключить
            </Button>
          </Popconfirm>
        </Space>

        <Descriptions size="small" bordered column={{ xs: 1, sm: 3 }} title="Лимиты (read-only)">
          <Descriptions.Item label="Таймаут">{settings?.request_timeout_seconds ?? '—'} с</Descriptions.Item>
          <Descriptions.Item label="Строк на запрос">{settings?.max_rows_per_request ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Кандидатов">{settings?.candidate_limit ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Параллельность">{settings?.max_concurrency ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Макс. вывод (токены)">{settings?.max_output_tokens ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Бюджет / месяц">
            {settings?.monthly_budget_usd == null ? 'не задан' : `$${settings.monthly_budget_usd}`}
          </Descriptions.Item>
        </Descriptions>
        <Text type="secondary">{LIMITS_READONLY_HINT}</Text>

        <Alert type={rollout.tone} showIcon message={rollout.text} data-testid="ai-rollout-status" />
      </Space>
    </Card>
  );
}
