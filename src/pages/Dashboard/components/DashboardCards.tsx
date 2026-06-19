import React from 'react';
import { Card, Tag, Typography, Progress, Space, Empty, Spin } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { formatNumberWithSpaces } from '../../../utils/numberFormat';
import { getVersionColorByTitle } from '../../../utils/versionColor';
import { computeDeadlineProgress } from '../utils/deadlineProgress';
import type { TenderTableData } from '../types';

const { Text } = Typography;

interface DashboardCardsProps {
  data: TenderTableData[];
  loading: boolean;
  /** Список {title, version} для расчёта цвета версии. */
  versionTitles: { title: string; version: number }[];
  onOpen: (id: string) => void;
}

const Metric: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div style={{ minWidth: 0 }}>
    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{label}</Text>
    <Text strong={strong} style={{ fontSize: 13, wordBreak: 'break-word' }}>{value}</Text>
  </div>
);

/** Карточный (read-only) вид дашборда для телефона в портрете. */
export const DashboardCards: React.FC<DashboardCardsProps> = ({ data, loading, versionTitles, onOpen }) => {
  if (loading) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>;
  }
  if (!data.length) {
    return <Empty description="Нет тендеров" style={{ padding: 40 }} />;
  }

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      {data.map((t) => {
        const dl = computeDeadlineProgress(t.deadline, t.created_at);
        return (
          <Card
            key={t.key}
            size="small"
            hoverable
            onClick={() => onOpen(t.id)}
            styles={{ body: { padding: 12 } }}
            style={{ borderLeft: `4px solid ${dl.color}`, cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <Space size={6} wrap>
                <Text strong>{t.name}</Text>
                <Tag color={getVersionColorByTitle(t.version, t.name, versionTitles)} style={{ fontSize: 11 }}>
                  v{t.version || 1}
                </Tag>
              </Space>
              {t.number && (
                <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{t.number}</Text>
              )}
            </div>
            {t.client && (
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>{t.client}</Text>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginTop: 8 }}>
              <Metric label="Площадь СП" value={`${formatNumberWithSpaces(t.construction_area)} м²`} />
              <Metric label="Итого ПЗ" value={formatNumberWithSpaces(Math.round(t.boq_cost))} strong />
              <Metric label="Стоимость за м²" value={`${formatNumberWithSpaces(Math.round(t.cost_per_sqm))} ₽/м²`} />
              <Metric label="Крайний срок" value={t.deadline ? dayjs(t.deadline).format('DD.MM.YYYY') : '-'} />
            </div>

            <div style={{ marginTop: 8 }}>
              {dl.state === 'none' && <Tag color="default">Дедлайн не указан</Tag>}
              {dl.state === 'completed' && (
                <Progress percent={100} status="success" strokeColor="#10b981" format={() => 'Завершен'} size="small" />
              )}
              {dl.state === 'active' && (
                <>
                  <Text style={{ fontSize: 11, color: dl.color, fontWeight: 500, display: 'block', marginBottom: 2 }}>
                    <ClockCircleOutlined /> Осталось: {dl.remainingText}
                  </Text>
                  <Progress percent={dl.percent} strokeColor={dl.color} showInfo={false} size="small" />
                </>
              )}
            </div>
          </Card>
        );
      })}
    </Space>
  );
};
