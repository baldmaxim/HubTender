import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, DatePicker, Descriptions, Modal, Popconfirm, Select, Space,
  Table, Tag, Typography, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ExperimentOutlined, TeamOutlined, BarChartOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  AiEvaluationSummary, AiPilotUser, AiUsageSummary, addAiPilotUser, fetchAiEvaluations,
  fetchAiPilotUsers, fetchAiUsage, patchAiPilotUser, removeAiPilotUser, runAiEvaluation,
} from '../../../lib/api/adminAi';
import { listAllUsers, UserRow } from '../../../lib/api/userAdmin';
import {
  ACCEPTANCE_IS_PROXY_TEXT, AI_COST_UNIT_LABEL, formatCost,
} from '../../../lib/quality/aiRolloutPolicy';
import { getErrorMessage } from '../../../utils/errors';

const { Text } = Typography;

interface Props {
  onRolloutChanged: () => void;
}

/** §18.B/D/E: пилотная группа (поиск по существующим users, БЕЗ free-text
 *  UUID), usage-статистика и evaluation. */
export default function PilotOperationsSection({ onRolloutChanged }: Props) {
  const [pilots, setPilots] = useState<AiPilotUser[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [evals, setEvals] = useState<AiEvaluationSummary[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [bulkAllowed, setBulkAllowed] = useState(false);
  const [expires, setExpires] = useState<dayjs.Dayjs | null>(null);
  const [evalMode, setEvalMode] = useState<'mock' | 'live'>('mock');
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalConfirmOpen, setEvalConfirmOpen] = useState(false);

  const reload = async () => {
    try {
      const [p, u, ev] = await Promise.all([fetchAiPilotUsers(), fetchAiUsage(), fetchAiEvaluations()]);
      setPilots(p);
      setUsage(u.summary);
      setEvals(ev);
    } catch (e) {
      message.error(getErrorMessage(e));
    }
  };

  useEffect(() => {
    void reload();
    listAllUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const userOptions = useMemo(
    () => users
      .filter((u) => u.access_enabled && u.access_status === 'approved')
      .map((u) => ({ value: u.id, label: `${u.full_name} (${u.email})` })),
    [users]
  );

  const addPilot = async () => {
    if (!selectedUser) return;
    try {
      await addAiPilotUser(selectedUser, bulkAllowed, expires ? expires.toISOString() : null);
      message.success('Пользователь добавлен в пилот.');
      setSelectedUser(null); setBulkAllowed(false); setExpires(null);
      await reload();
      onRolloutChanged();
    } catch (e) {
      message.error(getErrorMessage(e));
    }
  };

  const pilotColumns: ColumnsType<AiPilotUser> = [
    { title: 'Пользователь', key: 'u', render: (_, p) => <span>{p.full_name} <Text type="secondary">{p.email}</Text></span> },
    {
      title: 'Активен', key: 'a', width: 90,
      render: (_, p) => p.is_active ? <Tag color="green">да</Tag> : <Tag>нет</Tag>,
    },
    {
      title: 'Bulk', key: 'b', width: 80,
      render: (_, p) => (
        <Checkbox checked={p.bulk_confirmation_allowed}
          onChange={async (e) => {
            try {
              await patchAiPilotUser(p.user_id, { bulk_confirmation_allowed: e.target.checked });
              await reload();
            } catch (err) { message.error(getErrorMessage(err)); }
          }} />
      ),
    },
    {
      title: 'Лимиты (запросы/строки)', key: 'l', width: 170,
      render: (_, p) => `${p.daily_request_limit_override ?? '—'} / ${p.daily_row_limit_override ?? '—'}`,
    },
    {
      title: 'Истекает', key: 'e', width: 120,
      render: (_, p) => p.expires_at ? new Date(p.expires_at).toLocaleDateString('ru-RU') : '—',
    },
    {
      title: '', key: 'x', width: 100,
      render: (_, p) => (
        <Popconfirm title="Исключить из пилота немедленно?" okText="Исключить" cancelText="Отмена"
          onConfirm={async () => {
            try {
              await removeAiPilotUser(p.user_id);
              message.success('Пользователь исключён из пилота.');
              await reload();
              onRolloutChanged();
            } catch (err) { message.error(getErrorMessage(err)); }
          }}>
          <Button size="small" danger>Убрать</Button>
        </Popconfirm>
      ),
    },
  ];

  const runEval = async () => {
    setEvalRunning(true);
    try {
      const { result } = await runAiEvaluation(evalMode, evalMode === 'live');
      if (result.gates_passed) {
        message.success('Evaluation: gates PASS.');
      } else {
        message.warning('Evaluation: gates FAIL — смотрите детали.');
      }
      await reload();
      onRolloutChanged();
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setEvalRunning(false);
      setEvalConfirmOpen(false);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Card size="small" title={<Space><TeamOutlined /><span>Пилотная группа</span><Tag>{pilots.length}</Tag></Space>}>
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Space wrap>
            <Select
              showSearch
              style={{ minWidth: 320 }}
              placeholder="Найти пользователя (имя/email)"
              optionFilterProp="label"
              options={userOptions}
              value={selectedUser}
              onChange={setSelectedUser}
              data-testid="ai-pilot-user-search"
            />
            <Checkbox checked={bulkAllowed} onChange={(e) => setBulkAllowed(e.target.checked)}>
              Разрешить bulk
            </Checkbox>
            <DatePicker placeholder="Истекает (опц.)" value={expires} onChange={setExpires} />
            <Button type="primary" disabled={!selectedUser} onClick={addPilot} data-testid="ai-pilot-add">
              Добавить в пилот
            </Button>
          </Space>
          <Table<AiPilotUser> size="small" rowKey="user_id" columns={pilotColumns}
            dataSource={pilots} pagination={false} data-testid="ai-pilot-table" />
        </Space>
      </Card>

      <Card size="small" title={<Space><BarChartOutlined /><span>Использование</span></Space>}>
        {usage ? (
          <Space direction="vertical" style={{ width: '100%' }} size={6}>
            <Descriptions size="small" bordered column={{ xs: 1, sm: 3 }}>
              <Descriptions.Item label="Запросы (день/месяц)">{usage.requests_today} / {usage.requests_month}</Descriptions.Item>
              <Descriptions.Item label="Строки (день/месяц)">{usage.rows_today} / {usage.rows_month}</Descriptions.Item>
              <Descriptions.Item label="Токены/месяц">{usage.tokens_month.toLocaleString('ru-RU')}</Descriptions.Item>
              <Descriptions.Item label="Provider cost">{formatCost(usage.provider_cost_month_usd)}</Descriptions.Item>
              <Descriptions.Item label="Estimated cost">{formatCost(usage.estimated_cost_month_usd)}</Descriptions.Item>
              <Descriptions.Item label="Активные резервации">{usage.active_reservations} (${usage.reserved_active_amount_usd})</Descriptions.Item>
              <Descriptions.Item label="Timeout / rate-limit / invalid">
                {usage.timeouts_month} / {usage.rate_limited_month} / {usage.invalid_month}
              </Descriptions.Item>
              <Descriptions.Item label="Принято / изменено / вручную">
                {usage.feedback_accepted} / {usage.feedback_changed} / {usage.feedback_manual}
              </Descriptions.Item>
              <Descriptions.Item label="High-conf изменено">
                {usage.high_confidence_changed} из {usage.high_confidence_total}
              </Descriptions.Item>
            </Descriptions>
            <Text type="secondary">Единица стоимости: {AI_COST_UNIT_LABEL}. {ACCEPTANCE_IS_PROXY_TEXT}</Text>
          </Space>
        ) : (
          <Alert type="info" showIcon message="Статистика загружается…" />
        )}
      </Card>

      <Card
        size="small"
        title={<Space><ExperimentOutlined /><span>Evaluation</span></Space>}
        extra={
          <Space>
            <Select value={evalMode} style={{ width: 110 }} data-testid="ai-eval-mode"
              options={[{ value: 'mock', label: 'mock' }, { value: 'live', label: 'live' }]}
              onChange={(v) => setEvalMode(v)} />
            <Button type="primary" ghost loading={evalRunning} data-testid="ai-eval-run"
              onClick={() => (evalMode === 'live' ? setEvalConfirmOpen(true) : runEval())}>
              Запустить evaluation
            </Button>
          </Space>
        }
      >
        <Table<AiEvaluationSummary>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={evals}
          data-testid="ai-eval-history"
          columns={[
            { title: 'Когда', key: 'at', width: 150, render: (_, s) => new Date(s.executed_at).toLocaleString('ru-RU') },
            { title: 'Режим', dataIndex: 'eval_mode', key: 'm', width: 110 },
            { title: 'Модель', dataIndex: 'model_id', key: 'model' },
            { title: 'Dataset', key: 'd', width: 140, render: (_, s) => `${s.dataset_hash.slice(0, 10)} (${s.dataset_size})` },
            {
              title: 'Gates', key: 'g', width: 90,
              render: (_, s) => s.gates_passed ? <Tag color="green">PASS</Tag> : <Tag color="red">FAIL</Tag>,
            },
          ]}
        />
      </Card>

      <Modal
        open={evalConfirmOpen}
        title="Live evaluation — платный вызов OpenRouter"
        okText="Подтверждаю стоимость, запустить"
        cancelText="Отмена"
        okButtonProps={{ loading: evalRunning }}
        onOk={runEval}
        onCancel={() => setEvalConfirmOpen(false)}
      >
        <Text>
          Будет выполнен реальный вызов выбранной модели на синтетическом датасете.
          Требуются OPENROUTER_LIVE_TEST, настроенный ключ и режим «evaluation».
          Стоимость учитывается в usage-ledger.
        </Text>
      </Modal>
    </Space>
  );
}
