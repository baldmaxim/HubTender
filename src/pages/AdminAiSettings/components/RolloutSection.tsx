import { useState } from 'react';
import {
  Alert, Button, Card, Descriptions, Input, InputNumber, Modal, Popconfirm, Space, Tag,
  Typography, message,
} from 'antd';
import {
  AlertOutlined, RocketOutlined, SafetyOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import {
  AiRolloutView, emergencyOffAiRollout, transitionAiRollout, updateAiRolloutSettings,
} from '../../../lib/api/adminAi';
import {
  EMERGENCY_OFF_CONFIRM, EMERGENCY_OFF_LABEL, ROLLOUT_MODE_LABELS, allGatesPassed,
  circuitDisplay, nextTransitionTargets, rolloutModeDisplay,
} from '../../../lib/quality/aiRolloutPolicy';
import { resetAiCircuit } from '../../../lib/api/adminAi';
import { getErrorMessage } from '../../../utils/errors';

const { Text } = Typography;

interface Props {
  rollout: AiRolloutView | null;
  onChanged: (view: AiRolloutView) => void;
}

/** §18.A/C/F/G: state machine, гейты, лимиты, circuit, emergency off.
 *  Кнопки general availability НЕ существует. */
export default function RolloutSection({ rollout, onChanged }: Props) {
  const [target, setTarget] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [transitioning, setTransitioning] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);
  const [budget, setBudget] = useState<string | null>(null);
  const [reqLimit, setReqLimit] = useState<number | null>(null);
  const [rowLimit, setRowLimit] = useState<number | null>(null);

  if (!rollout) {
    return (
      <Card size="small" title={<Space><RocketOutlined /><span>Контролируемый запуск</span></Space>}>
        <Alert type="info" showIcon message="Состояние запуска загружается…" />
      </Card>
    );
  }

  const mode = rolloutModeDisplay(rollout.rollout_mode);
  const targets = nextTransitionTargets(rollout.rollout_mode).filter((t) => t !== 'off');
  const circuit = circuitDisplay(rollout.circuit);

  const doTransition = async (t: string, conf: string) => {
    setTransitioning(true);
    try {
      const view = await transitionAiRollout(t, conf);
      onChanged(view);
      message.success(`Режим запуска: ${ROLLOUT_MODE_LABELS[view.rollout_mode] ?? view.rollout_mode}`);
      setTarget(null);
      setConfirmation('');
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setTransitioning(false);
    }
  };

  const doEmergencyOff = async () => {
    try {
      const view = await emergencyOffAiRollout('admin_ui');
      onChanged(view);
      message.warning('AI-подбор экстренно отключён (rollout = off).');
    } catch (e) {
      message.error(getErrorMessage(e));
    }
  };

  const saveLimits = async () => {
    setSavingLimits(true);
    try {
      const view = await updateAiRolloutSettings({
        ...(reqLimit !== null ? { daily_request_limit: reqLimit } : {}),
        ...(rowLimit !== null ? { daily_row_limit: rowLimit } : {}),
        ...(budget !== null ? { monthly_budget_usd: budget } : {}),
      });
      onChanged(view);
      message.success('Лимиты пилота сохранены (in-flight запросы инвалидированы).');
      setBudget(null); setReqLimit(null); setRowLimit(null);
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setSavingLimits(false);
    }
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <RocketOutlined />
          <span>Контролируемый запуск</span>
          <Tag color={mode.tone === 'success' ? 'green' : mode.tone === 'warning' ? 'orange' : 'default'}
            data-testid="ai-rollout-mode">
            {mode.text}
          </Tag>
        </Space>
      }
      extra={
        <Popconfirm
          title={EMERGENCY_OFF_LABEL}
          description={EMERGENCY_OFF_CONFIRM}
          okText="Отключить немедленно"
          okButtonProps={{ danger: true }}
          cancelText="Отмена"
          onConfirm={doEmergencyOff}
        >
          <Button danger icon={<AlertOutlined />} data-testid="ai-emergency-off">
            {EMERGENCY_OFF_LABEL}
          </Button>
        </Popconfirm>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size={10}>
        <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="Config hash">
            <Text code>{rollout.current_config_hash?.slice(0, 12) || '—'}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Версия конфигурации">{rollout.rollout_config_version}</Descriptions.Item>
          <Descriptions.Item label="Модель">{rollout.selected_model_id ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Тест модели">{rollout.model_test_status}</Descriptions.Item>
          <Descriptions.Item label="Live evaluation">
            {rollout.live_evaluation
              ? (rollout.live_evaluation.gates_passed && rollout.live_evaluation.current
                ? <Tag color="green">пройдена и актуальна</Tag>
                : <Tag color="orange">{rollout.live_evaluation.gates_passed ? 'неактуальна' : 'gate FAIL'}</Tag>)
              : <Tag>не выполнялась</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="Пилотных пользователей">{rollout.pilot_users_count}</Descriptions.Item>
          <Descriptions.Item label="Последнее изменение">
            {new Date(rollout.updated_at).toLocaleString('ru-RU')}
          </Descriptions.Item>
          <Descriptions.Item label="Единица стоимости">{rollout.cost_unit}</Descriptions.Item>
        </Descriptions>

        {/* Гейты переходов (§4/§16): hard-гейты сервер не даёт ослабить. */}
        {targets.map((t) => {
          const gates = rollout.next_transition_gates?.[t] ?? [];
          const ready = allGatesPassed(gates);
          return (
            <Card key={t} size="small" type="inner"
              title={<Space><SafetyOutlined /><span>Переход: {ROLLOUT_MODE_LABELS[t] ?? t}</span>
                {ready ? <Tag color="green">гейты пройдены</Tag> : <Tag color="orange">гейты не пройдены</Tag>}</Space>}
              extra={
                <Button type="primary" ghost disabled={!ready} loading={transitioning && target === t}
                  onClick={() => setTarget(t)} data-testid={`ai-transition-${t}`}>
                  Перейти
                </Button>
              }
            >
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                {gates.map((g) => (
                  <Text key={g.key} type={g.passed ? 'success' : 'danger'} data-testid={`ai-gate-${g.key}`}>
                    {g.passed ? '✓' : '✗'} {g.title}{g.detail ? ` — ${g.detail}` : ''}
                  </Text>
                ))}
              </Space>
            </Card>
          );
        })}

        {rollout.rollout_mode !== 'off' && (
          <Button onClick={() => doTransition('off', '')} data-testid="ai-transition-off">
            Перевести в «Выключен»
          </Button>
        )}

        {/* Circuit breaker (§10/§18.F). */}
        <Alert
          type={circuit.tone}
          showIcon
          icon={<ThunderboltOutlined />}
          message={circuit.text}
          data-testid="ai-circuit-state"
          description={rollout.circuit?.last_failure_code
            ? `Последняя ошибка: ${rollout.circuit.last_failure_code}; подряд отказов: ${rollout.circuit.consecutive_failures}`
            : undefined}
          action={
            <Popconfirm title="Сбросить circuit breaker?" okText="Сбросить" cancelText="Отмена"
              onConfirm={async () => {
                try {
                  await resetAiCircuit();
                  message.success('Circuit сброшен в closed.');
                } catch (e) {
                  message.error(getErrorMessage(e));
                }
              }}>
              <Button size="small" data-testid="ai-circuit-reset">Сбросить</Button>
            </Popconfirm>
          }
        />

        {/* Лимиты пилота (§18.C): операционные значения; hard-гейты качества
            (critical FP = 0 и т.п.) через UI не настраиваются. */}
        <Card size="small" type="inner" title="Лимиты пилота">
          <Space wrap>
            <span>
              <Text type="secondary">Запросов/день: </Text>
              <InputNumber min={1} max={10000} placeholder={String(rollout.daily_request_limit)}
                value={reqLimit ?? undefined} onChange={(v) => setReqLimit(v === null ? null : Number(v))} />
            </span>
            <span>
              <Text type="secondary">Строк/день: </Text>
              <InputNumber min={1} max={1000000} placeholder={String(rollout.daily_row_limit)}
                value={rowLimit ?? undefined} onChange={(v) => setRowLimit(v === null ? null : Number(v))} />
            </span>
            <span>
              <Text type="secondary">Бюджет/месяц (USD): </Text>
              <Input style={{ width: 120 }} placeholder={rollout.monthly_budget_usd?.toString() ?? 'не задан'}
                value={budget ?? ''} onChange={(e) => setBudget(e.target.value)} />
            </span>
            <Button loading={savingLimits} onClick={saveLimits}
              disabled={reqLimit === null && rowLimit === null && budget === null}
              data-testid="ai-save-limits">
              Сохранить лимиты
            </Button>
          </Space>
          <div>
            <Text type="secondary">
              Резерв на запрос: ${rollout.request_max_reserved_cost_usd} · circuit: {rollout.circuit_failure_threshold} отказ(а) /
              cooldown {rollout.circuit_cooldown_seconds}s · таймаут резервации {rollout.reservation_timeout_seconds}s
            </Text>
          </div>
        </Card>
      </Space>

      {/* Подтверждение перехода фразой = имя целевого режима (§17). */}
      <Modal
        open={target !== null}
        title={`Подтверждение перехода: ${target ? ROLLOUT_MODE_LABELS[target] ?? target : ''}`}
        okText="Выполнить переход"
        cancelText="Отмена"
        okButtonProps={{ disabled: confirmation !== target, loading: transitioning }}
        onOk={() => target && doTransition(target, confirmation)}
        onCancel={() => { setTarget(null); setConfirmation(''); }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text>Введите точное имя целевого режима для подтверждения: <Text code>{target}</Text></Text>
          <Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
            placeholder={target ?? ''} data-testid="ai-transition-confirmation" />
        </Space>
      </Modal>
    </Card>
  );
}
