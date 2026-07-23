import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  InputNumber,
  List,
  Popconfirm,
  Row,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { fetchPositionsWithCosts, type PositionWithCostsRow } from '../../../../lib/api/positions';
import type { FiDiscountSettings } from '../../../../lib/api/fiDiscounts';
import { useFiDiscount } from '../hooks/useFiDiscount';
import type { DiscountWorkspace } from '../utils/buildWorkspace';
import { DiscountPositionsTable } from './DiscountPositionsTable';
import { buildDiscountPositionRows } from '../utils/positionRows';

const { Text, Paragraph } = Typography;

const formatMoney = (value: number): string =>
  value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface DiscountTabProps {
  tenderId: string;
  settings: FiDiscountSettings | null;
  getDiscountWorkspace: () => Promise<DiscountWorkspace | null>;
  onSaved: () => void;
  isPhone: boolean;
}

export const DiscountTab: React.FC<DiscountTabProps> = ({
  tenderId,
  settings,
  getDiscountWorkspace,
  onSaved,
  isPhone,
}) => {
  const {
    enabled,
    rules,
    amount,
    selectedIds,
    workspace,
    loadingWorkspace,
    saving,
    dirty,
    appliedAlpha,
    previewCapacity,
    previewErrors,
    totalDiscount,
    setAmount,
    setSelectedIds,
    toggleEnabled,
    applyIteration,
    removeIteration,
    resetIterations,
    save,
  } = useFiDiscount({ tenderId, settings, getDiscountWorkspace, onSaved });

  const [positions, setPositions] = useState<PositionWithCostsRow[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingPositions(true);
    fetchPositionsWithCosts(tenderId)
      .then((rows) => {
        if (!cancelled) setPositions(rows);
      })
      .catch((error) => {
        console.error('Ошибка загрузки позиций:', error);
        if (!cancelled) setPositions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingPositions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenderId]);

  const tableRows = useMemo(
    () =>
      workspace
        ? buildDiscountPositionRows(positions, workspace.reducibles, appliedAlpha)
        : [],
    [positions, workspace, appliedAlpha],
  );

  const loading = loadingWorkspace || loadingPositions;

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin tip="Подготовка данных снижения…" />
      </div>
    );
  }

  if (!workspace || positions.length === 0) {
    return (
      <Empty
        description={
          <Space direction="vertical" size={4}>
            <Text strong>Нет данных для снижения</Text>
            <Text type="secondary">В тендере нет строк Заказчика или не удалось рассчитать наценки.</Text>
          </Space>
        }
      />
    );
  }

  const canApply = amount > 0 && selectedIds.size > 0 && previewErrors.length === 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small">
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Space wrap>
            <Switch checked={enabled} onChange={toggleEnabled} />
            <Text strong>Применять снижение</Text>
            {enabled ? <Tag color="orange">Включено</Tag> : <Tag>Выключено</Tag>}
          </Space>
          <Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
            Пока тумблер выключен, показатели считаются как обычно. Настроенные итерации
            при этом сохраняются — их можно вернуть в работу в любой момент.
          </Paragraph>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {`Всего доступно к снижению по тендеру: ${formatMoney(workspace.totalReducible)} ₽`}
          </Text>
        </Space>
      </Card>

      <Alert
        type="info"
        showIcon
        message="Что именно снижается"
        description={
          'Снижение снимается со стоимости работ: сами работы, субподряд, запас на сдачу ' +
          'и вспомогательные материалы. Прямые затраты основных материалов не трогаются, ' +
          'поэтому колонка «Итого материалы» на Перераспределении остаётся прежней. ' +
          'Базовая стоимость сниженных строк пересчитывается обратным ходом через ' +
          'проценты наценок и конструктор наценок этого тендера.'
        }
      />

      {rules.length > 0 && (
        <Card
          size="small"
          title={
            <Space>
              <Text strong>Применённые итерации</Text>
              <Tag color="purple">{rules.length}</Tag>
              <Text type="secondary">{`на ${formatMoney(totalDiscount)} ₽`}</Text>
            </Space>
          }
          extra={
            <Popconfirm title="Удалить все итерации снижения?" okText="Удалить" cancelText="Отмена" onConfirm={resetIterations}>
              <Button danger size="small">
                Сбросить все
              </Button>
            </Popconfirm>
          }
          styles={{ body: { padding: 0 } }}
        >
          <List
            size="small"
            dataSource={rules}
            renderItem={(rule, index) => (
              <List.Item
                actions={[
                  <Button
                    key="remove"
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => removeIteration(index)}
                  />,
                ]}
              >
                <Space size="middle" wrap>
                  <Text strong>{`#${index + 1}`}</Text>
                  <Tag color="red">Снижение</Tag>
                  <Text>{`${formatMoney(rule.amount)} ₽`}</Text>
                  <Text type="secondary">{`${rule.positionIds.length} строк`}</Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      )}

      <Card size="small" title={<Text strong>Новая итерация</Text>}>
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={10}>
            <InputNumber
              style={{ width: '100%' }}
              size={isPhone ? 'middle' : 'large'}
              min={0}
              step={1000}
              value={amount || null}
              onChange={(value) => setAmount(Number(value) || 0)}
              placeholder="Сумма снижения, ₽"
              addonAfter="₽"
            />
          </Col>
          <Col xs={24} md={8}>
            <Text type="secondary">
              {`Доступно по выборке: ${formatMoney(previewCapacity)} ₽`}
            </Text>
          </Col>
          <Col xs={24} md={6}>
            <Button type="primary" block disabled={!canApply} onClick={applyIteration}>
              Применить итерацию
            </Button>
          </Col>
        </Row>
        {previewErrors.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            message={previewErrors[0].message}
          />
        )}
      </Card>

      <DiscountPositionsTable
        rows={tableRows}
        positions={positions}
        selectedIds={selectedIds}
        disabled={saving}
        onSelectionChange={setSelectedIds}
      />

      <div style={{ textAlign: 'right' }}>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          size={isPhone ? 'middle' : 'large'}
          block={isPhone}
          loading={saving}
          disabled={!dirty}
          onClick={save}
        >
          {dirty ? 'Сохранить снижение' : 'Сохранено'}
        </Button>
      </div>
    </Space>
  );
};
