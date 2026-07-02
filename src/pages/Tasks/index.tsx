import React, { useState, useEffect } from 'react';
import { Tabs, Select, message } from 'antd';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { canManageUsers } from '../../lib/types/types';
import { listTimelineAssignableUsers } from '../../lib/api/timeline';
import TaskListTab from './TaskListTab';
import EmployeeTasksTab from './EmployeeTasksTab';
import './Tasks.css';

const Tasks: React.FC = () => {
  const { user } = useAuth();
  const { theme: currentTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<string>('my-tasks');
  const [searchUserId, setSearchUserId] = useState<string | undefined>(undefined);
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);

  useEffect(() => {
    if (activeTab === 'employee-tasks') {
      fetchUsers();
    }
  }, [activeTab]);

  const fetchUsers = async () => {
    try {
      const data = await listTimelineAssignableUsers();
      setUsers(data.map((u) => ({ id: u.id, full_name: u.full_name })));
    } catch (err) {
      message.error(
        'Ошибка загрузки пользователей: ' +
          (err instanceof Error ? err.message : 'неизвестная ошибка'),
      );
    }
  };

  if (!user) {
    return null;
  }

  const canViewEmployeeTasks = canManageUsers(user.role);

  const tabItems = [
    {
      key: 'my-tasks',
      label: 'Список задач',
      children: <TaskListTab userId={user.id} />,
    },
    ...(canViewEmployeeTasks
      ? [
          {
            key: 'employee-tasks',
            label: 'Данные о задачах сотрудников',
            children: <EmployeeTasksTab searchUserId={searchUserId} />,
          },
        ]
      : []),
  ];

  return (
    <div className={`tasks-page ${currentTheme === 'dark' ? 'dark' : ''}`} style={{ padding: '24px' }}>
      <div style={{ position: 'relative', marginBottom: '16px' }}>
        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            setActiveTab(key);
            if (key === 'my-tasks') {
              setSearchUserId(undefined);
            }
          }}
          items={tabItems}
        />
        {activeTab === 'employee-tasks' && (
          <Select
            placeholder="Поиск по ФИО"
            style={{ width: 400, position: 'absolute', right: 0, top: 4 }}
            allowClear
            showSearch
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            value={searchUserId}
            onChange={(value) => setSearchUserId(value)}
            options={users.map(u => ({ label: u.full_name, value: u.id }))}
          />
        )}
      </div>
    </div>
  );
};

export default Tasks;
