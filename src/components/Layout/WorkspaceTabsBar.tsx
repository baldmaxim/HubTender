import React, { useMemo } from 'react';
import { Tabs } from 'antd';
import type { TabsProps } from 'antd';
import { useNavigate, useMatch, useLocation } from 'react-router-dom';
import { useWorkspaceTabs, type WorkspaceTab } from '../../contexts/WorkspaceTabsContext';
import { WORKSPACE_PAGES } from './workspacePages';

/**
 * Панель вкладок «рабочего стола»: по вкладке на каждую открытую страницу-якорь
 * («Позиции» / «Форма КП» / «Затраты») + по вкладке на каждую открытую позицию — все
 * закрываемые, симметрично. activeKey выводится ИЗ URL (источник истины). Рендерится
 * только на workspace-роутах (см. MainLayout).
 */
const WorkspaceTabsBar: React.FC = () => {
  const { tabs, closeTab } = useWorkspaceTabs();
  const navigate = useNavigate();
  const location = useLocation();
  const match = useMatch('/positions/:positionId/items');
  const currentPositionId = match?.params.positionId;

  // Порядок отображения (не влияет на порядок хранения): якоря — в порядке реестра,
  // затем позиции — в порядке открытия.
  const ordered = useMemo(() => {
    const pages = tabs
      .filter((t): t is Extract<WorkspaceTab, { kind: 'page' }> => t.kind === 'page')
      .sort((a, b) => WORKSPACE_PAGES.findIndex((p) => p.path === a.key) - WORKSPACE_PAGES.findIndex((p) => p.path === b.key));
    const positions = tabs.filter((t) => t.kind === 'position');
    return [...pages, ...positions];
  }, [tabs]);

  // Пока нет ни одной открытой вкладки — панель не показываем.
  if (ordered.length === 0) return null;

  const activeKey = currentPositionId ?? location.pathname;

  const items: TabsProps['items'] = ordered.map((t) => ({ key: t.key, label: t.title, closable: true }));

  const onChange = (key: string) => {
    const tab = tabs.find((t) => t.key === key);
    if (tab) navigate(tab.path);
  };

  const onEdit: TabsProps['onEdit'] = (targetKey, action) => {
    if (action !== 'remove' || typeof targetKey !== 'string') return;
    const wasActive = targetKey === activeKey;
    // Навигируем ДО закрытия: уводим URL с закрываемой вкладки прежде, чем она исчезнет из
    // tabs, чтобы не оставить промежуточный рендер «URL = закрытая вкладка, но её уже нет в
    // tabs» (на нём deep-link эффект вернул бы вкладку).
    if (wasActive) {
      const idx = ordered.findIndex((t) => t.key === targetKey);
      const remaining = ordered.filter((t) => t.key !== targetKey);
      const next = remaining[idx - 1] ?? remaining[idx] ?? null;
      navigate(next ? next.path : '/dashboard');
    }
    closeTab(targetKey);
  };

  return (
    <Tabs
      type="editable-card"
      hideAdd
      size="small"
      activeKey={activeKey}
      items={items}
      onChange={onChange}
      onEdit={onEdit}
      tabBarStyle={{ marginBottom: 8, paddingLeft: 8, paddingRight: 8 }}
    />
  );
};

export default WorkspaceTabsBar;
