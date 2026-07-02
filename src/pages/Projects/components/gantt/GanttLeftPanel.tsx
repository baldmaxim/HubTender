import React from 'react';
import { Typography, Progress, Button } from 'antd';
import { EyeInvisibleOutlined } from '@ant-design/icons';
import type { ProjectFull } from '../../../../lib/supabase/types';
import { COLORS } from './ganttUtils';

const { Text } = Typography;

/** Левая панель Ганта: имена объектов с прогрессом и кнопкой «скрыть». */
export const GanttLeftPanel: React.FC<{
  visibleProjects: ProjectFull[];
  theme: string;
  portrait: boolean;
  projectNameWidth: number;
  rowHeight: number;
  headerHeight: number;
  hoveredProject: string | null;
  setHoveredProject: (id: string | null) => void;
  hideProject: (id: string) => void;
}> = ({
  visibleProjects,
  theme,
  portrait,
  projectNameWidth,
  rowHeight,
  headerHeight,
  hoveredProject,
  setHoveredProject,
  hideProject,
}) => (
  <div
    style={{
      width: portrait ? 150 : projectNameWidth,
      flexShrink: 0,
      borderRight: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
    }}
  >
    {/* Header */}
    <div
      style={{
        height: headerHeight,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        borderBottom: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
        background: theme === 'dark' ? '#1f1f1f' : '#fafafa',
      }}
    >
      <Text strong>Объект</Text>
    </div>

    {/* Project rows */}
    {visibleProjects.map((project, index) => {
      return (
        <div
          key={project.id}
          style={{
            height: rowHeight,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '0 16px',
            borderBottom: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
            background:
              hoveredProject === project.id
                ? theme === 'dark'
                  ? '#262626'
                  : '#f5f5f5'
                : 'transparent',
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
          onMouseEnter={() => setHoveredProject(project.id)}
          onMouseLeave={() => setHoveredProject(null)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              type="text"
              size="small"
              icon={<EyeInvisibleOutlined />}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                hideProject(project.id);
              }}
              style={{ padding: '0 4px', minWidth: 'auto' }}
              title="Скрыть объект"
            />
            <Text
              strong
              ellipsis
              style={{
                color: COLORS[index % COLORS.length],
                maxWidth: projectNameWidth - 64,
              }}
            >
              {project.name}
            </Text>
          </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <Progress
            percent={Math.min(Math.round(project.completion_percentage ?? 0), 100)}
            size="small"
            showInfo={false}
            strokeColor={COLORS[index % COLORS.length]}
            style={{ width: 80, margin: 0 }}
          />
          <Text type="secondary" style={{ fontSize: 11 }}>
            {Math.round(project.completion_percentage ?? 0)}%
          </Text>
        </div>
      </div>
    );
    })}

    {/* Totals row label */}
    <div
      style={{
        height: rowHeight,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        background: theme === 'dark' ? '#1f1f1f' : '#fafafa',
        borderTop: `2px solid ${theme === 'dark' ? '#434343' : '#d9d9d9'}`,
      }}
    >
      <Text strong style={{ color: '#52c41a' }}>ИТОГО</Text>
    </div>
  </div>
);
