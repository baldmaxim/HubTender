import React from 'react';
import { Avatar, Button, Card, Space, Tag, Typography, theme } from 'antd';
import type { TenderIterationWithRelations } from '../../../lib/supabase/types';
import {
  formatAmount,
  formatDate,
  getInitials,
  getRoleAvatarColor,
  getRoleLabel,
} from '../utils/timeline.utils';

const { Text, Paragraph } = Typography;

interface IterationCardProps {
  iteration: TenderIterationWithRelations;
  canRespond?: boolean;
  onRespond?: (iteration: TenderIterationWithRelations) => void;
}

function getDecisionConfig(
  iteration: TenderIterationWithRelations,
  token: ReturnType<typeof theme.useToken>['token']
) {
  switch (iteration.approval_status) {
    case 'approved':
      return {
        cardColor: token.colorInfoBg,
        resultBackground: token.colorSuccessBg,
        resultBorder: token.colorSuccessBorder,
        resultText: '',
      };
    case 'rejected':
      return {
        cardColor: token.colorErrorBg,
        resultBackground: token.colorErrorBg,
        resultBorder: token.colorErrorBorder,
        resultText: 'Требуется доработка',
      };
    default:
      return {
        cardColor: token.colorFillAlter,
        resultBackground: token.colorWarningBg,
        resultBorder: token.colorWarningBorder,
        resultText: '',
      };
  }
}

const IterationCard: React.FC<IterationCardProps> = ({
  iteration,
  canRespond = false,
  onRespond,
}) => {
  const { token } = theme.useToken();
  const config = getDecisionConfig(iteration, token);

  return (
    <Card
      size="small"
      style={{
        background: token.colorBgContainer,
        borderColor: token.colorBorderSecondary,
      }}
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <div>
          <Space align="start">
            <Avatar
              style={{
                backgroundColor: getRoleAvatarColor(iteration.user?.role_code || ''),
              }}
            >
              {getInitials(iteration.user?.full_name || '')}
            </Avatar>
            <div>
              <div>
                <Text strong>{iteration.user?.full_name || 'Пользователь'}</Text>
                <Text type="secondary"> · {getRoleLabel(iteration.user?.role_code || '')}</Text>
              </div>
              <Text type="secondary">
                Данные {iteration.iteration_number} · {formatDate(iteration.submitted_at)}
              </Text>
            </div>
          </Space>
        </div>

        <div
          style={{
            background: token.colorFillAlter,
            borderRadius: 8,
            padding: 12,
          }}
        >
          <Paragraph style={{ marginBottom: 8 }}>{iteration.user_comment}</Paragraph>
          {iteration.user_amount != null ? <Text strong>Итоговая сумма: {formatAmount(iteration.user_amount)}</Text> : null}
        </div>

        {(iteration.manager_comment || iteration.manager_id) ? (
          <>
            <div style={{ width: 1, height: 16, background: token.colorBorder, marginLeft: 16 }} />

            <div>
              <Space align="start">
                <Avatar
                  style={{
                    backgroundColor: getRoleAvatarColor(iteration.manager?.role_code || 'director'),
                  }}
                >
                  {getInitials(iteration.manager?.full_name || 'Руководитель')}
                </Avatar>
                <div>
                  <div>
                    <Text strong>{iteration.manager?.full_name || 'Руководитель'}</Text>
                    <Text type="secondary"> · {getRoleLabel(iteration.manager?.role_code || 'director')}</Text>
                  </div>
                  <Text type="secondary">{formatDate(iteration.manager_responded_at)}</Text>
                </div>
              </Space>
            </div>

            {iteration.manager_comment ? (
              <div
                style={{
                  background: config.cardColor,
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <Paragraph style={{ marginBottom: 0 }}>{iteration.manager_comment}</Paragraph>
              </div>
            ) : null}
          </>
        ) : null}

        <div
          style={{
            borderRadius: 8,
            padding: 12,
            background: config.resultBackground,
            border: `1px solid ${config.resultBorder}`,
          }}
        >
          <Space wrap size={[8, 8]} style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space wrap size={[8, 8]}>
              <Tag
                color={
                  iteration.approval_status === 'approved'
                    ? 'success'
                    : iteration.approval_status === 'rejected'
                      ? 'error'
                      : 'warning'
                }
              >
                {iteration.approval_status === 'approved'
                  ? 'Согласовано'
                  : iteration.approval_status === 'rejected'
                    ? 'Отказано'
                    : 'На проверке'}
              </Tag>
              {config.resultText ? <Text strong>{config.resultText}</Text> : null}
              {iteration.manager_responded_at ? <Text type="secondary">{formatDate(iteration.manager_responded_at)}</Text> : null}
            </Space>
            {canRespond && onRespond ? (
              <Button
                size="small"
                type={iteration.approval_status === 'pending' ? 'primary' : 'default'}
                onClick={() => onRespond(iteration)}
              >
                {iteration.approval_status === 'pending' ? 'Принять решение' : 'Изменить решение'}
              </Button>
            ) : null}
          </Space>
        </div>
      </Space>
    </Card>
  );
};

export default IterationCard;
