import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useMatch, useSearchParams } from 'react-router-dom';
import WorkspaceTabsBar from './WorkspaceTabsBar';
import PositionItems from '../../pages/PositionItems/PositionItems';
import { usePositionTabs } from '../../contexts/PositionTabsContext';
import { WORKSPACE_PAGES } from './workspacePages';

/**
 * Keep-alive «рабочего стола» вкладок: страницы-якоря («Позиции», «Форма КП», «Затраты») и
 * все открытые позиции смонтированы одновременно, неактивные скрыты через display:none. Так
 * переключение между вкладками не сбрасывает их состояние (прокрутку, фильтры, выбранный тендер).
 *
 * Рендерится вместо <Outlet/> для workspace-роутов (см. MainLayout + isWorkspacePath), поэтому
 * route-элементы этих путей не монтируются повторно.
 */
const WorkspaceKeepAlive: React.FC = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { tabs, openTab } = usePositionTabs();
  const match = useMatch('/positions/:positionId/items');
  const currentPositionId = match?.params.positionId;
  const currentPagePath = WORKSPACE_PAGES.find((p) => p.path === location.pathname)?.path;

  // Открытые (смонтированные) страницы-якоря. Ленивое монтирование: страница попадает сюда,
  // только став активной, затем остаётся (скрыта через display). Поэтому переход из «Формы КП»/
  // «Затрат» не монтирует список «Позиции» и не тянет его авто-загрузку по ?tenderId=.
  const [openedPages, setOpenedPages] = useState<Set<string>>(() =>
    currentPagePath ? new Set([currentPagePath]) : new Set(),
  );
  useEffect(() => {
    if (!currentPagePath) return;
    setOpenedPages((prev) => (prev.has(currentPagePath) ? prev : new Set(prev).add(currentPagePath)));
  }, [currentPagePath]);

  const openedPageList = useMemo(
    () => WORKSPACE_PAGES.filter((p) => openedPages.has(p.path)),
    [openedPages],
  );

  // tabs читаем через ref: эффект должен реагировать ТОЛЬКО на смену URL, а не на мутации
  // списка вкладок.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Deep-link: если открыта позиция, которой ещё нет в tabs — регистрируем её. ВАЖНО: tabs НЕ в
  // зависимостях (иначе при закрытии активной вкладки эффект вернул бы её на промежуточном
  // рендере — «нужно нажать × дважды»; инвариант: закрытие активной вкладки сопровождается
  // навигацией прочь, см. onEdit в WorkspaceTabsBar).
  useEffect(() => {
    if (currentPositionId && !tabsRef.current.some((t) => t.positionId === currentPositionId)) {
      openTab({ positionId: currentPositionId, tenderId: searchParams.get('tenderId') ?? '', title: 'Позиция' });
    }
  }, [currentPositionId, searchParams, openTab]);

  return (
    <>
      <WorkspaceTabsBar openedPages={openedPageList} />
      {openedPageList.map((page) => {
        const Page = page.component;
        return (
          <div key={page.path} style={{ display: location.pathname === page.path ? 'block' : 'none', height: '100%' }}>
            <Page />
          </div>
        );
      })}
      {tabs.map((t) => (
        <div key={t.positionId} style={{ display: currentPositionId === t.positionId ? 'block' : 'none' }}>
          <PositionItems positionId={t.positionId} />
        </div>
      ))}
    </>
  );
};

export default WorkspaceKeepAlive;
