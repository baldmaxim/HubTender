import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Typography, Progress, Tag, Empty, Spin } from 'antd';
import { useTheme } from '../../../contexts/ThemeContext';
import type { ProjectFull } from '../../../lib/supabase/types';

const { Text } = Typography;

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
    <Row gutter={[12, 12]}>
      {data.map((project, index) => {
        const color = COLORS[index % COLORS.length];
        const completionPercent = Math.min(Math.round(project.completion_percentage ?? 0), 100);
        const ratePerM2 =
          project.area && project.area > 0
            ? Math.round((project.final_contract_cost ?? 0) / project.area)
            : null;

        return (
          <Col xs={24} sm={12} lg={8} xl={6} key={project.id}>
            {/* Компактная карточка: открывается тапом (без кнопки «Открыть») */}
            <Card
              hoverable
              onClick={() => handleCardClick(project.id)}
              style={{
                borderRadius: 12,
                borderTop: `4px solid ${color}`,
                background: theme === 'dark' ? '#1f1f1f' : '#fff',
                height: '100%',
              }}
              bodyStyle={{ padding: 12 }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Наименование + заказчик и площадь в строке наименования */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Text strong ellipsis style={{ color, fontSize: 14, flex: 1, minWidth: 0 }}>
                      {project.name}
                    </Text>
                    {project.tender_number && (
                      <Tag color="green" style={{ margin: 0, fontSize: 10 }}>{project.tender_number}</Tag>
                    )}
                  </div>
                  <Text type="secondary" ellipsis style={{ fontSize: 12, display: 'block' }}>
                    {project.client_name}
                    {project.area ? ` · ${project.area.toLocaleString('ru-RU')} м²` : ''}
                    {ratePerM2 != null ? ` · ${ratePerM2.toLocaleString('ru-RU')} ₽/м²` : ''}
                  </Text>
                </div>

                {/* Стоимость договора */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Договор</Text>
                  <Text strong style={{ fontSize: 14, color }}>{formatMoney(project.final_contract_cost ?? 0)}</Text>
                </div>

                {/* Прогресс выполнения */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Выполнение</Text>
                    <Text strong style={{ fontSize: 11 }}>{completionPercent}%</Text>
                  </div>
                  <Progress
                    percent={completionPercent}
                    showInfo={false}
                    strokeColor={completionPercent >= 100 ? '#52c41a' : color}
                    trailColor={theme === 'dark' ? '#303030' : '#f0f0f0'}
                    size="small"
                  />
                  <Text type="secondary" style={{ fontSize: 10 }}>
                    {formatMoney(project.total_completion ?? 0)} из {formatMoney(project.final_contract_cost ?? 0)}
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
