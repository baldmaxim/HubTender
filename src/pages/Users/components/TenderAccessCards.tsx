import React from 'react';
import { Card, Tag, Typography, Empty, Space, Button } from 'antd';
import { CalendarOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { TenderRecord, UserExtensionDisplay } from './TenderAccessTab';

const { Text } = Typography;

/** Тег статуса дедлайна: «Истек» / «{N}д» (оранжевый <7 дней, иначе зелёный). */
export const DeadlineTag: React.FC<{ deadline: string }> = ({ deadline }) => {
  const date = dayjs(deadline);
  const daysUntil = date.diff(dayjs(), 'day');
  if (date.isBefore(dayjs())) return <Tag color="red">Истек</Tag>;
  return <Tag color={daysUntil < 7 ? 'orange' : 'green'}>{daysUntil}д</Tag>;
};

interface TenderAccessCardsProps {
  tenders: TenderRecord[];
  getUsersForTender: (id: string) => UserExtensionDisplay[];
  onExtend: (t: TenderRecord) => void;
  onDelete: (t: TenderRecord) => void;
}

/** Карточный список «Доступ к тендерам» для телефона (портрет + ландшафт), с действиями. */
export const TenderAccessCards: React.FC<TenderAccessCardsProps> = ({
  tenders,
  getUsersForTender,
  onExtend,
  onDelete,
}) => {
  if (tenders.length === 0) return <Empty description="Нет тендеров" style={{ padding: 40 }} />;
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {tenders.map((t) => {
        const usersWithAccess = getUsersForTender(t.id);
        const hasUsers = usersWithAccess.length > 0;
        return (
          <Card key={t.id} size="small" styles={{ body: { padding: 12 } }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 4 }}>
              <Space size={4}>
                <Text strong>№{t.tender_number}</Text>
                <Tag color="blue" style={{ margin: 0 }}>v{t.version}</Tag>
              </Space>
              <DeadlineTag deadline={t.submission_deadline} />
            </div>
            <Text style={{ display: 'block', wordBreak: 'break-word', marginBottom: 4 }}>{t.title}</Text>
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              <Text type="secondary">Срок: </Text>
              <Text>{dayjs(t.submission_deadline).format('DD.MM.YYYY HH:mm')}</Text>
            </div>
            <div style={{ borderTop: '1px solid rgba(128,128,128,0.2)', paddingTop: 8, marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>Доступ продлён:</Text>
              {hasUsers ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                  {usersWithAccess.map((u) => (
                    <div
                      key={u.user_id}
                      style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Text style={{ fontSize: 12, wordBreak: 'break-word' }}>{u.user_name}</Text>
                      <Space size={4}>
                        <Text style={{ fontSize: 12 }}>{dayjs(u.extended_deadline).format('DD.MM.YYYY HH:mm')}</Text>
                        <DeadlineTag deadline={u.extended_deadline} />
                      </Space>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Нет продлённого доступа</Text>
                </div>
              )}
            </div>
            <Space>
              <Button size="small" icon={<CalendarOutlined />} onClick={() => onExtend(t)}>
                Продлить
              </Button>
              {hasUsers && (
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(t)}>
                  Удалить
                </Button>
              )}
            </Space>
          </Card>
        );
      })}
    </Space>
  );
};
