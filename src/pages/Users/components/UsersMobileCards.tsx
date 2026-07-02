import React from 'react';
import { Card, Tag, Typography, Empty, Space } from 'antd';
import dayjs from 'dayjs';
import { PAGE_LABELS } from '../../../lib/types/types';
import type { PendingRequest, UserRecord, RoleRecord } from '../types';

const { Text } = Typography;

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div style={{ fontSize: 12 }}>
    <Text type="secondary">{label}: </Text>
    {value}
  </div>
);

/** Read-only списки на телефоне (просмотр ростера; CRUD — на десктопе/планшете). */

export const PendingCards: React.FC<{ data: PendingRequest[] }> = ({ data }) => {
  if (data.length === 0) return <Empty description="Нет новых запросов на регистрацию" style={{ padding: 40 }} />;
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {data.map((r) => (
        <Card key={r.id} size="small" styles={{ body: { padding: 12 } }}>
          <Text strong style={{ display: 'block', wordBreak: 'break-word' }}>{r.full_name}</Text>
          <Field label="Email" value={<Text>{r.email}</Text>} />
          <Field label="Роль" value={<Tag color={r.role_color || 'default'}>{r.role_name || r.role_code}</Tag>} />
          <Field label="Дата" value={<Text>{dayjs(r.registration_date).format('DD.MM.YYYY HH:mm')}</Text>} />
        </Card>
      ))}
    </Space>
  );
};

export const UsersCards: React.FC<{ data: UserRecord[] }> = ({ data }) => {
  if (data.length === 0) return <Empty description="Нет пользователей" style={{ padding: 40 }} />;
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {data.map((u) => (
        <Card key={u.id} size="small" styles={{ body: { padding: 12 } }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
            <Text strong style={{ wordBreak: 'break-word' }}>{u.full_name}</Text>
            <Tag color={u.access_enabled ? 'green' : 'red'} style={{ margin: 0 }}>
              {u.access_enabled ? 'Открыт' : 'Закрыт'}
            </Tag>
          </div>
          <Field label="Роль" value={<Tag color={u.role_color || 'default'}>{u.role_name}</Tag>} />
          <Field label="Email" value={<Text>{u.email}</Text>} />
          <Field label="Дата" value={<Text>{dayjs(u.registration_date).format('DD.MM.YYYY')}</Text>} />
        </Card>
      ))}
    </Space>
  );
};

export const RolesCards: React.FC<{ data: RoleRecord[] }> = ({ data }) => {
  if (data.length === 0) return <Empty description="Нет ролей" style={{ padding: 40 }} />;
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {data.map((role) => {
        const pages = role.allowed_pages;
        const pagesNode = !pages || pages.length === 0
          ? <Tag color="green">Полный доступ</Tag>
          : <Text type="secondary" style={{ fontSize: 12 }}>{pages.map(p => PAGE_LABELS[p] || p).join(', ')}</Text>;
        return (
          <Card key={role.code} size="small" styles={{ body: { padding: 12 } }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
              <Tag color={role.color || 'default'} style={{ margin: 0 }}>{role.name}</Tag>
              <Text code style={{ fontSize: 11 }}>{role.code}</Text>
            </div>
            <Field label="Страницы" value={pagesNode} />
          </Card>
        );
      })}
    </Space>
  );
};
