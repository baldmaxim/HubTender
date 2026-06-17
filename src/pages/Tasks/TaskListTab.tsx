import React, { useState, useEffect } from 'react';
import { Space, Button, Table, Typography, Switch, Modal, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { UserTaskWithRelations, TaskStatus, WorkMode, WorkStatus } from '../../lib/supabase';
import {
  listUserTasks,
  updateUserTask,
  getWorkSettings,
  setWorkSettings,
} from '../../lib/api/tasks';
import { useTheme } from '../../contexts/ThemeContext';
import { useRealtimeTopic } from '../../lib/realtime/useRealtimeTopic';
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

  // Native WS hub — обновляем список задач при изменениях user_tasks (topic `tasks`).
  useRealtimeTopic('tasks', () => {
    void fetchTasks();
  });

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const data = await listUserTasks(userId, true);
      setTasks(data);
    } catch (err) {
      message.error(
        'Ошибка загрузки задач: ' +
          (err instanceof Error ? err.message : 'неизвестная ошибка'),
      );
    } finally {
      setLoading(false);
    }
  };

  const fetchUserSettings = async () => {
    try {
      const ws = await getWorkSettings(userId);
      setWorkMode(ws.current_work_mode);
      setWorkStatus(ws.current_work_status);
    } catch (err) {
      console.error('Ошибка загрузки настроек:', err);
    }
  };

  const handleWorkModeChange = async (checked: boolean) => {
    const newMode: WorkMode = checked ? 'remote' : 'office';
    setWorkMode(newMode);

    try {
      await setWorkSettings(userId, { current_work_mode: newMode });
    } catch (err) {
      message.error(
        'Ошибка обновления режима работы: ' +
          (err instanceof Error ? err.message : 'неизвестная ошибка'),
      );
      setWorkMode(checked ? 'office' : 'remote');
    }
  };

  const handleWorkStatusChange = async (checked: boolean) => {
    const newStatus: WorkStatus = checked ? 'not_working' : 'working';
    setWorkStatus(newStatus);

    try {
      await setWorkSettings(userId, { current_work_status: newStatus });
    } catch (err) {
      message.error(
        'Ошибка обновления статуса работы: ' +
          (err instanceof Error ? err.message : 'неизвестная ошибка'),
      );
      setWorkStatus(checked ? 'working' : 'not_working');
    }
  };

  const handleToggleTaskStatus = async (taskId: string, newStatus: TaskStatus) => {
    const prev = tasks;
    setTasks(curr =>
      curr.map(t => (t.id === taskId ? { ...t, task_status: newStatus } : t)),
    );
    try {
      await updateUserTask(taskId, { task_status: newStatus });
      await fetchTasks();
    } catch (err) {
      setTasks(prev);
      message.error(
        'Ошибка обновления статуса задачи: ' +
          (err instanceof Error ? err.message : 'неизвестная ошибка'),
      );
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
        try {
          await updateUserTask(taskId, {
            task_status: 'completed',
            completed_at: new Date().toISOString(),
          });
          message.success('Задача завершена');
          fetchTasks();
        } catch (err) {
          message.error(
            'Ошибка завершения задачи: ' +
              (err instanceof Error ? err.message : 'неизвестная ошибка'),
          );
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
      render: (_: unknown, record: UserTaskWithRelations) => record.tender?.title || 'Прочее',
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
      render: (_: unknown, record: UserTaskWithRelations) => {
        const isRunning = record.task_status === 'running';
        const wasPaused = record.task_status === 'paused';

        return (
          <Space>
            <Button
              style={isRunning ? { backgroundColor: '#fffbe6', borderColor: '#ffd666', color: '#000' } : {}}
              onClick={() => handleToggleTaskStatus(record.id, isRunning ? 'paused' : 'running')}
            >
              {isRunning ? 'Остановить' : wasPaused ? 'Возобновить' : 'Запустить'}
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
