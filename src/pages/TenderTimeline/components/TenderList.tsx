import React from 'react';
import { List, Progress, Skeleton, Tag, Typography } from 'antd';
import type { TimelineTenderListItem } from '../hooks/useTenders';
import { getStatusLabel, getStatusTagColor } from '../utils/timeline.utils';

const { Text } = Typography;

interface TenderListProps {
  tenders: TimelineTenderListItem[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
}

function getProgressStatus(score: number): 'success' | 'normal' | 'exception' {
  if (score >= 80) {
    return 'success';
  }

  if (score >= 60) {
    return 'normal';
  }

  return 'exception';
}

const TenderList: React.FC<TenderListProps> = ({
  tenders,
  selectedId,
  loading,
  onSelect,
}) => {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {loading ? (
        <div style={{ padding: 12 }}>
          {[0, 1, 2].map((item) => (
            <div key={item} style={{ padding: '12px 8px' }}>
              <Skeleton active paragraph={{ rows: 3 }} title={false} />
            </div>
          ))}
        </div>
      ) : (
        <List
          dataSource={tenders}
          style={{ height: '100%', overflowY: 'auto', paddingRight: 4 }}
          renderItem={(tender) => {
            const isSelected = selectedId === tender.id;

            return (
              <List.Item
                onClick={() => onSelect(tender.id)}
                style={{
                  cursor: 'pointer',
                  padding: 12,
                  marginBottom: 8,
                  borderRadius: 10,
                  borderLeft: isSelected ? '2px solid #1677ff' : '2px solid transparent',
                  background: isSelected ? '#e6f4ff' : 'transparent',
                  alignItems: 'stretch',
                }}
              >
                <div style={{ width: '100%' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {tender.tender_number}
                  </Text>
                  <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4, marginBottom: 10 }}>
                    {tender.title}
                  </div>

                  <Progress
                    percent={tender.overallScore}
                    size="small"
                    status={getProgressStatus(tender.overallScore)}
                    showInfo={false}
                  />

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: 10,
                      gap: 8,
                    }}
                  >
                    <Tag color={getStatusTagColor(tender.status)}>
                      {getStatusLabel(tender.status)}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {tender.groupsCount} групп
                    </Text>
                  </div>
                </div>
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );
};

export default TenderList;
