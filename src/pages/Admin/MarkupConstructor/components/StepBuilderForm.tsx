import React from 'react';
import { Space, Row, Col, Input, InputNumber, Select, Button, Radio } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { formatNumberWithSpaces, parseNumberWithSpaces } from '../../../../utils/numberFormat';
import type { TabKey, ActionType, OperandType, InputMode, MultiplyFormat, OperandState } from '../types';
import { ACTIONS } from '../constants';
import type { StepBuilder } from '../hooks/useStepBuilderState';

export interface SelectOption {
  label: string;
  value: string | number;
}

export interface OperandOptionGroup {
  label: string;
  options: SelectOption[];
}

type SetOperand<T> = React.Dispatch<React.SetStateAction<OperandState<T>>>;

// Форма добавления шага наценки (до 5 операций). 5 почти идентичных блоков
// исходника свёрнуты в один параметризованный рендер операции; различия
// (allowClear/каскад сброса/кнопка «+»/отступы) сохранены в конфигурации.
export const StepBuilderForm: React.FC<{
  tabKey: TabKey;
  builder: StepBuilder;
  baseOptions: SelectOption[];
  operandOptions: OperandOptionGroup[];
}> = ({ tabKey, builder: b, baseOptions, operandOptions }) => {
  const insertPosition = b.insertPositions[tabKey];
  const op1Value = b.operand1Value[tabKey];

  // Конфигурация операций 1..5 (индекс 0 = операция 1)
  const ops: {
    action: OperandState<ActionType>; setAction: SetOperand<ActionType>;
    type: OperandState<OperandType>; setType: SetOperand<OperandType>;
    value: OperandState<string | number | undefined>; setValue: SetOperand<string | number | undefined>;
    inputMode: OperandState<InputMode>; setInputMode: SetOperand<InputMode>;
    mulFormat: OperandState<MultiplyFormat>; setMulFormat: SetOperand<MultiplyFormat>;
  }[] = [
    { action: b.action1, setAction: b.setAction1, type: b.operand1Type, setType: b.setOperand1Type, value: b.operand1Value, setValue: b.setOperand1Value, inputMode: b.operand1InputMode, setInputMode: b.setOperand1InputMode, mulFormat: b.operand1MultiplyFormat, setMulFormat: b.setOperand1MultiplyFormat },
    { action: b.action2, setAction: b.setAction2, type: b.operand2Type, setType: b.setOperand2Type, value: b.operand2Value, setValue: b.setOperand2Value, inputMode: b.operand2InputMode, setInputMode: b.setOperand2InputMode, mulFormat: b.operand2MultiplyFormat, setMulFormat: b.setOperand2MultiplyFormat },
    { action: b.action3, setAction: b.setAction3, type: b.operand3Type, setType: b.setOperand3Type, value: b.operand3Value, setValue: b.setOperand3Value, inputMode: b.operand3InputMode, setInputMode: b.setOperand3InputMode, mulFormat: b.operand3MultiplyFormat, setMulFormat: b.setOperand3MultiplyFormat },
    { action: b.action4, setAction: b.setAction4, type: b.operand4Type, setType: b.setOperand4Type, value: b.operand4Value, setValue: b.setOperand4Value, inputMode: b.operand4InputMode, setInputMode: b.setOperand4InputMode, mulFormat: b.operand4MultiplyFormat, setMulFormat: b.setOperand4MultiplyFormat },
    { action: b.action5, setAction: b.setAction5, type: b.operand5Type, setType: b.setOperand5Type, value: b.operand5Value, setValue: b.setOperand5Value, inputMode: b.operand5InputMode, setInputMode: b.setOperand5InputMode, mulFormat: b.operand5MultiplyFormat, setMulFormat: b.setOperand5MultiplyFormat },
  ];

  // Видимость операций 2..5 и кнопки «добавить следующее действие»
  const shows = [b.showSecondAction, b.showThirdAction, b.showFourthAction, b.showFifthAction];
  const setShows = [b.setShowSecondAction, b.setShowThirdAction, b.setShowFourthAction, b.setShowFifthAction];
  const addTitles = ['Добавить второе действие', 'Добавить третье действие', 'Добавить четвертое действие', 'Добавить пятое действие'];

  // Каскадный сброс видимости при очистке операнда n (операции 2..5):
  // скрываем операции n..5 и чистим значение n (как в исходнике).
  const clearFromOperation = (n: number, setValue: SetOperand<string | number | undefined>) => {
    for (let i = n; i <= 5; i++) {
      setShows[i - 2](prev => ({ ...prev, [tabKey]: false }));
    }
    setValue(prev => ({ ...prev, [tabKey]: undefined }));
  };

  const renderOperation = (n: 1 | 2 | 3 | 4 | 5) => {
    const op = ops[n - 1];
    const act = op.action[tabKey];
    const opType = op.type[tabKey];
    const opVal = op.value[tabKey];
    const isLast = n === 5;
    const nextShown = !isLast ? shows[n - 1][tabKey] : false;

    return (
      <React.Fragment key={n}>
        <div style={{ marginBottom: 0 }}>
          <div style={{ marginBottom: 8 }}>
            <Radio.Group
              size="small"
              value={op.inputMode[tabKey]}
              onChange={(e) => {
                op.setInputMode(prev => ({ ...prev, [tabKey]: e.target.value }));
                if (e.target.value === 'manual') {
                  op.setType(prev => ({ ...prev, [tabKey]: 'number' }));
                  op.setValue(prev => ({ ...prev, [tabKey]: undefined }));
                } else {
                  op.setType(prev => ({ ...prev, [tabKey]: 'markup' }));
                  op.setValue(prev => ({ ...prev, [tabKey]: undefined }));
                }
              }}
            >
              <Radio.Button value="select">Выбрать</Radio.Button>
              <Radio.Button value="manual">Ввести число</Radio.Button>
            </Radio.Group>
          </div>

          <Row gutter={8} align="middle" style={isLast ? undefined : { marginBottom: 0 }}>
            <Col flex="120px">
              <Select
                placeholder="Действие"
                style={{ width: '100%' }}
                options={ACTIONS.map(a => ({ label: a.label, value: a.value }))}
                onChange={(value) => op.setAction(prev => ({ ...prev, [tabKey]: value }))}
                value={act}
                size="middle"
              />
            </Col>
            <Col flex="auto" style={{ maxWidth: 250 }}>
              {op.inputMode[tabKey] === 'select' ? (
                <Select
                  placeholder="Наценка/Пункт"
                  style={{ width: '100%' }}
                  options={operandOptions}
                  onChange={(value: string) => {
                    if (n === 1) {
                      const [type, val] = value.split(':');
                      if (type === 'base') {
                        op.setType(prev => ({ ...prev, [tabKey]: 'step' }));
                        op.setValue(prev => ({ ...prev, [tabKey]: -1 }));
                      } else {
                        op.setType(prev => ({ ...prev, [tabKey]: type as OperandType }));
                        op.setValue(prev => ({ ...prev, [tabKey]: type === 'markup' ? val : Number(val) }));
                      }
                      return;
                    }
                    if (value) {
                      const [type, val] = value.split(':');
                      if (type === 'base') {
                        op.setType(prev => ({ ...prev, [tabKey]: 'step' }));
                        op.setValue(prev => ({ ...prev, [tabKey]: -1 }));
                      } else {
                        op.setType(prev => ({ ...prev, [tabKey]: type as OperandType }));
                        op.setValue(prev => ({ ...prev, [tabKey]: type === 'markup' ? val : Number(val) }));
                      }
                    } else {
                      op.setValue(prev => ({ ...prev, [tabKey]: undefined }));
                    }
                  }}
                  value={opVal !== undefined && opType !== 'number' ? (opVal === -1 ? 'base:-1' : `${opType}:${opVal}`) : undefined}
                  allowClear={n > 1}
                  onClear={n > 1 ? () => clearFromOperation(n, op.setValue) : undefined}
                  size="middle"
                />
              ) : (
                <InputNumber
                  placeholder="Введите число"
                  style={{ width: '100%' }}
                  value={typeof opVal === 'number' ? opVal : undefined}
                  onChange={(value) => {
                    op.setValue(prev => ({ ...prev, [tabKey]: value || 0 }));
                  }}
                  formatter={formatNumberWithSpaces}
                  parser={parseNumberWithSpaces}
                  size="middle"
                />
              )}
            </Col>
            {!isLast && (
              <Col flex="none">
                {!shows[n - 1][tabKey] && (
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => setShows[n - 1](prev => ({ ...prev, [tabKey]: true }))}
                    title={addTitles[n - 1]}
                    size="middle"
                    style={{ minWidth: 32, padding: '4px 8px' }}
                  />
                )}
              </Col>
            )}
          </Row>
        </div>
        {act === 'multiply' && opType === 'markup' && (
          <Row style={isLast ? { marginTop: 8, marginLeft: 128 } : { marginBottom: nextShown ? 12 : 0, marginTop: 8, marginLeft: 128 }}>
            <Col>
              <Radio.Group
                size="small"
                value={op.mulFormat[tabKey]}
                onChange={(e) => op.setMulFormat(prev => ({ ...prev, [tabKey]: e.target.value }))}
              >
                <Radio.Button value="addOne">1 + %</Radio.Button>
                <Radio.Button value="direct">%</Radio.Button>
              </Radio.Group>
            </Col>
          </Row>
        )}
        {!isLast && !(act === 'multiply' && opType === 'markup') && (
          <div style={{ marginBottom: nextShown ? 12 : 0 }} />
        )}
      </React.Fragment>
    );
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={24}>
      {/* Поле 1: Название (компактное, выровнено с полем База) */}
      <Row gutter={[8, 0]} align="middle" style={{ marginBottom: 12 }}>
        <Col flex="none" style={{ width: 80 }}>
          <span style={{ fontSize: 13, color: '#888' }}>Название:</span>
        </Col>
        <Col flex="auto" style={{ maxWidth: 320 }}>
          <Input
            placeholder="Название пункта"
            value={b.stepName[tabKey]}
            onChange={(e) => b.setStepName(prev => ({ ...prev, [tabKey]: e.target.value }))}
            allowClear
            size="small"
            style={{ width: '100%' }}
          />
        </Col>
      </Row>

      {/* Секция базы */}
      <Row gutter={[8, 0]} align="middle" style={{ marginBottom: 12 }}>
        <Col flex="none" style={{ width: 80 }}>
          <span style={{ fontSize: 13, color: '#888' }}>База:</span>
        </Col>
        <Col flex="auto" style={{ maxWidth: 320 }}>
          <Select
            placeholder="Выберите базу для расчета"
            style={{ width: '100%' }}
            options={baseOptions}
            onChange={(value) => b.setInsertPositions(prev => ({ ...prev, [tabKey]: value }))}
            value={insertPosition}
            size="middle"
          />
        </Col>
      </Row>

      {/* Секция операций */}
      <div style={{ maxWidth: 460 }}>
        <div style={{
          background: 'rgba(16, 185, 129, 0.05)',
          border: '1px solid rgba(16, 185, 129, 0.15)',
          borderRadius: 6,
          padding: '16px'
        }}>
          <div style={{
            fontSize: 13,
            fontWeight: 500,
            color: '#10b981',
            marginBottom: 16
          }}>
            Операции
          </div>

          <Space direction="vertical" style={{ width: '100%' }} size={0}>
            {/* Операция 1 (обязательная) */}
            {renderOperation(1)}
            {/* Операции 2-5 (опциональные) */}
            {b.showSecondAction[tabKey] && renderOperation(2)}
            {b.showThirdAction[tabKey] && renderOperation(3)}
            {b.showFourthAction[tabKey] && renderOperation(4)}
            {b.showFifthAction[tabKey] && renderOperation(5)}
          </Space>
        </div>

        {/* Кнопка добавить (под зеленым блоком) */}
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={insertPosition === undefined || op1Value === undefined}
            onClick={() => b.addMarkup(tabKey)}
            size="middle"
          >
            Добавить
          </Button>
        </div>
      </div>
    </Space>
  );
};
