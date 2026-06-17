import React, { useState } from 'react';
import { Card, Tabs, Button, Space, Input, Empty } from 'antd';
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
import { LandscapeOverlay } from './components/LandscapeOverlay';
import { ProjectModal } from './components/ProjectModal';

import type { ProjectFull } from '../../lib/supabase/types';


const Projects: React.FC = () => {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { isPhone, screens } = useIsMobile();
  // Генеральный директор — только просмотр (без добавления/редактирования объектов)
  const readOnly = user?.role_code === 'general_director';
  const [activeTab, setActiveTab] = useState<string>('list');
  const [searchText, setSearchText] = useState('');
  // Псевдо-ландшафт «Графика» на телефонах
  const [landscapeOpen, setLandscapeOpen] = useState(false);

  // На телефоне переход на вкладку «График» сразу открывает ландшафт-оверлей.
  const handleTabChange = (key: string) => {
    setActiveTab(key);
    if (key === 'schedule' && isPhone) setLandscapeOpen(true);
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
      children:
        landscapeOpen && isPhone ? (
          // Портретный инстанс не держим, пока открыт ландшафт (не дублируем chart.js)
          <div style={{ padding: '48px 16px', textAlign: 'center' }}>
            <Empty description="График открыт в ландшафтном режиме" />
            <Button type="primary" style={{ marginTop: 16 }} onClick={() => setLandscapeOpen(true)}>
              Открыть на весь экран
            </Button>
          </div>
        ) : (
          <GanttChart
            projects={filteredProjects}
            completionData={completionData}
            onRequestLandscape={isPhone ? () => setLandscapeOpen(true) : undefined}
          />
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
    <div style={{ padding: '0 8px 8px' }}>
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

      {/* Псевдо-ландшафт «Графика» только на телефонах */}
      {isPhone && (
        <LandscapeOverlay
          open={landscapeOpen}
          onClose={() => setLandscapeOpen(false)}
          background={theme === 'dark' ? '#141414' : '#fff'}
        >
          {landscapeOpen && (
            <GanttChart landscape projects={filteredProjects} completionData={completionData} />
          )}
        </LandscapeOverlay>
      )}

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
