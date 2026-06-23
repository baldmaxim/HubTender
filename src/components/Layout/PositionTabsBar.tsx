import React from 'react';
import { Tabs } from 'antd';
import type { TabsProps } from 'antd';
import { useNavigate, useMatch } from 'react-router-dom';
import { usePositionTabs, type PositionTab } from '../../contexts/PositionTabsContext';

const ANCHOR_KEY = '__positions__';

const itemsUrl = (t: Pick<PositionTab, 'positionId' | 'tenderId'>) =>
  `/positions/${t.positionId}/items?tenderId=${t.tenderId}&positionId=${t.positionId}`;

/**
 * Панель вкладок над контентом: несакрываемая «Позиции» (список) + по вкладке
 * на каждую открытую позицию. activeKey выводится ИЗ URL (источник истины),
 * а не из стейта. Рендерится только на роутах /positions* (см. MainLayout).
 */
const PositionTabsBar: React.FC = () => {
  const { tabs, closeTab } = usePositionTabs();
  const navigate = useNavigate();
  const match = useMatch('/positions/:positionId/items');
  const currentPositionId = match?.params.positionId;

  // Пока нет открытых позиций — панель не показываем (на списке нет лишней вкладки).
  if (tabs.length === 0) return null;

  const activeKey =
    currentPositionId && tabs.some((t) => t.positionId === currentPositionId) ? currentPositionId : ANCHOR_KEY;

  const items: TabsProps['items'] = [
    { key: ANCHOR_KEY, label: 'Позиции', closable: false },
    ...tabs.map((t) => ({ key: t.positionId, label: t.title || 'Позиция', closable: true })),
  ];

  const onChange = (key: string) => {
    if (key === ANCHOR_KEY) {
      navigate('/positions');
      return;
    }
    const tab = tabs.find((t) => t.positionId === key);
    if (tab) navigate(itemsUrl(tab));
  };

  const onEdit: TabsProps['onEdit'] = (targetKey, action) => {
    if (action !== 'remove' || typeof targetKey !== 'string') return;
    const wasActive = targetKey === activeKey;
    // Навигируем ДО закрытия: уводим URL с закрываемой позиции прежде, чем она
    // исчезнет из tabs, чтобы не оставить промежуточный рендер «URL = закрытая
    // позиция, но её уже нет в tabs» (на нём эффект deep-link возвращал бы вкладку).
    if (wasActive) {
      const idx = tabs.findIndex((t) => t.positionId === targetKey);
      const remaining = tabs.filter((t) => t.positionId !== targetKey);
      const next = remaining[idx - 1] ?? remaining[idx] ?? null;
      navigate(next ? itemsUrl(next) : '/positions');
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

export default PositionTabsBar;
