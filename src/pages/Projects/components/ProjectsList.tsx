import React from 'react';
import { useNavigate } from 'react-router-dom';
import { List, Typography, Progress, Empty, Spin, Tooltip, Divider } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTheme } from '../../../contexts/ThemeContext';
import type { ProjectFull } from '../../../lib/supabase/types';
import type { AgreementsMap } from '../hooks/useProjectsData';

const { Text } = Typography;

interface ProjectsListProps {
  data: ProjectFull[];
  loading: boolean;
  agreementsMap: AgreementsMap;
}

const formatMoney = (value: number): string => {
  if (value >= 1_000_000_000) {
    const billions = value / 1_000_000_000;
    // Убираем лишние нули после запятой
    const formatted = billions % 1 === 0
      ? billions.toFixed(0)
      : billions.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
    return `${formatted} млрд ₽`;
  }
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    const formatted = millions % 1 === 0
      ? millions.toFixed(0)
      : millions.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
    return `${formatted} млн ₽`;
  }
  return `${value.toLocaleString('ru-RU')} ₽`;
};

// Format money for tooltip (detailed)
const formatMoneyDetailed = (value: number): string => {
  return value.toLocaleString('ru-RU') + ' ₽';
};

export const ProjectsList: React.FC<ProjectsListProps> = ({ data, loading, agreementsMap }) => {
  const navigate = useNavigate();
  const { theme } = useTheme();

  // Render tooltip content for contract amount
  const renderAmountTooltip = (project: ProjectFull) => {
    const agreements = agreementsMap[project.id] || [];
    const agreementsSum = agreements.reduce((sum, a) => sum + a.amount, 0);
    const totalSum = project.contract_cost + agreementsSum;

    return (
      <div style={{ minWidth: 200 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={{ color: 'rgba(255,255,255,0.85)' }}>Договор:</Text>
          <Text strong style={{ color: '#fff' }}>{formatMoneyDetailed(project.contract_cost)}</Text>
        </div>
        {agreements.map((a, idx) => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ color: 'rgba(255,255,255,0.85)' }}>
              {a.agreement_number || `ДС ${idx + 1}`}:
            </Text>
            <Text
              strong
              style={{ color: a.amount >= 0 ? '#52c41a' : '#ff4d4f' }}
            >
              {a.amount >= 0 ? '+' : ''}{formatMoneyDetailed(a.amount)}
            </Text>
          </div>
        ))}
        {agreements.length > 0 && (
          <>
            <Divider style={{ margin: '8px 0', borderColor: 'rgba(255,255,255,0.2)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text strong style={{ color: '#fff' }}>Итого:</Text>
              <Text strong style={{ color: '#fff' }}>{formatMoneyDetailed(totalSum)}</Text>
            </div>
          </>
        )}
      </div>
    );
  };

  const handleItemClick = (projectId: string) => {
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
    <List
      itemLayout="horizontal"
      dataSource={data}
      renderItem={(project) => {
        const completionPercent = Math.min(Math.round(project.completion_percentage), 100);
        const endDate = project.construction_end_date
          ? dayjs(project.construction_end_date)
          : null;
        const isPastDeadline = endDate && endDate.isBefore(dayjs(), 'day');
        const isNearDeadline = endDate && endDate.diff(dayjs(), 'day') <= 30 && !isPastDeadline;

        return (
          <List.Item
            onClick={() => handleItemClick(project.id)}
            style={{
              cursor: 'pointer',
              padding: '16px 20px',
              borderRadius: 8,
              marginBottom: 8,
              background: theme === 'dark' ? '#1f1f1f' : '#fafafa',
              border: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme === 'dark' ? '#262626' : '#f5f5f5';
              e.currentTarget.style.borderColor = theme === 'dark' ? '#434343' : '#d9d9d9';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = theme === 'dark' ? '#1f1f1f' : '#fafafa';
              e.currentTarget.style.borderColor = theme === 'dark' ? '#303030' : '#f0f0f0';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 24 }}>
              {/* Заказчик и название */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>
                  {project.client_name}
                </Text>
                <Text strong style={{ fontSize: 15 }} ellipsis>
                  {project.name}
                </Text>
              </div>

              {/* Стоимость договора */}
              <Tooltip title={renderAmountTooltip(project)} placement="left">
                <div style={{ width: 140, textAlign: 'right', cursor: 'help' }}>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                    Договор
                  </Text>
                  <Text strong style={{ color: '#1890ff' }}>
                    {formatMoney(project.final_contract_cost)}
                  </Text>
                </div>
              </Tooltip>

              {/* Стоимость за м² */}
              <div style={{ width: 130, textAlign: 'right' }}>
                <Text strong>
                  {project.area && project.area > 0
                    ? `${Math.round(project.final_contract_cost / project.area).toLocaleString('ru-RU')} Руб/м²`
                    : '—'}
                </Text>
              </div>

              {/* Выполнение */}
              <div style={{ width: 180 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Выполнение
                  </Text>
                  <Text style={{ fontSize: 12 }}>{completionPercent}%</Text>
                </div>
                <Progress
                  percent={completionPercent}
                  showInfo={false}
                  size="small"
                  strokeColor={completionPercent >= 100 ? '#52c41a' : '#1890ff'}
                />
              </div>

              {/* Дата начала */}
              <div style={{ width: 90, textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                  Начало
                </Text>
                <Text style={{ fontSize: 12 }}>
                  {project.contract_date
                    ? dayjs(project.contract_date).format('DD.MM.YYYY')
                    : '—'}
                </Text>
              </div>

              {/* Дата окончания */}
              <div style={{ width: 90, textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                  Окончание
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: isPastDeadline ? '#ff4d4f' : isNearDeadline ? '#faad14' : undefined,
                  }}
                >
                  {endDate ? endDate.format('DD.MM.YYYY') : '—'}
                </Text>
              </div>

              {/* Стрелка */}
              <RightOutlined style={{ color: '#8c8c8c', fontSize: 12 }} />
            </div>
          </List.Item>
        );
      }}
    />
  );
};
