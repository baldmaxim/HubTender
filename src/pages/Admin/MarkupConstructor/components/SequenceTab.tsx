import React from 'react';
import { Typography, Space, InputNumber, Divider, theme } from 'antd';
import { formatNumberWithSpaces, parseNumberWithSpaces } from '../../../../utils/numberFormat';
import type { MarkupParameter, MarkupStep } from '../../../../lib/types';
import type { TabKey } from '../types';
import type { StepBuilder } from '../hooks/useStepBuilderState';
import { calculateIntermediateResults, type GetPercent } from '../utils/sequenceCalc';
import { SequenceStepList } from './SequenceStepList';
import { StepBuilderForm } from './StepBuilderForm';

const { Text } = Typography;

// Вкладка последовательности наценок одного типа позиций: базовая стоимость,
// список шагов и форма добавления. Перенесено из renderMarkupSequenceTab.
export const SequenceTab: React.FC<{
  tabKey: TabKey;
  markupSequences: Record<TabKey, MarkupStep[]>;
  baseCosts: Record<TabKey, number>;
  setBaseCosts: React.Dispatch<React.SetStateAction<Record<TabKey, number>>>;
  markupParameters: MarkupParameter[];
  getPercent: GetPercent;
  builder: StepBuilder;
}> = ({ tabKey, markupSequences, baseCosts, setBaseCosts, markupParameters, getPercent, builder }) => {
  const { token } = theme.useToken();
  const sequence = markupSequences[tabKey];
  const availableMarkups = markupParameters;

  // Получаем промежуточные результаты
  const intermediateResults = calculateIntermediateResults(sequence, baseCosts[tabKey], getPercent);

  // Опции для выбора базовой стоимости или пункта
  const baseOptions = [
    { label: 'Базовая стоимость', value: -1 }
  ];

  sequence.forEach((step, index) => {
    const intermediateValue = intermediateResults[index];
    const stepLabel = step.name
      ? `${step.name} (${intermediateValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽)`
      : `Пункт ${index + 1} (${intermediateValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽)`;
    baseOptions.push({
      label: stepLabel,
      value: index
    });
  });

  // Опции для выбора операндов (наценки или пункты) с группировкой
  const markupOptionsList = availableMarkups.map(markup => ({
    label: `${markup.label} (${parseFloat((markup.default_value || 0).toFixed(5))}%)`,
    value: `markup:${markup.key}`
  }));

  const stepOptionsList = sequence.map((step, index) => {
    const intermediateValue = intermediateResults[index];
    const stepLabel = step.name
      ? `${step.name} (${intermediateValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽)`
      : `Пункт ${index + 1} (${intermediateValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽)`;
    return {
      label: stepLabel,
      value: `step:${index}`
    };
  });

  const baseCostOptionsList = [{
    label: `Базовая стоимость (${baseCosts[tabKey].toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽)`,
    value: 'base:-1'
  }];

  const operandOptions = [
    {
      label: 'Наценки',
      options: markupOptionsList
    },
    {
      label: 'Базовая стоимость',
      options: baseCostOptionsList
    },
    ...(stepOptionsList.length > 0 ? [{
      label: 'Пункты',
      options: stepOptionsList
    }] : [])
  ];

  return (
    <div style={{ padding: '8px 0' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        {/* Базовая стоимость */}
        <div>
          <Text strong style={{ display: 'block', marginBottom: '4px' }}>Базовая (прямая) стоимость:</Text>
          <InputNumber
            value={baseCosts[tabKey]}
            onChange={(value) => setBaseCosts(prev => ({ ...prev, [tabKey]: value || 0 }))}
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

        {/* Список наценок в порядке применения */}
        {sequence.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px', color: token.colorTextTertiary }}>
            Наценки не добавлены. Используйте форму ниже для добавления наценок.
          </div>
        ) : (
          <SequenceStepList
            tabKey={tabKey}
            sequence={sequence}
            intermediateResults={intermediateResults}
            baseCost={baseCosts[tabKey]}
            markupParameters={markupParameters}
            getPercent={getPercent}
            builder={builder}
          />
        )}

        <Divider style={{ margin: '8px 0' }}>Добавить наценку</Divider>

        {/* Добавление наценки */}
        <StepBuilderForm
          tabKey={tabKey}
          builder={builder}
          baseOptions={baseOptions}
          operandOptions={operandOptions}
        />
      </Space>
    </div>
  );
};
