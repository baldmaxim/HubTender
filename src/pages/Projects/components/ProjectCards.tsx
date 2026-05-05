import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Typography, Progress, Tag, Space, Empty, Spin } from 'antd';
import {
  CalendarOutlined,
  UserOutlined,
  EnvironmentOutlined,
  RightOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTheme } from '../../../contexts/ThemeContext';
import type { ProjectFull } from '../../../lib/supabase/types';

const { Text, Title } = Typography;

interface ProjectCardsProps {
  data: ProjectFull[];
  loading: boolean;
}

const formatMoney = (value: number): string => {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млрд ₽`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млн ₽`;
  }
  return `${value.toLocaleString('ru-RU')} ₽`;
};

const COLORS = [
  '#1890ff', '#52c41a', '#faad14', '#722ed1',
  '#eb2f96', '#13c2c2', '#fa541c', '#2f54eb',
];

export const ProjectCards: React.FC<ProjectCardsProps> = ({ data, loading }) => {
  const navigate = useNavigate();
  const { theme } = useTheme();

  const handleCardClick = (projectId: string) => {
    navigate(`/projects/${projectId}`);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (data.length === 0) {
    return <Empty description="Нет объектов" />;
  }

  return (
    <Row gutter={[16, 16]}>
      {data.map((project, index) => {
        const color = COLORS[index % COLORS.length];
        const completionPercent = Math.min(Math.round(project.completion_percentage ?? 0), 100);
        const endDate = project.construction_end_date
          ? dayjs(project.construction_end_date)
          : null;
        const isPastDeadline = endDate && endDate.isBefore(dayjs(), 'day');
        const isNearDeadline = endDate && endDate.diff(dayjs(), 'day') <= 30 && !isPastDeadline;

        return (
          <Col xs={24} sm={12} lg={8} xl={6} key={project.id}>
            <Card
              hoverable
              onClick={() => handleCardClick(project.id)}
              style={{
                borderRadius: 12,
                borderTop: `4px solid ${color}`,
                background: theme === 'dark' ? '#1f1f1f' : '#fff',
                height: '100%',
              }}
              bodyStyle={{ padding: 16 }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {/* Header */}
                <div style={{ marginBottom: 12 }}>
                  <Title
                    level={5}
                    ellipsis={{ rows: 2 }}
                    style={{ margin: 0, color, minHeight: 44 }}
                  >
                    {project.name}
                  </Title>
                  {project.tender_number && (
                    <Tag color="green" style={{ marginTop: 8, fontSize: 10 }}>
                      Тендер: {project.tender_number}
                    </Tag>
                  )}
                </div>

                {/* Info */}
                <Space direction="vertical" size={4} style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <UserOutlined style={{ color: '#8c8c8c', fontSize: 12 }} />
                    <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                      {project.client_name}
                    </Text>
                  </div>

                  {project.area && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <EnvironmentOutlined style={{ color: '#8c8c8c', fontSize: 12 }} />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {project.area.toLocaleString('ru-RU')} м²
                      </Text>
                    </div>
                  )}

                  {endDate && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <CalendarOutlined style={{ color: '#8c8c8c', fontSize: 12 }} />
                      <Tag
                        color={isPastDeadline ? 'red' : isNearDeadline ? 'orange' : 'default'}
                        style={{ fontSize: 10, margin: 0 }}
                      >
                        до {endDate.format('DD.MM.YYYY')}
                      </Tag>
                    </div>
                  )}
                </Space>

                {/* Contract value */}
                <div style={{ marginTop: 12, marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Стоимость договора
                  </Text>
                  <div>
                    <Text strong style={{ fontSize: 16, color }}>
                      {formatMoney(project.final_contract_cost ?? 0)}
                    </Text>
                  </div>
                </div>

                {/* Progress */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                    }}
                  >
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      Выполнение
                    </Text>
                    <Text strong style={{ fontSize: 11 }}>
                      {completionPercent}%
                    </Text>
                  </div>
                  <Progress
                    percent={completionPercent}
                    showInfo={false}
                    strokeColor={completionPercent >= 100 ? '#52c41a' : color}
                    trailColor={theme === 'dark' ? '#303030' : '#f0f0f0'}
                    size="small"
                  />
                  <Text type="secondary" style={{ fontSize: 10 }}>
                    {formatMoney(project.total_completion ?? 0)} из{' '}
                    {formatMoney(project.final_contract_cost ?? 0)}
                  </Text>
                </div>

                {/* Click hint */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Открыть <RightOutlined style={{ fontSize: 10 }} />
                  </Text>
                </div>
              </div>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
};
