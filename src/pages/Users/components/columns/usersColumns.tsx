import { Button, Popconfirm, Radio, Space, Tag, Tooltip } from 'antd';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { UserRecord } from '../../types';

interface BuildArgs {
  currentUserId: string | undefined;
  currentTheme: string;
  onEdit: (user: UserRecord) => void;
  onDelete: (user: UserRecord) => void;
  onToggleAccess: (user: UserRecord) => void;
}

export function buildUsersColumns({
  currentUserId,
  currentTheme,
  onEdit,
  onDelete,
  onToggleAccess,
}: BuildArgs): ColumnsType<UserRecord> {
  const tooltipColor = currentTheme === 'dark' ? '#1f1f1f' : '#fff';
  const tooltipInner = { color: currentTheme === 'dark' ? '#fff' : '#000' };

  return [
    {
      title: 'ФИО',
      dataIndex: 'full_name',
      key: 'full_name',
      width: 310,
      align: 'center',
      render: (text: string) => <div style={{ textAlign: 'left' }}>{text}</div>,
    },
    {
      title: 'Роль',
      dataIndex: 'role_name',
      key: 'role_name',
      width: 140,
      align: 'center',
      render: (_: string, record: UserRecord) => <Tag color={record.role_color || 'default'}>{record.role_name}</Tag>,
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      width: 200,
      align: 'center',
    },
    {
      title: 'Дата регистрации',
      dataIndex: 'registration_date',
      key: 'registration_date',
      width: 130,
      align: 'center',
      render: (date: string) => dayjs(date).format('DD.MM.YYYY'),
    },
    {
      title: 'Доступ',
      dataIndex: 'access_enabled',
      key: 'access_enabled',
      width: 120,
      align: 'center',
      render: (access_enabled: boolean, record: UserRecord) => (
        <Radio.Group
          value={access_enabled ? 'open' : 'closed'}
          onChange={(e) => {
            if ((e.target.value === 'open') !== access_enabled) {
              onToggleAccess(record);
            }
          }}
          size="small"
        >
          <Radio.Button value="open">Открыт</Radio.Button>
          <Radio.Button value="closed">Закрыт</Radio.Button>
        </Radio.Group>
      ),
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 160,
      align: 'center',
      fixed: 'right',
      render: (_: unknown, record: UserRecord) => (
        <Space size="small">
          <Tooltip title="Редактировать" color={tooltipColor} overlayInnerStyle={tooltipInner}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => onEdit(record)}
              disabled={record.id === currentUserId}
              style={{ padding: '0 4px' }}
            />
          </Tooltip>
          <Popconfirm
            title="Удалить пользователя?"
            description={`Пользователь ${record.full_name} будет безвозвратно удален из системы.`}
            onConfirm={() => onDelete(record)}
            okText="Удалить"
            cancelText="Отмена"
            okType="danger"
            disabled={record.id === currentUserId}
          >
            <Tooltip
              title={record.id === currentUserId ? 'Нельзя удалить себя' : 'Удалить пользователя'}
              color={tooltipColor}
              overlayInnerStyle={tooltipInner}
            >
              <Button
                danger
                type="link"
                size="small"
                icon={<DeleteOutlined />}
                disabled={record.id === currentUserId}
                style={{ padding: '0 4px' }}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];
}
