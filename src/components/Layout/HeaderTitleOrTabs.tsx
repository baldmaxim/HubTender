import React from 'react';
import { Typography } from 'antd';
import { useLocation } from 'react-router-dom';
import WorkspaceTabsBar from './WorkspaceTabsBar';
import { useWorkspaceTabs } from '../../contexts/WorkspaceTabsContext';
import { isWorkspacePath } from './workspacePages';

const { Text } = Typography;

/**
 * Левый слот шапки: на workspace-роутах — панель вкладок рабочего стола,
 * иначе — обычное название страницы без крестика (как раньше). Fallback на
 * заголовок и при пустом списке вкладок (первый кадр деп-линка до регистрации
 * вкладки в WorkspaceKeepAlive) — шапка не мигает пустотой.
 * Вынесено из MainLayout, чтобы layout (Sider/Menu) не перерендеривался
 * на каждое открытие/закрытие вкладки.
 */
const HeaderTitleOrTabs: React.FC<{ pageTitle: string }> = ({ pageTitle }) => {
  const location = useLocation();
  const { tabs } = useWorkspaceTabs();

  if (isWorkspacePath(location.pathname) && tabs.length > 0) {
    return <WorkspaceTabsBar />;
  }

  if (!pageTitle) return null;

  return (
    <Text
      strong
      style={{
        fontSize: 16,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        minWidth: 0,
      }}
    >
      {pageTitle}
    </Text>
  );
};

export default HeaderTitleOrTabs;
