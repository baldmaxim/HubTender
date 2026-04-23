import React, { useState } from 'react';
import { Card, Tabs, Button, Space, Input } from 'antd';
import {
  AppstoreOutlined,
  BarChartOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useProjectsData } from './hooks/useProjectsData';
import { useProjectActions } from './hooks/useProjectActions';
import { ProjectsList } from './components/ProjectsList';
import { GanttChart } from './components/GanttChart';
import { ProjectModal } from './components/ProjectModal';

import type { ProjectFull } from '../../lib/supabase/types';


const Projects: React.FC = () => {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState<string>('list');
  const [searchText, setSearchText] = useState('');

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
      children: <ProjectsList data={filteredProjects} loading={loading} agreementsMap={agreementsMap} />,
    },
    {
      key: 'schedule',
      label: (
        <span>
          <BarChartOutlined style={{ marginRight: 8 }} />
          График
        </span>
      ),
      children: <GanttChart projects={filteredProjects} completionData={completionData} />,
    },
  ];

  return (
    <div style={{ padding: '0 8px 8px' }}>
      <Card
        bordered={false}
        bodyStyle={{ padding: '8px 0' }}
        style={{
          background: theme === 'dark' ? '#141414' : '#fff',
        }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
          size="large"
          tabBarExtraContent={
            <Space>
              <Input
                placeholder="Поиск по названию или заказчику"
                prefix={<SearchOutlined />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                style={{ width: 280 }}
                allowClear
              />
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAddProject}>
                Добавить объект
              </Button>
            </Space>
          }
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
