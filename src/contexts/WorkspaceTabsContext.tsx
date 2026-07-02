import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { WORKSPACE_PAGES } from '../components/Layout/workspacePages';
import {
  type WorkspaceTab,
  buildPositionTabPath,
  readWorkspaceTabs,
  writeWorkspaceTabs,
} from '../lib/cache/workspaceTabsStorage';

export type { WorkspaceTab, WorkspacePageTab, WorkspacePositionTab } from '../lib/cache/workspaceTabsStorage';

/** Стабильные действия над вкладками (без меняющегося списка tabs). */
export interface WorkspaceTabsActions {
  /** Открыть/сфокусировать вкладку-якорь по её path из WORKSPACE_PAGES. Дедуп по path,
   *  title всегда берётся из реестра. No-op на неизвестном path. */
  openPageTab: (path: string) => void;
  /**
   * Открыть/сфокусировать вкладку позиции (дедуп по positionId). Провайдер НЕ навигирует —
   * навигация остаётся на call-site/панели вкладок (URL = источник истины для активной вкладки).
   * opts.background сейчас информативен (фоновая вкладка = caller просто не навигирует).
   */
  openPositionTab: (
    data: { positionId: string; tenderId: string; title?: string },
    opts?: { background?: boolean },
  ) => void;
  /** Закрыть любую вкладку (страницу-якорь или позицию) по key — реально убирает из списка. */
  closeTab: (key: string) => void;
  /** Обновить заголовок вкладки; no-op, если вкладки нет. */
  setTabTitle: (key: string, title: string) => void;
}

interface WorkspaceTabsContextType extends WorkspaceTabsActions {
  tabs: WorkspaceTab[];
}

// Состояние (tabs — меняется на open/close) и действия (стабильны) разнесены на
// два контекста: консьюмеры только действий (заголовок вкладки в PositionItems,
// открытие из списка) не перерендериваются при изменении списка вкладок.
const WorkspaceTabsStateContext = createContext<WorkspaceTab[] | undefined>(undefined);
const WorkspaceTabsActionsContext = createContext<WorkspaceTabsActions | undefined>(undefined);

interface WorkspaceTabsProviderProps {
  children: ReactNode;
}

export const WorkspaceTabsProvider: React.FC<WorkspaceTabsProviderProps> = ({ children }) => {
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => readWorkspaceTabs());

  // Персист в sessionStorage (изоляция по окну): при перезагрузке URL позиции
  // остальные открытые вкладки не пропадают.
  useEffect(() => {
    writeWorkspaceTabs(tabs);
  }, [tabs]);

  const openPageTab = useCallback((path: string) => {
    const page = WORKSPACE_PAGES.find((p) => p.path === path);
    if (!page) return;
    setTabs((prev) => {
      if (prev.some((t) => t.key === path)) return prev;
      return [...prev, { key: path, kind: 'page', title: page.title, path: page.path }];
    });
  }, []);

  // opts (background) не влияет на стейт — навигацию решает caller; параметр опускаем.
  const openPositionTab = useCallback(
    (data: { positionId: string; tenderId: string; title?: string }) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.key === data.positionId);
        const path = buildPositionTabPath(data.positionId, data.tenderId);
        if (idx === -1) {
          return [
            ...prev,
            {
              key: data.positionId,
              kind: 'position',
              title: data.title || 'Позиция',
              path,
              positionId: data.positionId,
              tenderId: data.tenderId,
            },
          ];
        }
        // Уже открыта — обновляем tenderId/title/path на месте, без дубля.
        const next = [...prev];
        const existing = next[idx];
        if (existing.kind === 'position') {
          next[idx] = {
            ...existing,
            tenderId: data.tenderId || existing.tenderId,
            title: data.title || existing.title,
            path: data.tenderId ? path : existing.path,
          };
        }
        return next;
      });
    },
    [],
  );

  const closeTab = useCallback((key: string) => {
    setTabs((prev) => prev.filter((t) => t.key !== key));
  }, []);

  const setTabTitle = useCallback((key: string, title: string) => {
    if (!title) return;
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.key === key);
      if (idx === -1 || prev[idx].title === title) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], title };
      return next;
    });
  }, []);

  const actions = useMemo<WorkspaceTabsActions>(
    () => ({ openPageTab, openPositionTab, closeTab, setTabTitle }),
    [openPageTab, openPositionTab, closeTab, setTabTitle],
  );

  return (
    <WorkspaceTabsActionsContext.Provider value={actions}>
      <WorkspaceTabsStateContext.Provider value={tabs}>
        {children}
      </WorkspaceTabsStateContext.Provider>
    </WorkspaceTabsActionsContext.Provider>
  );
};

/** Только стабильные действия — не перерендеривается при изменении списка вкладок. */
// eslint-disable-next-line react-refresh/only-export-components
export const useWorkspaceTabActions = (): WorkspaceTabsActions => {
  const actions = useContext(WorkspaceTabsActionsContext);
  if (actions === undefined) {
    throw new Error('useWorkspaceTabActions must be used within a WorkspaceTabsProvider');
  }
  return actions;
};

/** Список вкладок + действия. Перерендеривается при изменении tabs. */
// eslint-disable-next-line react-refresh/only-export-components
export const useWorkspaceTabs = (): WorkspaceTabsContextType => {
  const tabs = useContext(WorkspaceTabsStateContext);
  const actions = useContext(WorkspaceTabsActionsContext);
  if (tabs === undefined || actions === undefined) {
    throw new Error('useWorkspaceTabs must be used within a WorkspaceTabsProvider');
  }
  return { tabs, ...actions };
};
