import React from 'react';
import { Dropdown, Badge, List, Typography, Space, Empty, Button } from 'antd';
import {
  BellOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  WarningOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { type Notification } from '../../lib/types';

const { Text } = Typography;

interface NotificationsBellProps {
  notifications: Notification[];
  unreadCount: number;
  currentTheme: string;
  onClear: () => void | Promise<void>;
}

// Иконка по типу уведомления
const getNotificationIcon = (type: Notification['type']) => {
  switch (type) {
    case 'success':
      return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
    case 'info':
      return <InfoCircleOutlined style={{ color: '#1890ff' }} />;
    case 'warning':
      return <WarningOutlined style={{ color: '#faad14' }} />;
    case 'pending':
      return <ClockCircleOutlined style={{ color: '#8c8c8c' }} />;
    default:
      return <InfoCircleOutlined style={{ color: '#1890ff' }} />;
  }
};

export const NotificationsBell: React.FC<NotificationsBellProps> = ({
  notifications,
  unreadCount,
  currentTheme,
  onClear,
}) => {
  const isDark = currentTheme === 'dark';

  return (
    <Dropdown
      popupRender={() => (
        <div
          style={{
            backgroundColor: isDark ? '#1f1f1f' : '#fff',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            width: 'min(400px, calc(100vw - 24px))',
            maxHeight: '500px',
            overflow: 'auto',
          }}
        >
          <div
            style={{
              padding: '16px',
              borderBottom: isDark ? '1px solid #303030' : '1px solid #f0f0f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text strong style={{ fontSize: '16px' }}>
              Уведомления
            </Text>
            {notifications.length > 0 && (
              <Button size="small" type="text" icon={<DeleteOutlined />} onClick={onClear} danger>
                Очистить
              </Button>
            )}
          </div>
          {notifications.length > 0 ? (
            <List
              dataSource={notifications}
              renderItem={(item) => (
                <List.Item
                  style={{
                    padding: '12px 16px',
                    borderBottom: isDark ? '1px solid #303030' : '1px solid #f0f0f0',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = isDark ? '#262626' : '#f5f5f5';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <List.Item.Meta
                    avatar={getNotificationIcon(item.type)}
                    title={
                      <Space direction="vertical" size={0} style={{ width: '100%' }}>
                        <Text strong>{item.title}</Text>
                        <Text type="secondary" style={{ fontSize: '12px' }}>
                          {dayjs(item.created_at).fromNow()}
                        </Text>
                      </Space>
                    }
                    description={
                      <Text style={{ fontSize: '13px', color: isDark ? '#d9d9d9' : '#595959' }}>
                        {item.message}
                      </Text>
                    }
                  />
                </List.Item>
              )}
            />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Нет уведомлений"
              style={{ padding: '40px 0' }}
            />
          )}
        </div>
      )}
      trigger={['click']}
      placement="bottomRight"
    >
      <Badge count={unreadCount}>
        <BellOutlined style={{ fontSize: '18px', cursor: 'pointer' }} />
      </Badge>
    </Dropdown>
  );
};

export default NotificationsBell;
