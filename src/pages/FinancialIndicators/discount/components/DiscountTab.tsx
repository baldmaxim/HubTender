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
  Radio,
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
import { commercialOf } from '../utils/markupMultipliers';
import type { DiscountWorkspace } from '../utils/buildWorkspace';
import { DiscountPositionsTable } from './DiscountPositionsTable';
import { buildDiscountPositionRows, buildZeroingPositionRows } from '../utils/positionRows';
import { ZeroingPositionsTable } from './ZeroingPositionsTable';

const { Text } = Typography;

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
    mode,
    rules,
    amount,
    selectedIds,
    zeroedIds,
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
    setZeroedIds,
    setMode,
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
    () => (workspace ? buildDiscountPositionRows(positions, workspace.reducibles, appliedAlpha) : []),
    [positions, workspace, appliedAlpha],
  );

  // Полная коммерческая стоимость каждой позиции — для режима «Обнуление».
  const commercialByPosition = useMemo(() => {
    const m = new Map<string, number>();
    if (workspace) {
      for (const [id, full] of workspace.fullByPosition) m.set(id, commercialOf(full, workspace.multipliers));
    }
    return m;
  }, [workspace]);

  const zeroingRows = useMemo(
    () => (workspace ? buildZeroingPositionRows(positions, commercialByPosition) : []),
    [positions, workspace, commercialByPosition],
  );

  const loading = loadingWorkspace || loadingPositions;

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin tip="Подготовка данных…" />
      </div>
    );
  }

  if (!workspace || positions.length === 0) {
    return (
      <Empty
        description={
          <Space direction="vertical" size={4}>
            <Text strong>Нет данных</Text>
            <Text type="secondary">В тендере нет строк Заказчика или не удалось рассчитать наценки.</Text>
          </Space>
        }
      />
    );
  }

  const canApply = amount > 0 && selectedIds.size > 0 && previewErrors.length === 0;

  const saveButton = (
    <Button
      type="primary"
      icon={<SaveOutlined />}
      size="middle"
      loading={saving}
      disabled={!dirty}
      onClick={save}
      style={{ flex: 1 }}
    >
      {dirty ? 'Сохранить' : 'Сохранено'}
    </Button>
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small">
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space wrap>
            <Switch checked={enabled} onChange={toggleEnabled} />
            <Text strong>Применять снижение</Text>
            {enabled ? <Tag color="orange">Включено</Tag> : <Tag>Выключено</Tag>}
          </Space>
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            disabled={!enabled}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="discount">Снижение</Radio.Button>
            <Radio.Button value="zeroing">Обнуление</Radio.Button>
          </Radio.Group>
        </Space>
      </Card>

      {mode === 'discount' ? (
        <>
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
                      <Button key="remove" type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeIteration(index)} />,
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
              <Col xs={24} md={9}>
                <InputNumber
                  style={{ width: '100%' }}
                  size="middle"
                  min={0}
                  step={1000}
                  value={amount || null}
                  onChange={(value) => setAmount(Number(value) || 0)}
                  placeholder="Сумма снижения, ₽"
                  addonAfter="₽"
                />
              </Col>
              <Col xs={24} md={6}>
                <Text type="secondary">{`Доступно по выборке: ${formatMoney(previewCapacity)} ₽`}</Text>
              </Col>
              <Col xs={24} md={9}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button type="primary" size="middle" disabled={!canApply} onClick={applyIteration} style={{ flex: 1 }}>
                    Применить итерацию
                  </Button>
                  {saveButton}
                </div>
              </Col>
            </Row>
            {previewErrors.length > 0 && (
              <Alert type="warning" showIcon style={{ marginTop: 12 }} message={previewErrors[0].message} />
            )}
          </Card>

          <DiscountPositionsTable
            rows={tableRows}
            positions={positions}
            selectedIds={selectedIds}
            disabled={saving}
            onSelectionChange={setSelectedIds}
          />
        </>
      ) : (
        <ZeroingPositionsTable
          rows={zeroingRows}
          positions={positions}
          selectedIds={zeroedIds}
          disabled={saving}
          onSelectionChange={setZeroedIds}
          extra={
            <Button
              type="primary"
              icon={<SaveOutlined />}
              size="small"
              loading={saving}
              disabled={!dirty}
              onClick={save}
              style={{ width: isPhone ? 120 : 130 }}
            >
              {dirty ? 'Сохранить' : 'Сохранено'}
            </Button>
          }
        />
      )}
    </Space>
  );
};
