import React from 'react';
import { Button, Card, Progress, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { TimelineTenderListItem } from '../hooks/useTenders';
import { formatDate, getScoreColor } from '../utils/timeline.utils';
import { getQualityLabel } from '../utils/timelineSignatures';

const { Text } = Typography;

interface TimelineTenderTableProps {
  tenders: TimelineTenderListItem[];
  loading: boolean;
  expandedTenderIds: React.Key[];
  canEditQuality: boolean;
  colorFillSecondary: string;
  colorBgContainer: string;
  colorBorderSecondary: string;
  colorFillAlter: string;
  onOpenQuality: (tenderId: string) => void;
  onExpand: (tenderId: string) => void;
  onCollapse: (tenderId: string) => void;
  renderExpanded: (tender: TimelineTenderListItem) => React.ReactNode;
}

export const TimelineTenderTable: React.FC<TimelineTenderTableProps> = ({
  tenders,
  loading,
  expandedTenderIds,
  canEditQuality,
  colorFillSecondary,
  colorBgContainer,
  colorBorderSecondary,
  colorFillAlter,
  onOpenQuality,
  onExpand,
  onCollapse,
  renderExpanded,
}) => {
  const columns: ColumnsType<TimelineTenderListItem> = [
    {
      title: '№',
      width: 56,
      render: (_, __, index) => index + 1,
    },
    {
      title: 'Тендер',
      dataIndex: 'title',
      render: (_, tender) => (
        <Space direction="vertical" size={2}>
          <Text strong>{tender.title}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {tender.tender_number}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Уровень расчета',
      width: 260,
      render: (_, tender) => (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
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
        </div>
      ),
    },
    {
      title: 'Команд',
      dataIndex: 'groupsCount',
      width: 100,
      align: 'center',
    },
    {
      title: 'Последняя активность',
      width: 210,
      render: (_, tender) => (
        <Text type="secondary">
          {tender.lastActivityAt ? formatDate(tender.lastActivityAt) : 'Пока нет'}
        </Text>
      ),
    },
    {
      title: 'Действия',
      width: 160,
      render: (_, tender) => (
        <Button
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            onOpenQuality(tender.id);
          }}
        >
          {canEditQuality ? 'Оценить уровень' : 'Просмотр уровня'}
        </Button>
      ),
    },
  ];

  return (
    <Card
      size="small"
      title="Реестр тендеров"
      style={{ flex: 1, minHeight: 0, background: colorBgContainer, borderColor: colorBorderSecondary }}
      styles={{ body: { height: 'calc(100% - 57px)', padding: 0, minHeight: 0, overflow: 'auto' } }}
    >
      <Table
        rowKey="id"
        size="middle"
        pagination={false}
        loading={loading}
        columns={columns}
        dataSource={tenders}
        expandable={{
          expandedRowKeys: expandedTenderIds,
          expandRowByClick: true,
          expandedRowRender: renderExpanded,
          onExpand: (expanded, record) => {
            if (expanded) {
              onExpand(record.id);
            } else {
              onCollapse(record.id);
            }
          },
        }}
        onRow={(record) => ({
          style: expandedTenderIds.includes(record.id) ? { background: colorFillAlter } : undefined,
        })}
        scroll={{ x: 860 }}
      />
    </Card>
  );
};
