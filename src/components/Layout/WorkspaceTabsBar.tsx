import React, { useMemo } from 'react';
import { ConfigProvider, Tabs, theme } from 'antd';
import type { TabsProps } from 'antd';
import { useNavigate, useMatch, useLocation } from 'react-router-dom';
import { useWorkspaceTabs, type WorkspaceTab } from '../../contexts/WorkspaceTabsContext';
import { WORKSPACE_PAGES } from './workspacePages';
import { PAGE_LABELS } from '../../lib/types/types';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Панель вкладок «рабочего стола»: по вкладке на каждую открытую страницу-якорь
 * + по вкладке на каждую открытую позицию — все закрываемые, симметрично.
 * activeKey выводится ИЗ URL (источник истины). Рендерится в ШАПКЕ MainLayout
 * (через HeaderTitleOrTabs) на workspace-роутах — вместо названия страницы.
 * Подписи page-вкладок берутся из PAGE_LABELS в рендере (а не из хранимого title),
 * поэтому протухшие записи sessionStorage не влияют на отображение.
 */
const WorkspaceTabsBar: React.FC = () => {
  const { tabs, closeTab } = useWorkspaceTabs();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme: currentTheme } = useTheme();
  const { token } = theme.useToken();
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

  const items: TabsProps['items'] = ordered.map((t) => ({
    key: t.key,
    label: t.kind === 'page' ? (PAGE_LABELS[t.key] ?? t.title) : t.title,
    closable: true,
  }));

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
    <div className={`header-workspace-tabs header-workspace-tabs-${currentTheme}`}>
      <ConfigProvider
        theme={{
          components: {
            Tabs: {
              // Текст вкладок — цвет заголовка страницы (белый в dark), а не зелёный colorPrimary.
              itemSelectedColor: token.colorText,
              itemHoverColor: token.colorText,
              itemActiveColor: token.colorText,
              itemColor: token.colorTextSecondary,
              cardBg: 'transparent',
              // НЕ переопределять здесь colorBgContainer: токен утекает в «…»-дропдаун
              // скрытых вкладок (портал в body получает hashId nested-темы) и делает его
              // прозрачным. Подложка активной вкладки — в MainLayout.css.
              horizontalMargin: '0',
              titleFontSizeSM: 16,
              cardGutter: 4,
            },
          },
        }}
      >
        <Tabs
          type="editable-card"
          hideAdd
          size="small"
          activeKey={activeKey}
          items={items}
          onChange={onChange}
          onEdit={onEdit}
        />
      </ConfigProvider>
    </div>
  );
};

export default WorkspaceTabsBar;
