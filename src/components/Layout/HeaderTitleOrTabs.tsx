import React from 'react';
import { Typography } from 'antd';
import WorkspaceTabsBar from './WorkspaceTabsBar';
import { useWorkspaceTabs } from '../../contexts/WorkspaceTabsContext';

const { Text } = Typography;

/**
 * Левый слот шапки: панель вкладок рабочего стола (на всех страницах), а пока вкладок нет
 * (первый кадр до регистрации вкладки в WorkspaceKeepAlive) — название страницы, чтобы
 * шапка не мигала пустотой.
 * Вынесено из MainLayout, чтобы layout (Sider/Menu) не перерендеривался
 * на каждое открытие/закрытие вкладки.
 */
const HeaderTitleOrTabs: React.FC<{ pageTitle: string }> = ({ pageTitle }) => {
  const { tabs } = useWorkspaceTabs();

  if (tabs.length > 0) {
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
