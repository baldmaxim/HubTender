import React, { useState, useEffect } from 'react';
import { Space, Button, Table, Typography, Switch, Modal, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { supabase, type UserTaskWithRelations, type TaskStatus, type WorkMode, type WorkStatus } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import AddTaskModal from './AddTaskModal';

const { Text } = Typography;

interface TaskListTabProps {
  userId: string;
}

const TaskListTab: React.FC<TaskListTabProps> = ({ userId }) => {
  const { theme: currentTheme } = useTheme();
  const [tasks, setTasks] = useState<UserTaskWithRelations[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [workMode, setWorkMode] = useState<WorkMode>('office');
  const [workStatus, setWorkStatus] = useState<WorkStatus>('working');

  useEffect(() => {
    fetchTasks();
    fetchUserSettings();
    // fetchTasks and fetchUserSettings are defined in this component; excluded to avoid refetch loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const fetchTasks = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_tasks')
      .select(`
        *,
        tender:tender_id(id, title)
      `)
      .eq('user_id', userId)
      .neq('task_status', 'completed')
      .order('created_at', { ascending: false });

    setLoading(false);

    if (error) {
      message.error('Ошибка загрузки задач: ' + error.message);
    } else {
      setTasks(data || []);
    }
  };

  const fetchUserSettings = async () => {
    const { data, error } = await supabase
      .from('users')
      .select('current_work_mode, current_work_status')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Ошибка загрузки настроек:', error);
      return;
    }

    if (data) {
      setWorkMode(data.current_work_mode);
      setWorkStatus(data.current_work_status);
    }
  };

  const handleWorkModeChange = async (checked: boolean) => {
    const newMode: WorkMode = checked ? 'remote' : 'office';
    setWorkMode(newMode);

    const { error } = await supabase
      .from('users')
      .update({ current_work_mode: newMode })
      .eq('id', userId);

    if (error) {
      message.error('Ошибка обновления режима работы: ' + error.message);
      setWorkMode(checked ? 'office' : 'remote');
    }
  };

  const handleWorkStatusChange = async (checked: boolean) => {
    const newStatus: WorkStatus = checked ? 'not_working' : 'working';
    setWorkStatus(newStatus);

    const { error } = await supabase
      .from('users')
      .update({ current_work_status: newStatus })
      .eq('id', userId);

    if (error) {
      message.error('Ошибка обновления статуса работы: ' + error.message);
      setWorkStatus(checked ? 'working' : 'not_working');
    }
  };

  const handleToggleTaskStatus = async (taskId: string, newStatus: TaskStatus) => {
    const { error } = await supabase
      .from('user_tasks')
      .update({ task_status: newStatus })
      .eq('id', taskId);

    if (error) {
      message.error('Ошибка обновления статуса задачи: ' + error.message);
    } else {
      fetchTasks();
    }
  };

  const handleCompleteTask = (taskId: string) => {
    Modal.confirm({
      title: 'Завершить задачу?',
      content: 'Задача исчезнет из списка, но сохранится в истории.',
      okText: 'Завершить',
      cancelText: 'Отмена',
      rootClassName: currentTheme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        const { error } = await supabase
          .from('user_tasks')
          .update({
            task_status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', taskId);

        if (error) {
          message.error('Ошибка завершения задачи: ' + error.message);
        } else {
          message.success('Задача завершена');
          fetchTasks();
        }
      },
    });
  };

  const columns = [
    {
      title: 'Наименование проекта',
      key: 'tender_title',
      align: 'left' as const,
      width: 200,
      render: (_: any, record: UserTaskWithRelations) => record.tender?.title || 'Прочее',
    },
    {
      title: 'Описание задачи',
      dataIndex: 'description',
      key: 'description',
      width: 731,
    },
    {
      title: <div style={{ textAlign: 'center' }}>Действия</div>,
      key: 'actions',
      align: 'center' as const,
      width: 19,
      render: (_: any, record: UserTaskWithRelations) => {
        const isRunning = record.task_status === 'running';

        return (
          <Space>
            <Button
              style={isRunning ? { backgroundColor: '#fffbe6', borderColor: '#ffd666', color: '#000' } : {}}
              onClick={() => handleToggleTaskStatus(record.id, isRunning ? 'paused' : 'running')}
            >
              {isRunning ? 'Остановить' : 'Запустить'}
            </Button>

            <Button danger onClick={() => handleCompleteTask(record.id)}>
              Завершить
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* Глобальные переключатели */}
      <Space size="large">
        <Space>
          <Switch checked={workMode === 'remote'} onChange={handleWorkModeChange} />
          <Text>Удаленка</Text>
        </Space>

        <Space>
          <Switch checked={workStatus === 'not_working'} onChange={handleWorkStatusChange} />
          <Text>Не работаю</Text>
        </Space>
      </Space>

      {/* Кнопка добавления */}
      <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>
        Добавить задачу
      </Button>

      {/* Таблица */}
      <Table
        dataSource={tasks}
        loading={loading}
        rowKey="id"
        columns={columns}
        pagination={false}
        scroll={{ x: 800 }}
      />

      <AddTaskModal
        open={isModalOpen}
        userId={userId}
        currentTheme={currentTheme}
        onCancel={() => setIsModalOpen(false)}
        onSuccess={() => {
          setIsModalOpen(false);
          fetchTasks();
        }}
      />
    </Space>
  );
};

export default TaskListTab;
