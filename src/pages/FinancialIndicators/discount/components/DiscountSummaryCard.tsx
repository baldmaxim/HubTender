import { memo } from 'react';
import { Card, Col, Row, Statistic, Typography } from 'antd';
import { ArrowDownOutlined } from '@ant-design/icons';
import type { DiscountContext } from '../types';

const { Text } = Typography;

const formatMoney = (value: number): string =>
  value.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

interface DiscountSummaryCardProps {
  discount: DiscountContext;
  isPhone: boolean;
}

/**
 * Сводка «Было / Снижение / Стало» над вкладками. Рендерится только когда
 * снижение включено и применено — при выключенном тумблере страница выглядит
 * ровно как раньше.
 */
function DiscountSummaryCardImpl({ discount, isPhone }: DiscountSummaryCardProps) {
  const { baseGrandTotal, reducedGrandTotal, appliedAmount } = discount;
  const percent = baseGrandTotal > 0 ? (appliedAmount / baseGrandTotal) * 100 : 0;
  const failedRules = discount.errorsByRule.size;
  const isZeroing = discount.mode === 'zeroing';
  const changeTitle = isZeroing ? 'Обнулено' : 'Снижение';
  const afterTitle = isZeroing ? 'Стоимость после обнуления' : 'Стоимость после снижения';

  return (
    <Card
      size="small"
      style={{ marginBottom: 12, borderColor: '#faad14' }}
      styles={{ body: { padding: isPhone ? 12 : 16 } }}
    >
      <Row gutter={[16, 12]} align="middle">
        <Col xs={24} sm={8}>
          <Statistic
            title={isZeroing ? 'Стоимость до обнуления' : 'Стоимость до снижения'}
            value={formatMoney(baseGrandTotal)}
            valueStyle={{ fontSize: isPhone ? 18 : 22 }}
          />
        </Col>
        <Col xs={24} sm={8}>
          <Statistic
            title={changeTitle}
            value={formatMoney(appliedAmount)}
            prefix={<ArrowDownOutlined />}
            suffix={<Text type="secondary" style={{ fontSize: 13 }}>{`${percent.toFixed(2)} %`}</Text>}
            valueStyle={{ fontSize: isPhone ? 18 : 22, color: '#cf1322' }}
          />
        </Col>
        <Col xs={24} sm={8}>
          <Statistic
            title={afterTitle}
            value={formatMoney(reducedGrandTotal)}
            valueStyle={{ fontSize: isPhone ? 18 : 22, color: '#10b981' }}
          />
        </Col>
      </Row>
      {failedRules > 0 && (
        <Text type="warning" style={{ display: 'block', marginTop: 8, fontSize: 13 }}>
          {`Не применено итераций: ${failedRules} — откройте вкладку «Снижение», чтобы исправить.`}
        </Text>
      )}
    </Card>
  );
}

export const DiscountSummaryCard = memo(DiscountSummaryCardImpl);
