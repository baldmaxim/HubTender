import React from 'react';
import { Typography, Space, Row, Col, Tag, Button, theme } from 'antd';
import { EditOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import type { MarkupParameter, MarkupStep } from '../../../../lib/types';
import type { TabKey } from '../types';
import type { StepBuilder } from '../hooks/useStepBuilderState';
import { buildStepFormula, buildDetailedFormula } from '../utils/formulaDisplay';
import type { GetPercent } from '../utils/sequenceCalc';

const { Text } = Typography;

/** Список шагов последовательности наценок с формулами и действиями. */
export const SequenceStepList: React.FC<{
  tabKey: TabKey;
  sequence: MarkupStep[];
  intermediateResults: number[];
  baseCost: number;
  markupParameters: MarkupParameter[];
  getPercent: GetPercent;
  builder: StepBuilder;
}> = ({ tabKey, sequence, intermediateResults, baseCost, markupParameters, getPercent, builder }) => {
  const { token } = theme.useToken();
  const finalResult = intermediateResults.length > 0 ? intermediateResults[intermediateResults.length - 1] : baseCost;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <div style={{ padding: '12px 16px', background: token.colorFillQuaternary, borderRadius: '4px', fontWeight: 500, fontSize: '15px' }}>
        Базовая стоимость: <Text type="success">{baseCost.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</Text>
      </div>
      {sequence.map((step, index) => {
        const intermediateResult = intermediateResults[index];
        const ctx = { baseCost, intermediateResults, markupParameters, getPercent };
        const formula = buildStepFormula(step, ctx);
        const detailedFormula = buildDetailedFormula(step, ctx);

        return (
          <div
            key={`${index}`}
            style={{
              padding: '8px 12px',
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorder}`,
              borderRadius: '4px',
              marginBottom: '4px'
            }}
          >
            <Row gutter={[16, 8]} align="middle">
              <Col flex="auto">
                <Space direction="vertical" size={0}>
                  <Space>
                    <Tag color="blue">{index + 1}</Tag>
                    {step.name && <Tag color="green">{step.name}</Tag>}
                    <Text type="secondary" style={{ fontSize: '13px' }}>
                      {formula}
                    </Text>
                    <Text strong style={{ color: token.colorInfo }}>
                      → {intermediateResult.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
                    </Text>
                  </Space>
                  <Text type="secondary" style={{ fontSize: '12px', marginLeft: '32px' }}>
                    {detailedFormula}
                  </Text>
                </Space>
              </Col>
              <Col flex="none">
                <Space>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => builder.editMarkup(tabKey, index)}
                    title="Редактировать"
                  />
                  <Button
                    size="small"
                    icon={<ArrowUpOutlined />}
                    onClick={() => builder.moveMarkupUp(tabKey, index)}
                    disabled={index === 0}
                  />
                  <Button
                    size="small"
                    icon={<ArrowDownOutlined />}
                    onClick={() => builder.moveMarkupDown(tabKey, index)}
                    disabled={index === sequence.length - 1}
                  />
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => builder.removeMarkup(tabKey, index)}
                  />
                </Space>
              </Col>
            </Row>
          </div>
        );
      })}
      <div style={{ padding: '12px 16px', background: token.colorInfoBg, borderRadius: '4px', fontWeight: 500, color: token.colorInfo, fontSize: '15px' }}>
        → Коммерческая стоимость: <Text strong style={{ color: token.colorInfo }}>{finalResult.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</Text>
      </div>
    </Space>
  );
};
