import React from 'react';
import { Button, Card, Empty, Progress, Space, Spin, Typography } from 'antd';
import type { TimelineTenderListItem } from '../hooks/useTenders';
import { formatDate, getScoreColor } from '../utils/timeline.utils';
import { getQualityLabel } from '../utils/timelineSignatures';

const { Text } = Typography;

interface TimelineTenderCardsProps {
  tenders: TimelineTenderListItem[];
  loading: boolean;
  expandedTenderId: string | null;
  canEditQuality: boolean;
  colorFillSecondary: string;
  colorBorderSecondary: string;
  colorBgContainer: string;
  onToggle: (tenderId: string) => void;
  onOpenQuality: (tenderId: string) => void;
  renderExpanded: (tender: TimelineTenderListItem) => React.ReactNode;
}

/** Карточный список реестра тендеров для телефона: тап раскрывает команды инлайн. */
export const TimelineTenderCards: React.FC<TimelineTenderCardsProps> = ({
  tenders,
  loading,
  expandedTenderId,
  canEditQuality,
  colorFillSecondary,
  colorBorderSecondary,
  colorBgContainer,
  onToggle,
  onOpenQuality,
  renderExpanded,
}) => {
  if (loading) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>;
  }
  if (tenders.length === 0) {
    return <Empty description="Нет тендеров" style={{ padding: 40 }} />;
  }

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {tenders.map((tender) => {
        const isExpanded = expandedTenderId === tender.id;
        return (
          <Card
            key={tender.id}
            size="small"
            styles={{ body: { padding: 12 } }}
            style={{ background: colorBgContainer, borderColor: isExpanded ? undefined : colorBorderSecondary }}
          >
            <div onClick={() => onToggle(tender.id)} style={{ cursor: 'pointer' }}>
              <Text strong style={{ display: 'block', wordBreak: 'break-word' }}>{tender.title}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{tender.tender_number}</Text>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, marginBottom: 4, gap: 8 }}>
                <Text strong>{getQualityLabel(tender.qualityLevel)}</Text>
                <Text type="secondary">{tender.overallScore}%</Text>
              </div>
              <Progress
                percent={tender.overallScore}
                showInfo={false}
                size="small"
                strokeColor={getScoreColor(tender.overallScore)}
                trailColor={colorFillSecondary}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12 }}>
                <Text type="secondary">Команд: {tender.groupsCount}</Text>
                <Text type="secondary">
                  {tender.lastActivityAt ? formatDate(tender.lastActivityAt) : 'Пока нет'}
                </Text>
              </div>
            </div>

            <Button
              size="small"
              block
              style={{ marginTop: 10 }}
              onClick={(event) => {
                event.stopPropagation();
                onOpenQuality(tender.id);
              }}
            >
              {canEditQuality ? 'Оценить уровень' : 'Просмотр уровня'}
            </Button>

            {isExpanded && (
              <div style={{ marginTop: 12 }}>
                {renderExpanded(tender)}
              </div>
            )}
          </Card>
        );
      })}
    </Space>
  );
};
