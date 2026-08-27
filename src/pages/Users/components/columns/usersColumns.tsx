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
  const byText = (pick: (u: UserRecord) => string | undefined | null) => (a: UserRecord, b: UserRecord) =>
    (pick(a) ?? '').localeCompare(pick(b) ?? '', 'ru', { sensitivity: 'base' });

  return [
    {
      title: 'ФИО',
      dataIndex: 'full_name',
      key: 'full_name',
      width: 310,
      align: 'center',
      sorter: byText(u => u.full_name),
      render: (text: string) => <div style={{ textAlign: 'left' }}>{text}</div>,
    },
    {
      title: 'Роль',
      dataIndex: 'role_name',
      key: 'role_name',
      width: 140,
      align: 'center',
      sorter: byText(u => u.role_name || u.role_code),
      render: (_: string, record: UserRecord) => <Tag color={record.role_color || 'default'}>{record.role_name}</Tag>,
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      width: 200,
      align: 'center',
      sorter: byText(u => u.email),
    },
    {
      title: 'Дата регистрации',
      dataIndex: 'registration_date',
      key: 'registration_date',
      width: 130,
      align: 'center',
      sorter: (a, b) => dayjs(a.registration_date).valueOf() - dayjs(b.registration_date).valueOf(),
      render: (date: string) => dayjs(date).format('DD.MM.YYYY'),
    },
    {
      title: 'Доступ',
      dataIndex: 'access_enabled',
      key: 'access_enabled',
      width: 120,
      align: 'center',
      sorter: (a, b) => Number(a.access_enabled) - Number(b.access_enabled),
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
