import React from 'react';
import { Avatar, Card, Empty, Progress, Space, Tooltip, Typography } from 'antd';
import type { TimelineGroupItem } from '../hooks/useTenderGroups';
import { getInitials, getRoleAvatarColor, getScoreColor } from '../utils/timeline.utils';
import { getQualityTooltipContent } from '../utils/timelineSignatures';

const { Text } = Typography;

interface TenderTeamsViewProps {
  displayedGroups: TimelineGroupItem[];
  selectedGroupId: string | null;
  assignableUsersError: string | null;
  onSelectGroup: (groupId: string) => void;
  colorPrimary: string;
  colorBorderSecondary: string;
  colorPrimaryBg: string;
  colorBgContainer: string;
  colorFillSecondary: string;
}

/** Сетка карточек команд тендера (используется и в десктоп-таблице, и в мобильных карточках). */
export const TenderTeamsView: React.FC<TenderTeamsViewProps> = ({
  displayedGroups,
  selectedGroupId,
  assignableUsersError,
  onSelectGroup,
  colorPrimary,
  colorBorderSecondary,
  colorPrimaryBg,
  colorBgContainer,
  colorFillSecondary,
}) => {
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div>
        <Text strong>Команды тендера</Text>
        <Text type="secondary" style={{ display: 'block' }}>
          Команды и состав участников фиксированы для каждого тендера и не зависят от данных на других страницах.
        </Text>
        {assignableUsersError ? (
          <Text type="secondary" style={{ display: 'block' }}>
            Не удалось загрузить часть пользователей из фиксированного состава: {assignableUsersError}
          </Text>
        ) : null}
      </div>

      {displayedGroups.length === 0 ? (
        <Empty description="Для тендера пока не удалось собрать фиксированный состав команд" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {displayedGroups.map((group) => {
            const isSelected = selectedGroupId === group.id;

            return (
              <Card
                key={group.id}
                size="small"
                hoverable
                onClick={() => onSelectGroup(group.id)}
                style={{
                  borderColor: isSelected ? colorPrimary : colorBorderSecondary,
                  background: isSelected ? colorPrimaryBg : colorBgContainer,
                }}
              >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: group.color,
                          flexShrink: 0,
                          marginTop: 5,
                        }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <Text strong style={{ display: 'block' }}>
                          {group.name}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {group.members.length} участн. · {group.iterationsCount} данных
                        </Text>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text type="secondary">Уровень расчета</Text>
                      <Tooltip title={getQualityTooltipContent(group.qualityLevel, group.quality_comment)}>
                        <Text strong style={{ cursor: 'help' }}>
                          {group.qualityLevel != null ? `${group.qualityLevel}/3` : 'Нет оценки'}
                        </Text>
                      </Tooltip>
                    </div>
                    <Progress
                      percent={group.qualityScore}
                      showInfo={false}
                      size="small"
                      strokeColor={getScoreColor(group.qualityScore)}
                      trailColor={colorFillSecondary}
                    />
                    {group.quality_comment ? (
                      <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                        {group.quality_comment}
                      </Text>
                    ) : null}
                  </div>

                  <div>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                      Участники команды
                    </Text>
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      {group.members.map((member) => (
                        <div
                          key={member.id}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}
                        >
                          <Avatar
                            size="small"
                            style={{ backgroundColor: getRoleAvatarColor(member.user?.role_code || '') }}
                          >
                            {getInitials(member.user?.full_name || '')}
                          </Avatar>
                          <Text ellipsis style={{ minWidth: 0 }}>
                            {member.user?.full_name || 'Пользователь'}
                          </Text>
                        </div>
                      ))}
                    </Space>
                  </div>
                </Space>
              </Card>
            );
          })}
        </div>
      )}
    </Space>
  );
};
