import { useEffect, useRef } from 'react';
import { useLocation, useMatch, useSearchParams } from 'react-router-dom';
import PositionItems from '../../pages/PositionItems/PositionItems';
import { useWorkspaceTabs } from '../../contexts/WorkspaceTabsContext';
import { WORKSPACE_PAGES } from './workspacePages';

/**
 * Keep-alive «рабочего стола» вкладок: страницы-якоря («Позиции», «Форма КП», «Затраты») и
 * все открытые позиции монтируются только пока присутствуют в единственном списке `tabs`
 * (WorkspaceTabsContext) — неактивные скрыты через display:none, закрытые не рендерятся
 * вовсе. Так переключение между вкладками не сбрасывает их состояние (прокрутку, фильтры,
 * выбранный тендер), а закрытие — реально размонтирует и вычищает вкладку из sessionStorage.
 *
 * Рендерится вместо <Outlet/> для workspace-роутов (см. MainLayout + isWorkspacePath), поэтому
 * route-элементы этих путей не монтируются повторно. Сама панель вкладок (WorkspaceTabsBar)
 * рендерится в шапке MainLayout (HeaderTitleOrTabs), а не здесь; здесь остаётся deep-link
 * регистрация вкладок, от которой панель в шапке зависит.
 */
const WorkspaceKeepAlive: React.FC = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { tabs, openPageTab, openPositionTab } = useWorkspaceTabs();
  const match = useMatch('/positions/:positionId/items');
  const currentPositionId = match?.params.positionId;

  // tabs читаем через ref: эффект должен реагировать ТОЛЬКО на смену URL, а не на мутации
  // списка вкладок.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Deep-link: если текущий URL (позиция или страница-якорь) ещё не представлен вкладкой —
  // регистрируем её. ВАЖНО: tabs НЕ в зависимостях (иначе при закрытии активной вкладки эффект
  // вернул бы её на промежуточном рендере — «нужно нажать × дважды»; инвариант: закрытие
  // активной вкладки сопровождается навигацией прочь, см. onEdit в WorkspaceTabsBar).
  useEffect(() => {
    if (currentPositionId) {
      if (!tabsRef.current.some((t) => t.key === currentPositionId)) {
        openPositionTab({ positionId: currentPositionId, tenderId: searchParams.get('tenderId') ?? '', title: 'Позиция' });
      }
      return;
    }
    const page = WORKSPACE_PAGES.find((p) => p.path === location.pathname);
    if (page && !tabsRef.current.some((t) => t.key === page.path)) {
      openPageTab(page.path);
    }
  }, [location.pathname, currentPositionId, searchParams, openPageTab, openPositionTab]);

  return (
    <>
      {tabs.map((tab) => {
        const isActive = tab.key === (currentPositionId ?? location.pathname);
        if (tab.kind === 'page') {
          const page = WORKSPACE_PAGES.find((p) => p.path === tab.key);
          if (!page) return null; // защита от «протухшей» sessionStorage-записи после deploy
          const Page = page.component;
          return (
            <div key={tab.key} style={{ display: isActive ? 'block' : 'none', height: '100%' }}>
              <Page />
            </div>
          );
        }
        return (
          <div key={tab.key} style={{ display: isActive ? 'block' : 'none' }}>
            <PositionItems positionId={tab.positionId} />
          </div>
        );
      })}
    </>
  );
};

export default WorkspaceKeepAlive;
