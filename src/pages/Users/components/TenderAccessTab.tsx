import React, { useState, useEffect } from 'react';
import { Table, Button, Modal, Select, DatePicker, message, Space, Tag, Tooltip } from 'antd';
import { CalendarOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTheme } from '../../../contexts/ThemeContext';
import type { TenderDeadlineExtension } from '../../../lib/supabase/types';
import { getErrorMessage } from '../../../utils/errors';
import { fetchTenders } from '../../../lib/api/tenders';
import { listAccessUsers, setTenderExtensionForUsers } from '../../../lib/api/userAdmin';

interface TenderRecord {
  id: string;
  tender_number: string;
  version: number;
  title: string;
  submission_deadline: string;
}

interface UserRecord {
  id: string;
  full_name: string;
  role_code: string;
  role_name?: string;
  tender_deadline_extensions?: TenderDeadlineExtension[];
}

interface UserExtensionDisplay {
  user_id: string;
  user_name: string;
  extended_deadline: string;
}

interface TenderAccessTabProps {
  searchText?: string;
}

const TenderAccessTab: React.FC<TenderAccessTabProps> = ({ searchText = '' }) => {
  const { theme } = useTheme();
  const [tenders, setTenders] = useState<TenderRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [allUsersWithExtensions, setAllUsersWithExtensions] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedTender, setSelectedTender] = useState<TenderRecord | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [extendedDeadline, setExtendedDeadline] = useState<dayjs.Dayjs | null>(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [selectedDeleteUserIds, setSelectedDeleteUserIds] = useState<string[]>([]);

  const loadTenders = async () => {
    setLoading(true);
    try {
      const all = await fetchTenders();
      const mapped: TenderRecord[] = (all ?? [])
        .filter((t) => Boolean(t.submission_deadline))
        .map((t) => ({
          id: t.id,
          tender_number: t.tender_number ?? '',
          version: t.version ?? 1,
          title: t.title ?? '',
          submission_deadline: t.submission_deadline as string,
        }))
        .sort((a, b) => b.submission_deadline.localeCompare(a.submission_deadline));
      setTenders(mapped);
    } catch (error) {
      console.error('Ошибка загрузки тендеров:', error);
      message.error('Ошибка загрузки тендеров');
    } finally {
      setLoading(false);
    }
  };

  // Approved non-privileged users + their per-tender extensions in one fetch.
  const loadUsersAndExtensions = async () => {
    try {
      const rows = await listAccessUsers();
      const list: UserRecord[] = rows.map((u) => ({
        id: u.id,
        full_name: u.full_name,
        role_code: u.role_code,
        role_name: u.role_name,
        tender_deadline_extensions: (u.tender_deadline_extensions || []) as TenderDeadlineExtension[],
      }));
      setUsers(list);
      setAllUsersWithExtensions(list);
    } catch (error) {
      console.error('Ошибка загрузки пользователей:', error);
    }
  };

  useEffect(() => {
    loadTenders();
    loadUsersAndExtensions();
  }, []);

  // Открыть модальное окно продления доступа
  const handleExtendAccess = (tender: TenderRecord) => {
    setSelectedTender(tender);
    setSelectedUserIds([]);
    setExtendedDeadline(dayjs(tender.submission_deadline).add(7, 'day'));
    setModalVisible(true);
  };

  const handleSaveExtension = async () => {
    if (selectedUserIds.length === 0 || !selectedTender || !extendedDeadline) {
      message.error('Выберите пользователей и дату');
      return;
    }

    try {
      await setTenderExtensionForUsers({
        tender_id: selectedTender.id,
        user_ids: selectedUserIds,
        extended_deadline: extendedDeadline.toISOString(),
      });

      message.success(`Доступ успешно продлен для ${selectedUserIds.length} пользователей`);
      setModalVisible(false);
      await loadUsersAndExtensions();
    } catch (error) {
      console.error('Ошибка сохранения:', error);
      message.error('Ошибка: ' + getErrorMessage(error));
    }
  };

  // Получить пользователей с доступом к конкретному тендеру
  const getUsersForTender = (tenderId: string): UserExtensionDisplay[] => {
    return allUsersWithExtensions
      .filter(user => {
        const extensions = user.tender_deadline_extensions || [];
        return extensions.some(ext => ext.tender_id === tenderId);
      })
      .map(user => {
        const extension = user.tender_deadline_extensions!.find(ext => ext.tender_id === tenderId);
        return {
          user_id: user.id,
          user_name: user.full_name,
          extended_deadline: extension!.extended_deadline
        };
      });
  };

  // Открыть модальное окно удаления пользователей
  const handleOpenDeleteModal = (tender: TenderRecord) => {
    const usersWithAccess = getUsersForTender(tender.id);

    if (usersWithAccess.length === 0) {
      message.info('Нет пользователей для удаления');
      return;
    }

    setSelectedTender(tender);
    setSelectedDeleteUserIds([]);
    setDeleteModalVisible(true);
  };

  const handleDeleteSelectedUsers = async () => {
    if (selectedDeleteUserIds.length === 0 || !selectedTender) {
      message.error('Выберите пользователей для удаления');
      return;
    }

    try {
      await setTenderExtensionForUsers({
        tender_id: selectedTender.id,
        user_ids: selectedDeleteUserIds,
        extended_deadline: '',
      });

      message.success(`Удален доступ для ${selectedDeleteUserIds.length} чел.`);
      setDeleteModalVisible(false);
      setSelectedDeleteUserIds([]);
      await loadUsersAndExtensions();
    } catch (error) {
      console.error('Ошибка удаления:', error);
      message.error('Ошибка: ' + getErrorMessage(error));
    }
  };

  // Фильтрация тендеров по поиску
  const filteredTenders = React.useMemo(() => {
    if (!searchText) return tenders;
    const search = searchText.toLowerCase();
    return tenders.filter(tender =>
      tender.title.toLowerCase().includes(search) ||
      tender.tender_number.toLowerCase().includes(search)
    );
  }, [tenders, searchText]);

  // Колонки таблицы
  const columns = [
    {
      title: <div style={{ textAlign: 'center' }}>Номер тендера</div>,
      dataIndex: 'tender_number',
      key: 'tender_number',
      width: 150,
      align: 'center' as const,
      sorter: (a: TenderRecord, b: TenderRecord) => a.tender_number.localeCompare(b.tender_number),
      render: (text: string) => <span>№{text}</span>
    },
    {
      title: 'Название',
      key: 'title',
      width: 150,
      sorter: (a: TenderRecord, b: TenderRecord) => a.title.localeCompare(b.title),
      render: (_: unknown, record: TenderRecord) => (
        <Space>
          <span>{record.title}</span>
          <Tag color="blue">v{record.version}</Tag>
        </Space>
      )
    },
    {
      title: <div style={{ textAlign: 'center' }}>Срок сдачи</div>,
      dataIndex: 'submission_deadline',
      key: 'submission_deadline',
      width: 180,
      align: 'center' as const,
      render: (deadline: string) => {
        const date = dayjs(deadline);
        const now = dayjs();
        const isExpired = date.isBefore(now);
        const daysUntil = date.diff(now, 'day');

        return (
          <Space>
            <span>{date.format('DD.MM.YYYY HH:mm')}</span>
            {isExpired ? (
              <Tag color="red">Истек</Tag>
            ) : daysUntil < 7 ? (
              <Tag color="orange">{daysUntil}д</Tag>
            ) : (
              <Tag color="green">{daysUntil}д</Tag>
            )}
          </Space>
        );
      }
    },
    {
      title: <div style={{ textAlign: 'center' }}>Пользователь</div>,
      key: 'users',
      width: 350,
      align: 'center' as const,
      render: (_: unknown, record: TenderRecord) => {
        const usersWithAccess = getUsersForTender(record.id);
        if (usersWithAccess.length === 0) {
          return <span style={{ color: '#888' }}>-</span>;
        }
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {usersWithAccess.map(u => (
              <div key={u.user_id}>{u.user_name}</div>
            ))}
          </div>
        );
      }
    },
    {
      title: <div style={{ textAlign: 'center' }}>Срок сдачи (продленный)</div>,
      key: 'extended_deadlines',
      width: 200,
      align: 'center' as const,
      render: (_: unknown, record: TenderRecord) => {
        const usersWithAccess = getUsersForTender(record.id);
        if (usersWithAccess.length === 0) {
          return <span style={{ color: '#888' }}>-</span>;
        }
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {usersWithAccess.map(u => {
              const date = dayjs(u.extended_deadline);
              const now = dayjs();
              const isExpired = date.isBefore(now);
              const daysUntil = date.diff(now, 'day');

              return (
                <Space key={u.user_id} size="small">
                  <span>{date.format('DD.MM.YYYY HH:mm')}</span>
                  {isExpired ? (
                    <Tag color="red">Истек</Tag>
                  ) : daysUntil < 7 ? (
                    <Tag color="orange">{daysUntil}д</Tag>
                  ) : (
                    <Tag color="green">{daysUntil}д</Tag>
                  )}
                </Space>
              );
            })}
          </div>
        );
      }
    },
    {
      title: <div style={{ textAlign: 'center' }}>Действия</div>,
      key: 'actions',
      width: 100,
      align: 'center' as const,
      render: (_: unknown, record: TenderRecord) => {
        const usersWithAccess = getUsersForTender(record.id);
        const hasUsers = usersWithAccess.length > 0;

        return (
          <Space size="small">
            <Tooltip title="Продлить доступ пользователю">
              <Button
                type="text"
                size="small"
                icon={<CalendarOutlined />}
                onClick={() => handleExtendAccess(record)}
              />
            </Tooltip>
            {hasUsers && (
              <Tooltip title="Удалить пользователей из списка доступа">
                <Button
                  danger
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => handleOpenDeleteModal(record)}
                />
              </Tooltip>
            )}
          </Space>
        );
      }
    }
  ];

  return (
    <div>
      <Table
        columns={columns}
        dataSource={filteredTenders}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20 }}
      />

      <Modal
        title={`Продлить доступ к тендеру №${selectedTender?.tender_number} v${selectedTender?.version}`}
        open={modalVisible}
        onOk={handleSaveExtension}
        onCancel={() => setModalVisible(false)}
        okText="Сохранить"
        cancelText="Отмена"
        width={600}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div>
            <label>Пользователи:</label>
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              placeholder="Выберите пользователей"
              value={selectedUserIds}
              onChange={setSelectedUserIds}
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={users.map(u => ({
                value: u.id,
                label: `${u.full_name} (${u.role_name})`
              }))}
            />
          </div>

          <div>
            <label>Новая дата дедлайна:</label>
            <DatePicker
              style={{ width: '100%' }}
              showTime
              format="DD.MM.YYYY HH:mm"
              value={extendedDeadline}
              onChange={setExtendedDeadline}
            />
          </div>

          {selectedTender && (
            <div style={{
              padding: '12px',
              background: theme === 'dark' ? 'rgba(255, 255, 255, 0.08)' : '#f5f5f5',
              borderRadius: 4,
              color: theme === 'dark' ? '#fff' : '#000'
            }}>
              <div>Оригинальный дедлайн: {dayjs(selectedTender.submission_deadline).format('DD.MM.YYYY HH:mm')}</div>
            </div>
          )}
        </Space>
      </Modal>

      <Modal
        title={`Удалить пользователей из тендера №${selectedTender?.tender_number} v${selectedTender?.version}`}
        open={deleteModalVisible}
        onOk={handleDeleteSelectedUsers}
        onCancel={() => {
          setDeleteModalVisible(false);
          setSelectedDeleteUserIds([]);
        }}
        okText="Удалить"
        cancelText="Отмена"
        okType="danger"
        width={600}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div>
            <label>Выберите пользователей для удаления доступа:</label>
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              placeholder="Выберите пользователей"
              value={selectedDeleteUserIds}
              onChange={setSelectedDeleteUserIds}
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={selectedTender ? getUsersForTender(selectedTender.id).map(u => ({
                value: u.user_id,
                label: u.user_name
              })) : []}
            />
          </div>

          {selectedTender && selectedDeleteUserIds.length > 0 && (
            <div style={{
              padding: '12px',
              background: theme === 'dark' ? 'rgba(255, 107, 107, 0.1)' : '#fff1f0',
              borderRadius: 4,
              borderLeft: '3px solid #ff4d4f',
              color: theme === 'dark' ? '#fff' : '#000'
            }}>
              <div>Будет удален доступ для {selectedDeleteUserIds.length} чел.</div>
            </div>
          )}
        </Space>
      </Modal>
    </div>
  );
};

export default TenderAccessTab;
