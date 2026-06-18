import React, { useState } from 'react';
import { Card, Tabs, Button, Space, Input } from 'antd';
import {
  AppstoreOutlined,
  BarChartOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useProjectsData } from './hooks/useProjectsData';
import { useProjectActions } from './hooks/useProjectActions';
import { ProjectsList } from './components/ProjectsList';
import { ProjectCards } from './components/ProjectCards';
import { GanttChart } from './components/GanttChart';
import { ProjectModal } from './components/ProjectModal';

import type { ProjectFull } from '../../lib/supabase/types';


const Projects: React.FC = () => {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { isPhone, isMobile, screens } = useIsMobile();
  // Генеральный директор и телефоны — только просмотр (без добавления/редактирования объектов)
  const readOnly = user?.role_code === 'general_director' || isMobile;
  const [activeTab, setActiveTab] = useState<string>('list');
  const [searchText, setSearchText] = useState('');

  const handleTabChange = (key: string) => {
    setActiveTab(key);
  };

  // Data hooks
  const { projects, loading, fetchProjects, completionData, agreementsMap } = useProjectsData();
  const actions = useProjectActions(fetchProjects);

  // Modal states
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectFull | null>(null);

  // Handlers
  const handleAddProject = () => {
    setEditingProject(null);
    setProjectModalOpen(true);
  };

  const handleProjectModalClose = () => {
    setProjectModalOpen(false);
    setEditingProject(null);
  };

  // Filter projects by search text
  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(searchText.toLowerCase()) ||
      p.client_name.toLowerCase().includes(searchText.toLowerCase())
  );

  // Tab items
  const tabItems = [
    {
      key: 'list',
      label: (
        <span>
          <AppstoreOutlined style={{ marginRight: 8 }} />
          Список объектов
        </span>
      ),
      children: !screens.lg ? (
        <ProjectCards data={filteredProjects} loading={loading} />
      ) : (
        <ProjectsList data={filteredProjects} loading={loading} agreementsMap={agreementsMap} />
      ),
    },
    {
      key: 'schedule',
      label: (
        <span>
          <BarChartOutlined style={{ marginRight: 8 }} />
          График
        </span>
      ),
      children: (
        <GanttChart projects={filteredProjects} completionData={completionData} />
      ),
    },
  ];

  // Панель фильтра + действий. На телефонах выносится в отдельную строку над
  // вкладками, на планшетах/десктопе остаётся справа от вкладок (tabBarExtraContent).
  const toolbar = (
    <Space wrap style={isPhone ? { width: '100%' } : undefined}>
      <Input
        placeholder="Поиск по названию или заказчику"
        prefix={<SearchOutlined />}
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        style={{ width: isPhone ? '100%' : 280 }}
        allowClear
      />
      {!readOnly && (
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddProject}>
          Добавить объект
        </Button>
      )}
    </Space>
  );

  return (
    <div style={{ padding: isPhone ? 0 : '0 8px 8px' }}>
      <Card
        bordered={false}
        bodyStyle={{ padding: '8px 0' }}
        style={{
          background: theme === 'dark' ? '#141414' : '#fff',
        }}
      >
        {isPhone && (
          <div style={{ padding: '0 8px 8px' }}>{toolbar}</div>
        )}
        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          items={tabItems}
          size={isPhone ? 'middle' : 'large'}
          tabBarExtraContent={isPhone ? undefined : toolbar}
        />
      </Card>

      {/* Modal for adding new projects */}
      <ProjectModal
        open={projectModalOpen}
        editingProject={editingProject}
        onClose={handleProjectModalClose}
        onSave={async (values) => {
          const success = await actions.handleSave(values, editingProject?.id);
          if (success) {
            handleProjectModalClose();
          }
          return success;
        }}
      />
    </div>
  );
};

export default Projects;
