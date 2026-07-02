import React from 'react';
import { Tabs } from 'antd';
import type { TabsProps } from 'antd';
import { useNavigate, useMatch, useLocation } from 'react-router-dom';
import { usePositionTabs, type PositionTab } from '../../contexts/PositionTabsContext';
import type { WorkspacePage } from './workspacePages';

const itemsUrl = (t: Pick<PositionTab, 'positionId' | 'tenderId'>) =>
  `/positions/${t.positionId}/items?tenderId=${t.tenderId}&positionId=${t.positionId}`;

interface WorkspaceTabsBarProps {
  /** Открытые страницы-якоря (несъёмные вкладки) в порядке реестра. */
  openedPages: WorkspacePage[];
}

/**
 * Панель вкладок «рабочего стола»: несъёмные якоря страниц («Позиции» / «Форма КП» / «Затраты»)
 * + по закрываемой вкладке на каждую открытую позицию. activeKey выводится ИЗ URL (источник
 * истины). Рендерится только на workspace-роутах (см. MainLayout).
 */
const WorkspaceTabsBar: React.FC<WorkspaceTabsBarProps> = ({ openedPages }) => {
  const { tabs, closeTab } = usePositionTabs();
  const navigate = useNavigate();
  const location = useLocation();
  const match = useMatch('/positions/:positionId/items');
  const currentPositionId = match?.params.positionId;

  // Пока нет открытых позиций — панель не показываем (на одиночной странице нет лишней вкладки).
  if (tabs.length === 0) return null;

  const activePagePath = openedPages.find((p) => p.path === location.pathname)?.path;
  const activeKey =
    currentPositionId && tabs.some((t) => t.positionId === currentPositionId)
      ? currentPositionId
      : activePagePath ?? openedPages[0]?.path ?? '';

  const items: TabsProps['items'] = [
    ...openedPages.map((p) => ({ key: p.path, label: p.title, closable: false })),
    ...tabs.map((t) => ({ key: t.positionId, label: t.title || 'Позиция', closable: true })),
  ];

  const onChange = (key: string) => {
    const page = openedPages.find((p) => p.path === key);
    if (page) {
      navigate(page.path);
      return;
    }
    const tab = tabs.find((t) => t.positionId === key);
    if (tab) navigate(itemsUrl(tab));
  };

  const onEdit: TabsProps['onEdit'] = (targetKey, action) => {
    // Закрываются только позиции (страницы-якоря closable:false).
    if (action !== 'remove' || typeof targetKey !== 'string') return;
    const wasActive = targetKey === activeKey;
    // Навигируем ДО закрытия: уводим URL с закрываемой позиции прежде, чем она исчезнет из tabs,
    // чтобы не оставить промежуточный рендер «URL = закрытая позиция, но её уже нет в tabs» (на
    // нём deep-link эффект вернул бы вкладку).
    if (wasActive) {
      const idx = tabs.findIndex((t) => t.positionId === targetKey);
      const remaining = tabs.filter((t) => t.positionId !== targetKey);
      const nextPos = remaining[idx - 1] ?? remaining[idx] ?? null;
      const fallbackPage = openedPages[openedPages.length - 1]?.path ?? '/positions';
      navigate(nextPos ? itemsUrl(nextPos) : fallbackPage);
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
