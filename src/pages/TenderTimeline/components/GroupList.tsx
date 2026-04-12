import React from 'react';
import { Avatar, Empty, List, Skeleton, Tag, Typography } from 'antd';
import type { TimelineGroupItem } from '../hooks/useTenderGroups';
import { getInitials, getRoleAvatarColor, getScoreColor } from '../utils/timeline.utils';

const { Text } = Typography;

interface GroupListProps {
  groups: TimelineGroupItem[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
}

const GroupList: React.FC<GroupListProps> = ({
  groups,
  selectedId,
  loading,
  onSelect,
}) => {
  if (loading) {
    return (
      <div style={{ padding: 12 }}>
        {[0, 1, 2].map((item) => (
          <div key={item} style={{ padding: '12px 8px' }}>
            <Skeleton active avatar paragraph={{ rows: 2 }} title={false} />
          </div>
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty description="Выберите тендер" />
      </div>
    );
  }

  return (
    <List
      dataSource={groups}
      style={{ height: '100%', overflowY: 'auto', paddingRight: 4 }}
      renderItem={(group) => {
        const isSelected = selectedId === group.id;

        return (
          <List.Item
            onClick={() => onSelect(group.id)}
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: group.color,
                      flexShrink: 0,
                    }}
                  />
                  <Text strong ellipsis>
                    {group.name}
                  </Text>
                </div>
                <Tag color={getScoreColor(group.qualityScore)}>
                  {group.qualityScore || 0}
                </Tag>
              </div>

              <div style={{ marginTop: 10 }}>
                <Avatar.Group maxCount={4} size="small">
                  {group.members.map((member) => (
                    <Avatar
                      key={member.id}
                      style={{
                        backgroundColor: getRoleAvatarColor(member.user?.role_code || ''),
                      }}
                    >
                      {getInitials(member.user?.full_name || '')}
                    </Avatar>
                  ))}
                </Avatar.Group>
              </div>

              <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 10 }}>
                {group.members.length} участн. · {group.iterationsCount} итераций
              </Text>
            </div>
          </List.Item>
        );
      }}
    />
  );
};

export default GroupList;
