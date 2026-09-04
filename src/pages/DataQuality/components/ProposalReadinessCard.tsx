import React, { useMemo } from 'react';
import { Card, Space, Tag, Typography, Alert } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, MinusCircleOutlined } from '@ant-design/icons';
import type { QualityFinding, QualityRule } from '../../../lib/api/quality';
import { computeProposalReadiness } from '../../../lib/quality/findingsPolicy';

const { Text } = Typography;

interface Props {
  findings: QualityFinding[];
  rules: QualityRule[];
  isPhone: boolean;
}

const STATUS_META = {
  ok: { color: 'green', icon: <CheckCircleOutlined /> },
  findings: { color: 'red', icon: <CloseCircleOutlined /> },
  not_checked: { color: 'default', icon: <MinusCircleOutlined /> },
} as const;

/**
 * Готовность к сборке формы КП — ручной чек-лист проверяющего одним взглядом:
 * количество ГП во всех расценённых позициях и обоснование во всех пустых.
 *
 * Проверка, у которой правило выключено в каталоге, показывается серой
 * «не проверяется», а не зелёной: пустой список находок у выключенного правила
 * означает, что его не запускали, а не что всё в порядке.
 */
export const ProposalReadinessCard: React.FC<Props> = ({ findings, rules, isPhone }) => {
  const state = useMemo(() => computeProposalReadiness(findings, rules), [findings, rules]);

  return (
    <Card
      size="small"
      title="Готовность к сборке формы КП"
      extra={
        state.ready ? (
          <Tag color="green">готов</Tag>
        ) : state.findingsCount > 0 ? (
          <Tag color="red">замечаний: {state.findingsCount}</Tag>
        ) : (
          <Tag>не подтверждено</Tag>
        )
      }
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space direction={isPhone ? 'vertical' : 'horizontal'} size={isPhone ? 6 : 12} wrap>
          {state.checks.map((c) => {
            const meta = STATUS_META[c.status];
            return (
              <Tag key={c.code} color={meta.color} icon={meta.icon}>
                {c.label}
                {c.status === 'findings' && `: ${c.count}`}
                {c.status === 'not_checked' && ' — не проверяется'}
              </Tag>
            );
          })}
        </Space>

        {state.notCheckedCount > 0 && (
          <Alert
            type="info"
            showIcon
            message={
              <Text style={{ fontSize: 13 }}>
                Часть проверок выключена в каталоге правил (статус «черновик») и не
                выполняется. Пустой результат по ним не означает, что нарушений нет.
              </Text>
            }
          />
        )}
      </Space>
    </Card>
  );
};
