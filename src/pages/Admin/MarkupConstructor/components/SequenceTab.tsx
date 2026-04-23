import React, { useState, useMemo } from 'react';
import {
  Space,
  Typography,
  InputNumber,
  Divider,
  Button,
  Select,
  Card,
  Popconfirm,
  theme,
  Tag,
  Input,
  Row,
  Col,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  SaveOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { TabKey, MarkupStep, ActionType, OperandType } from '../types';
import { ACTIONS } from '../constants';
import { useMarkupConstructorContext } from '../MarkupConstructorContext';

const { Text } = Typography;
const { Option, OptGroup } = Select;

interface SequenceTabProps {
  tabKey: TabKey;
}

export const SequenceTab: React.FC<SequenceTabProps> = ({ tabKey }) => {
  const { token } = theme.useToken();
  const { sequences, parameters, form } = useMarkupConstructorContext();
  const { markupSequences, addStep, updateStep, deleteStep, moveStepUp, moveStepDown } = sequences;
  const { markupParameters } = parameters;

  const sequence = markupSequences[tabKey] || [];

  // State for adding new step
  const [baseIndex, setBaseIndex] = useState<number>(-1);
  const [action1, setAction1] = useState<ActionType>('multiply');
  const [operand1Type, setOperand1Type] = useState<OperandType>('markup');
  const [operand1Value, setOperand1Value] = useState<string | number>('');

  // State for editing step names
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [editingStepName, setEditingStepName] = useState<string>('');

  // Base costs (simplified - in real app should come from form or state)
  const baseCost = form.getFieldValue(`base_cost_${tabKey}`) || 0;

  // Helper function to apply an action
  const applyAction = (base: number, action: ActionType, operand: number, type: OperandType): number => {
    switch (action) {
      case 'multiply':
        if (type === 'markup') {
          return base * (1 + operand / 100);
        }
        return base * operand;
      case 'divide':
        return operand !== 0 ? base / operand : base;
      case 'add':
        return base + operand;
      case 'subtract':
        return base - operand;
      default:
        return base;
    }
  };

  // Calculate intermediate results for each step
  const calculateIntermediateResults = useMemo(() => {
    const results: number[] = [];

    sequence.forEach((step) => {
      let baseValue: number;
      if (step.baseIndex === -1) {
        baseValue = baseCost;
      } else {
        baseValue = results[step.baseIndex] || baseCost;
      }

      let result = baseValue;

      // Apply operation 1
      if (step.operand1Type === 'markup' && step.operand1Key) {
        const markupValue = form.getFieldValue(step.operand1Key as string) || 0;
        result = applyAction(result, step.action1, markupValue, 'markup');
      } else if (step.operand1Type === 'step' && step.operand1Index !== undefined) {
        const stepValue = step.operand1Index === -1 ? baseCost : results[step.operand1Index] || 0;
        result = applyAction(result, step.action1, stepValue, 'step');
      } else if (step.operand1Type === 'number' && typeof step.operand1Key === 'number') {
        result = applyAction(result, step.action1, step.operand1Key, 'number');
      }

      results.push(result);
    });

    return results;
  }, [sequence, baseCost, form, markupParameters]);

  const formatCurrency = (value: number) => {
    return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatNumberWithSpaces = (value: number | undefined) => {
    if (!value) return '';
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  };

  const parseNumberWithSpaces = (value: string | undefined) => {
    if (!value) return 0;
    return parseFloat(value.replace(/\s/g, ''));
  };

  // Get available markups for select
  const availableMarkups = markupParameters.filter((p) => p.is_active);

  // Options for base index select
  const baseOptions = [
    { label: 'Базовая стоимость', value: -1 },
    ...sequence.map((step, index) => {
      const intermediateValue = calculateIntermediateResults[index];
      const stepLabel = step.name || `Пункт ${index + 1}`;
      return {
        label: `${stepLabel} (${formatCurrency(intermediateValue)} ₽)`,
        value: index,
      };
    }),
  ];

  // Options for operand select
  const operandOptions = (
    <>
      <OptGroup label="Наценки">
        {availableMarkups.map((markup) => (
          <Option key={`markup:${markup.key}`} value={`markup:${markup.key}`}>
            {markup.label} ({markup.default_value || 0}%)
          </Option>
        ))}
      </OptGroup>
      <OptGroup label="Базовая стоимость">
        <Option value="base:-1">Базовая стоимость ({formatCurrency(baseCost)} ₽)</Option>
      </OptGroup>
      {sequence.length > 0 && (
        <OptGroup label="Пункты">
          {sequence.map((step, index) => {
            const intermediateValue = calculateIntermediateResults[index];
            const stepLabel = step.name || `Пункт ${index + 1}`;
            return (
              <Option key={`step:${index}`} value={`step:${index}`}>
                {stepLabel} ({formatCurrency(intermediateValue)} ₽)
              </Option>
            );
          })}
        </OptGroup>
      )}
    </>
  );

  const handleAddStep = () => {
    if (!operand1Value) {
      return;
    }

    const newStep: MarkupStep = {
      baseIndex,
      action1,
      operand1Type,
    };

    // Parse operand value
    if (typeof operand1Value === 'string') {
      const [type, value] = operand1Value.split(':');
      if (type === 'markup') {
        newStep.operand1Type = 'markup';
        newStep.operand1Key = value;
      } else if (type === 'step') {
        newStep.operand1Type = 'step';
        newStep.operand1Index = parseInt(value);
      } else if (type === 'base') {
        newStep.operand1Type = 'step';
        newStep.operand1Index = -1;
      }
    } else if (typeof operand1Value === 'number') {
      newStep.operand1Type = 'number';
      newStep.operand1Key = operand1Value;
    }

    addStep(tabKey, newStep);

    // Reset form
    setBaseIndex(-1);
    setAction1('multiply');
    setOperand1Type('markup');
    setOperand1Value('');
  };

  const startEditingStepName = (index: number, currentName?: string) => {
    setEditingStepIndex(index);
    setEditingStepName(currentName || '');
  };

  const saveStepName = (index: number) => {
    const step = sequence[index];
    updateStep(tabKey, index, { ...step, name: editingStepName.trim() });
    setEditingStepIndex(null);
    setEditingStepName('');
  };

  const cancelEditingStepName = () => {
    setEditingStepIndex(null);
    setEditingStepName('');
  };

  const getStepFormula = (step: MarkupStep) => {
    // Get base name
    let baseName: string;
    if (step.baseIndex === -1) {
      baseName = 'Базовая';
    } else {
      baseName = sequence[step.baseIndex]?.name || `Пункт ${step.baseIndex + 1}`;
    }

    // Get operand1 name
    let op1Name = '?';
    let op1Value = '';
    if (step.operand1Type === 'markup' && step.operand1Key) {
      const markup = markupParameters.find((m) => m.key === step.operand1Key);
      op1Name = markup?.label || String(step.operand1Key);
      const markupValue = form.getFieldValue(step.operand1Key as string) || 0;
      op1Value = ` (${markupValue}%)`;
    } else if (step.operand1Type === 'step' && step.operand1Index !== undefined) {
      if (step.operand1Index === -1) {
        op1Name = 'Базовая стоимость';
      } else {
        op1Name = sequence[step.operand1Index]?.name || `Пункт ${step.operand1Index + 1}`;
      }
    } else if (step.operand1Type === 'number' && typeof step.operand1Key === 'number') {
      op1Name = String(step.operand1Key);
    }

    const action1Obj = ACTIONS.find((a) => a.value === step.action1);
    return `${baseName} ${action1Obj?.symbol} ${op1Name}${op1Value}`;
  };

  return (
    <div style={{ padding: '8px 0' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        {/* Base cost input */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: '4px' }}>
            Базовая (прямая) стоимость:
          </Text>
          <InputNumber
            value={baseCost}
            onChange={(value) => form.setFieldValue(`base_cost_${tabKey}`, value || 0)}
            style={{ width: '300px' }}
            min={0}
            step={0.01}
            precision={2}
            addonAfter="₽"
            placeholder="Введите базовую стоимость"
            formatter={formatNumberWithSpaces}
            parser={parseNumberWithSpaces}
          />
        </div>

        <Divider style={{ margin: '0' }}>Порядок расчета</Divider>

        {/* Sequence list */}
        {sequence.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px', color: token.colorTextTertiary }}>
            Наценки не добавлены. Используйте форму ниже для добавления наценок.
          </div>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <div
              style={{
                padding: '12px 16px',
                background: token.colorFillQuaternary,
                borderRadius: '4px',
                fontWeight: 500,
                fontSize: '15px',
              }}
            >
              Базовая стоимость: <Text type="success">{formatCurrency(baseCost)} ₽</Text>
            </div>

            {sequence.map((step, index) => {
              const intermediateResult = calculateIntermediateResults[index];
              const formula = getStepFormula(step, index);

              return (
                <Card
                  key={index}
                  size="small"
                  style={{ marginBottom: 8 }}
                  extra={
                    <Space>
                      <Button
                        type="text"
                        size="small"
                        icon={<ArrowUpOutlined />}
                        onClick={() => moveStepUp(tabKey, index)}
                        disabled={index === 0}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<ArrowDownOutlined />}
                        onClick={() => moveStepDown(tabKey, index)}
                        disabled={index === sequence.length - 1}
                      />
                      {editingStepIndex === index ? (
                        <>
                          <Button
                            type="text"
                            size="small"
                            icon={<SaveOutlined />}
                            onClick={() => saveStepName(index)}
                          />
                          <Button
                            type="text"
                            size="small"
                            icon={<CloseOutlined />}
                            onClick={cancelEditingStepName}
                          />
                        </>
                      ) : (
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => startEditingStepName(index, step.name)}
                        />
                      )}
                      <Popconfirm
                        title="Удалить пункт?"
                        onConfirm={() => deleteStep(tabKey, index)}
                        okText="Да"
                        cancelText="Нет"
                      >
                        <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  }
                  title={
                    editingStepIndex === index ? (
                      <Input
                        value={editingStepName}
                        onChange={(e) => setEditingStepName(e.target.value)}
                        placeholder={`Пункт ${index + 1}`}
                        onPressEnter={() => saveStepName(index)}
                      />
                    ) : (
                      <Space>
                        <Tag color="blue">Пункт {index + 1}</Tag>
                        {step.name && <Text strong>{step.name}</Text>}
                      </Space>
                    )
                  }
                >
                  <div>
                    <Text type="secondary">{formula}</Text>
                  </div>
                  <div>
                    <Text strong>Результат: </Text>
                    <Text type="success">{formatCurrency(intermediateResult)} ₽</Text>
                  </div>
                </Card>
              );
            })}

            <div
              style={{
                padding: '12px 16px',
                background: token.colorSuccessBg,
                borderRadius: '4px',
                fontWeight: 500,
                fontSize: '16px',
                border: `1px solid ${token.colorSuccess}`,
              }}
            >
              Итоговая стоимость:{' '}
              <Text type="success" strong>
                {formatCurrency(
                  calculateIntermediateResults.length > 0
                    ? calculateIntermediateResults[calculateIntermediateResults.length - 1]
                    : baseCost
                )}{' '}
                ₽
              </Text>
            </div>
          </Space>
        )}

        <Divider style={{ margin: '0' }}>Добавить новый пункт</Divider>

        {/* Add new step form */}
        <Card size="small" title="Создание нового пункта расчета">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Row gutter={8}>
              <Col span={12}>
                <Text>Базовое значение:</Text>
                <Select
                  style={{ width: '100%' }}
                  value={baseIndex}
                  onChange={setBaseIndex}
                  options={baseOptions}
                />
              </Col>
              <Col span={12}>
                <Text>Действие:</Text>
                <Select
                  style={{ width: '100%' }}
                  value={action1}
                  onChange={setAction1}
                  options={ACTIONS.map((a) => ({ label: a.label, value: a.value }))}
                />
              </Col>
            </Row>
            <Row gutter={8}>
              <Col span={24}>
                <Text>Операнд:</Text>
                <Select
                  style={{ width: '100%' }}
                  value={operand1Value}
                  onChange={setOperand1Value}
                  placeholder="Выберите наценку или пункт"
                >
                  {operandOptions}
                </Select>
              </Col>
            </Row>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddStep} block>
              Добавить пункт
            </Button>
          </Space>
        </Card>
      </Space>
    </div>
  );
};
