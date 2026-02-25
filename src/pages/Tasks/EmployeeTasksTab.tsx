import React, { useState, useEffect, useMemo } from 'react';
import { Table, Tabs, message } from 'antd';
import { supabase, type UserTaskWithRelations, type TaskStatus, type WorkMode, type WorkStatus } from '../../lib/supabase';
import dayjs from 'dayjs';

interface EmployeeTasksTabProps {
  searchUserId?: string;
}

const STATUS_TABS: { key: TaskStatus; label: string }[] = [
  { key: 'running', label: 'В работе' },
  { key: 'paused', label: 'Остановлены' },
  { key: 'completed', label: 'Завершены' },
];

const EmployeeTasksTab: React.FC<EmployeeTasksTabProps> = ({ searchUserId }) => {
  const [allTasks, setAllTasks] = useState<UserTaskWithRelations[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeStatus, setActiveStatus] = useState<TaskStatus>('running');

  useEffect(() => {
    fetchAllTasks();
  }, []);

  const filteredTasks = useMemo(() => {
    let filtered = allTasks.filter(t => t.task_status === activeStatus);

    if (searchUserId) {
      filtered = filtered.filter(t => t.user_id === searchUserId);
    }

    return filtered;
  }, [searchUserId, allTasks, activeStatus]);

  const fetchAllTasks = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_tasks')
      .select(`
        *,
        tender:tender_id(id, title),
        user:user_id(id, full_name, email, current_work_mode, current_work_status)
      `)
      .order('created_at', { ascending: false });

    setLoading(false);

    if (error) {
      message.error('Ошибка загрузки задач: ' + error.message);
      return;
    }

    setAllTasks(data || []);
  };

  const getRowClassName = (record: UserTaskWithRelations) => {
    switch (record.task_status) {
      case 'running':
        return 'task-row-running';
      case 'paused':
        return 'task-row-paused';
      case 'completed':
        return 'task-row-completed';
      default:
        return '';
    }
  };

  const columns = [
    {
      title: <div style={{ textAlign: 'center' }}>ФИО</div>,
      dataIndex: ['user', 'full_name'],
      key: 'user_full_name',
      align: 'center' as const,
      sorter: (a: UserTaskWithRelations, b: UserTaskWithRelations) =>
        a.user.full_name.localeCompare(b.user.full_name),
    },
    {
      title: <div style={{ textAlign: 'center' }}>Email</div>,
      dataIndex: ['user', 'email'],
      key: 'user_email',
      align: 'center' as const,
    },
    {
      title: <div style={{ textAlign: 'center' }}>Наименование проекта</div>,
      key: 'tender_title',
      align: 'center' as const,
      render: (_: any, record: UserTaskWithRelations) => record.tender?.title || 'Прочее',
      sorter: (a: UserTaskWithRelations, b: UserTaskWithRelations) =>
        (a.tender?.title || 'Прочее').localeCompare(b.tender?.title || 'Прочее'),
    },
    {
      title: <div style={{ textAlign: 'center' }}>Описание задачи</div>,
      dataIndex: 'description',
      key: 'description',
      align: 'center' as const,
    },
    {
      title: <div style={{ textAlign: 'center' }}>Дата начала</div>,
      dataIndex: 'created_at',
      key: 'created_at',
      align: 'center' as const,
      render: (val: string) => dayjs(val).format('DD.MM.YYYY HH:mm'),
    },
    {
      title: <div style={{ textAlign: 'center' }}>Дата окончания</div>,
      dataIndex: 'completed_at',
      key: 'completed_at',
      align: 'center' as const,
      render: (val: string | null) => (val ? dayjs(val).format('DD.MM.YYYY HH:mm') : '-'),
      sorter: (a: UserTaskWithRelations, b: UserTaskWithRelations) => {
        if (!a.completed_at && !b.completed_at) return 0;
        if (!a.completed_at) return 1;
        if (!b.completed_at) return -1;
        return new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime();
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Статус выполнения</div>,
      dataIndex: 'task_status',
      key: 'task_status',
      align: 'center' as const,
      render: (val: TaskStatus) => {
        const labels: Record<TaskStatus, string> = {
          running: 'В работе',
          paused: 'Остановлена',
          completed: 'Завершена',
        };
        return labels[val];
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>Статус работы</div>,
      dataIndex: ['user', 'current_work_status'],
      key: 'work_status',
      align: 'center' as const,
      width: 120,
      render: (val: WorkStatus) => (val === 'working' ? 'Работаю' : 'Не работаю'),
    },
    {
      title: <div style={{ textAlign: 'center' }}>Режим работы</div>,
      dataIndex: ['user', 'current_work_mode'],
      key: 'work_mode',
      align: 'center' as const,
      width: 120,
      render: (val: WorkMode) => (val === 'office' ? 'Офис' : 'Удаленка'),
    },
  ];

  const statusTabItems = STATUS_TABS.map(({ key, label }) => {
    const count = allTasks.filter(t => {
      if (t.task_status !== key) return false;
      if (searchUserId) return t.user_id === searchUserId;
      return true;
    }).length;

    return {
      key,
      label: `${label} (${count})`,
      children: (
        <Table
          dataSource={filteredTasks}
          loading={loading}
          rowKey="id"
          rowClassName={getRowClassName}
          columns={columns}
          scroll={{ x: 1400, y: 'calc(100vh - 340px)' }}
          pagination={false}
        />
      ),
    };
  });

  return (
    <Tabs
      activeKey={activeStatus}
      onChange={(key) => setActiveStatus(key as TaskStatus)}
      items={statusTabItems}
    />
  );
};

export default EmployeeTasksTab;
