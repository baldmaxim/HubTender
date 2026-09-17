// Настройки ИИ-разбора (администраторы): модель, пилотные тендеры, лимиты, проверка
// модели, расход и совпадение оценок с вердиктами инженеров.
import { FC, useCallback, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Input, InputNumber, Select, Space, Switch, Tag, Typography, message } from 'antd';
import { ExperimentOutlined, RobotOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  fetchAISettings,
  saveAISettings,
  testAIModel,
  type AISettings,
  type AISettingsInput,
  type AITestResult,
} from '../../../lib/api/verificationAI';
import { agreementRate, labelDisplay } from '../../../lib/quality/aiTriagePolicy';
import { getErrorMessage } from '../../../utils/errors';
import type { QualityTenderOption } from '../hooks/useQualityReport';

const { Text } = Typography;

const toInput = (s: AISettings): AISettingsInput => ({
  enabled: s.enabled,
  model_id: s.model_id,
  allowed_tender_ids: s.allowed_tender_ids,
  max_findings_per_run: s.max_findings_per_run,
  batch_size: s.batch_size,
  max_output_tokens: s.max_output_tokens,
  request_timeout_seconds: s.request_timeout_seconds,
  monthly_token_budget: s.monthly_token_budget,
  daily_request_limit: s.daily_request_limit,
});

const TEST_ERRORS: Record<string, string> = {
  wrong_label: 'модель не распознала два слоя утеплителя как норму',
  no_assessment: 'модель не вернула оценку',
  invalid_response: 'ответ не по схеме — модель не поддерживает строгий JSON',
  unauthorized: 'ключ не принят провайдером',
  rate_limited: 'превышен лимит запросов провайдера',
  unavailable: 'провайдер недоступен (сеть или прокси)',
};

