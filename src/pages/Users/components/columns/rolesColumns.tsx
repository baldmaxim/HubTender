import { Popconfirm, Space, Tag, Tooltip, Typography } from 'antd';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { PAGE_LABELS } from '../../../../lib/supabase/types';
import type { RoleRecord } from '../../types';

const { Text } = Typography;

interface BuildArgs {
  currentTheme: string;
  onEditRole: (role: RoleRecord) => void;
  onDeleteRole: (role: RoleRecord) => void;
}

export function buildRolesColumns({
  currentTheme,
  onEditRole,
  onDeleteRole,
}: BuildArgs): ColumnsType<RoleRecord> {
  const tooltipColor = currentTheme === 'dark' ? '#1f1f1f' : '#fff';
  const tooltipInner = { color: currentTheme === 'dark' ? '#fff' : '#000' };

  return [
    {
      title: 'Код роли',
      dataIndex: 'code',
      key: 'code',
      width: 120,
      align: 'center',
      render: (text: string) => <Text code>{text}</Text>,
    },
    {
      title: 'Название роли',
      dataIndex: 'name',
      key: 'name',
      width: 150,
      align: 'center',
      render: (text: string, record: RoleRecord) => <Tag color={record.color || 'default'}>{text}</Tag>,
    },
    {
      title: 'Доступные страницы',
      dataIndex: 'allowed_pages',
      key: 'allowed_pages',
      width: 500,
      align: 'center',
      render: (pages: string[]) => {
        if (!pages || pages.length === 0) {
          return <Tag color="green">Полный доступ</Tag>;
        }
        const pageNames = pages.map(page => PAGE_LABELS[page] || page).join(', ');
        return (
          <Text
            type="secondary"
            style={{ fontSize: 13, lineHeight: '20px', display: 'block', whiteSpace: 'normal', wordBreak: 'break-word', textAlign: 'center' }}
          >
            {pageNames}
          </Text>
        );
      },
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 150,
      align: 'center',
      fixed: 'right',
      render: (_: unknown, record: RoleRecord) => (
        <Space size="small">
          <Tooltip title="Редактировать права доступа" color={tooltipColor} overlayInnerStyle={tooltipInner}>
            <span>
              <Tag color="blue" style={{ cursor: 'pointer', margin: 0 }} icon={<EditOutlined />} onClick={() => onEditRole(record)}>
                Редактировать
              </Tag>
            </span>
          </Tooltip>

          <Tooltip
            title={record.is_system_role ? 'Системные роли нельзя удалять' : 'Удалить роль'}
            color={tooltipColor}
            overlayInnerStyle={tooltipInner}
          >
            <Popconfirm
              title="Удалить роль?"
              description={
                <>
                  Роль &quot;{record.name}&quot; будет удалена.
                  <br />
                  {record.is_system_role && <span style={{ color: '#ff4d4f' }}>Системные роли нельзя удалять!</span>}
                </>
              }
              onConfirm={() => onDeleteRole(record)}
              okText="Удалить"
              cancelText="Отмена"
              okType="danger"
              disabled={record.is_system_role}
            >
              <span>
                <Tag
                  color="red"
                  style={{ cursor: record.is_system_role ? 'not-allowed' : 'pointer', margin: 0, opacity: record.is_system_role ? 0.5 : 1 }}
                  icon={<DeleteOutlined />}
                >
                  Удалить
                </Tag>
              </span>
            </Popconfirm>
          </Tooltip>
        </Space>
      ),
    },
  ];
}
