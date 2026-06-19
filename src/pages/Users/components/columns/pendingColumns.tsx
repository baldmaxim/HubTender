import { Button, Popconfirm, Select, Space, Tag } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { PendingRequest, RoleRecord } from '../../types';

interface BuildArgs {
  roles: RoleRecord[];
  selectedRoles: Record<string, string>;
  onRoleChange: (requestId: string, roleCode: string) => void;
  onApprove: (request: PendingRequest) => void;
  onReject: (request: PendingRequest) => void;
}

export function buildPendingColumns({
  roles,
  selectedRoles,
  onRoleChange,
  onApprove,
  onReject,
}: BuildArgs): ColumnsType<PendingRequest> {
  return [
    {
      title: 'ФИО',
      dataIndex: 'full_name',
      key: 'full_name',
      width: 200,
      align: 'center',
      render: (text: string) => <div style={{ textAlign: 'left' }}>{text}</div>,
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      width: 220,
      align: 'center',
    },
    {
      title: 'Роль',
      dataIndex: 'role_code',
      key: 'role_code',
      width: 200,
      align: 'center',
      render: (_: string, record: PendingRequest) => (
        <Select
          style={{ width: '100%' }}
          value={selectedRoles[record.id] || record.role_code}
          onChange={(value) => onRoleChange(record.id, value)}
        >
          {roles.map((role) => (
            <Select.Option key={role.code} value={role.code}>
              <Tag color={role.color || 'default'}>{role.name}</Tag>
            </Select.Option>
          ))}
        </Select>
      ),
    },
    {
      title: 'Дата регистрации',
      dataIndex: 'registration_date',
      key: 'registration_date',
      width: 150,
      align: 'center',
      render: (date: string) => dayjs(date).format('DD.MM.YYYY HH:mm'),
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 180,
      align: 'center',
      render: (_: unknown, record: PendingRequest) => (
        <Space size="small">
          <Popconfirm
            title="Одобрить пользователя?"
            description={`Пользователь ${record.full_name} получит доступ к системе`}
            onConfirm={() => onApprove(record)}
            okText="Одобрить"
            cancelText="Отмена"
          >
            <Button type="primary" size="small" icon={<CheckOutlined />}>Одобрить</Button>
          </Popconfirm>
          <Popconfirm
            title="Отклонить запрос?"
            description="Пользователь будет удален из системы"
            onConfirm={() => onReject(record)}
            okText="Отклонить"
            cancelText="Отмена"
            okType="danger"
          >
            <Button danger size="small" icon={<CloseOutlined />}>Отклонить</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];
}