export const AITriageSettingsCard: FC<{ tenders: QualityTenderOption[] }> = ({ tenders }) => {
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [draft, setDraft] = useState<AISettingsInput | null>(null);
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | null>(null);
  const [test, setTest] = useState<AITestResult | null>(null);

  const load = useCallback(async () => {
    setBusy('load');
    try {
      const s = await fetchAISettings();
      setSettings(s);
      setDraft(toInput(s));
    } catch (e) {
      message.error('Настройки ИИ-разбора не загружены: ' + getErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const save = async () => {
    if (!draft) return;
    setBusy('save');
    try {
      const s = await saveAISettings(draft);
      setSettings(s);
      setDraft(toInput(s));
      message.success('Настройки сохранены');
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy('test');
    setTest(null);
    try {
      const res = await testAIModel();
      setTest(res);
      await load();
    } catch (e) {
      message.error('Проверка модели не выполнена: ' + getErrorMessage(e));
      setBusy(null);
    }
  };

  const patch = (p: Partial<AISettingsInput>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const modelSaved = !!settings?.model_id && settings.model_id === draft?.model_id;
  const tested = settings?.last_test_status === 'passed' && settings.last_test_model_id === draft?.model_id;
  const rate = settings ? agreementRate(settings.agreement) : null;

  const body = !settings || !draft ? null : (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {!settings.configured && (
        <Alert type="warning" showIcon message="Подключение к модели не настроено: нет ключа OpenRouter или прокси (см. «Настройки ИИ»)" />
      )}
      {settings.paused_until && (
        <Alert type="warning" showIcon message={`Разбор на паузе после серии сбоев модели до ${dayjs(settings.paused_until).format('HH:mm')}`} />
      )}
      <Space wrap>
        <Text>Модель</Text>
        <Input
          style={{ width: 320, maxWidth: '100%' }}
          placeholder="идентификатор модели OpenRouter, например vendor/model"
          value={draft.model_id ?? ''}
          onChange={(e) => patch({ model_id: e.target.value || null, enabled: false })}
        />
        <Button icon={<ExperimentOutlined />} loading={busy === 'test'} disabled={!modelSaved} onClick={runTest}>
          Проверить модель
        </Button>
        {settings.last_test_status && settings.last_test_model_id === draft.model_id && (
          <Tag color={settings.last_test_status === 'passed' ? 'green' : 'red'}>
            {settings.last_test_status === 'passed' ? 'проверка пройдена' : 'проверка не пройдена'}
          </Tag>
        )}
      </Space>
      {!modelSaved && draft.model_id && <Text type="secondary">Сохраните модель, затем проверьте её.</Text>}
      {test && (
        <Alert
          type={test.passed ? 'success' : 'error'}
          showIcon
          message={test.passed ? 'Модель прошла проверку' : `Модель не прошла проверку: ${TEST_ERRORS[test.error ?? ''] ?? test.error}`}
          description={
            test.label ? `${labelDisplay(test.label).text}. ${test.reason} (${test.latency_ms} мс, ${test.tokens} токенов)` : undefined
          }
        />
      )}
      <Space wrap>
        <Switch checked={draft.enabled} disabled={!tested} onChange={(v) => patch({ enabled: v })} />
        <Text>Разбирать находки автоматически после проверки тендера</Text>
      </Space>
      <Select
        mode="multiple"
        allowClear
        style={{ width: '100%' }}
        placeholder="Пилотные тендеры (пусто — все тендеры)"
        value={draft.allowed_tender_ids ?? []}
        onChange={(v: string[]) => patch({ allowed_tender_ids: v.length ? v : null })}
        optionFilterProp="label"
        options={tenders.map((t) => ({ value: t.id, label: t.version ? `${t.title} — версия ${t.version}` : t.title }))}
      />
      <Space wrap>
        <Text>Токенов в месяц</Text>
        <InputNumber min={1} step={1_000_000} value={draft.monthly_token_budget} onChange={(v) => patch({ monthly_token_budget: Number(v) || 1 })} />
        <Text>Запросов в сутки</Text>
        <InputNumber min={1} max={100000} value={draft.daily_request_limit} onChange={(v) => patch({ daily_request_limit: Number(v) || 1 })} />
        <Text>Находок за прогон</Text>
        <InputNumber min={1} max={2000} value={draft.max_findings_per_run} onChange={(v) => patch({ max_findings_per_run: Number(v) || 1 })} />
        <Text>Находок в запросе</Text>
        <InputNumber min={1} max={20} value={draft.batch_size} onChange={(v) => patch({ batch_size: Number(v) || 1 })} />
      </Space>
      <Button type="primary" icon={<SaveOutlined />} loading={busy === 'save'} onClick={save}>
        Сохранить
      </Button>
      <Descriptions size="small" column={{ xs: 1, md: 2 }} bordered>
        <Descriptions.Item label="Расход за месяц">
          {settings.usage.month_tokens.toLocaleString('ru-RU')} токенов · {settings.usage.month_requests} запросов
          {settings.usage.month_cost > 0 ? ` · $${settings.usage.month_cost.toFixed(2)}` : ''}
        </Descriptions.Item>
        <Descriptions.Item label="Сбоев за месяц">{settings.usage.month_failed}</Descriptions.Item>
        <Descriptions.Item label="Совпадение с инженерами">
          {rate === null
            ? 'пока не с чем сравнить'
            : `${Math.round(rate * 100)}% (ошибка: ${settings.agreement.error_agreed} верно, ${settings.agreement.error_missed} мимо; ` +
              `норма: ${settings.agreement.ok_agreed} верно, ${settings.agreement.ok_missed} мимо)`}
        </Descriptions.Item>
        <Descriptions.Item label="Версия промпта">{settings.prompt_version}</Descriptions.Item>
      </Descriptions>
    </Space>
  );

  return (
    <Collapse
      onChange={(keys) => {
        if ((Array.isArray(keys) ? keys : [keys]).length && !settings) void load();
      }}
      items={[
        {
          key: 'ai',
          label: (
            <Space size={8}>
              <RobotOutlined />
              <Text strong>Настройки ИИ-разбора</Text>
              {settings && <Tag color={settings.enabled ? 'green' : 'default'}>{settings.enabled ? 'включён' : 'выключен'}</Tag>}
            </Space>
          ),
          children: busy === 'load' && !settings ? <Text type="secondary">Загрузка…</Text> : body,
        },
      ]}
    />
  );
};
