import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';

/** Открытая вкладка «Элементы позиции заказчика». positionId — ключ вкладки. */
export interface PositionTab {
  positionId: string;
  tenderId: string;
  title: string;
}

/** Стабильные действия над вкладками (без меняющегося списка tabs). */
export interface PositionTabsActions {
  /**
   * Добавить вкладку (дедуп по positionId). Провайдер НЕ навигирует — навигация
   * остаётся на call-site/панели вкладок (URL = источник истины для активной вкладки).
   * opts.background сейчас информативен (фоновая вкладка = caller просто не навигирует).
   */
  openTab: (tab: PositionTab, opts?: { background?: boolean }) => void;
  closeTab: (positionId: string) => void;
  /** Обновить заголовок вкладки; no-op, если вкладки нет. */
  setTabTitle: (positionId: string, title: string) => void;
}

interface PositionTabsContextType extends PositionTabsActions {
  tabs: PositionTab[];
}

// Состояние (tabs — меняется на open/close) и действия (стабильны) разнесены на
// два контекста: консьюмеры только действий (заголовок вкладки в PositionItems,
// открытие из списка) не перерендериваются при изменении списка вкладок.
const PositionTabsStateContext = createContext<PositionTab[] | undefined>(undefined);
const PositionTabsActionsContext = createContext<PositionTabsActions | undefined>(undefined);

const STORAGE_KEY = 'tenderHub_position_tabs';

function readStored(): PositionTab[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is PositionTab =>
        t && typeof t.positionId === 'string' && typeof t.tenderId === 'string' && typeof t.title === 'string',
    );
  } catch {
    return [];
  }
}

interface PositionTabsProviderProps {
  children: ReactNode;
}

export const PositionTabsProvider: React.FC<PositionTabsProviderProps> = ({ children }) => {
  const [tabs, setTabs] = useState<PositionTab[]>(() => readStored());

  // Персист в sessionStorage (изоляция по окну): при перезагрузке URL позиции
  // остальные открытые вкладки не пропадают.
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
    } catch {
      /* quota/private mode — игнорируем */
    }
  }, [tabs]);

  // opts (background) не влияет на стейт — навигацию решает caller; параметр опускаем.
  const openTab = useCallback((tab: PositionTab) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.positionId === tab.positionId);
      if (idx === -1) return [...prev, tab];
      // Уже открыта — обновляем tenderId/title на месте, без дубля.
      const next = [...prev];
      next[idx] = { ...next[idx], tenderId: tab.tenderId || next[idx].tenderId, title: tab.title || next[idx].title };
      return next;
    });
  }, []);

  const closeTab = useCallback((positionId: string) => {
    setTabs((prev) => prev.filter((t) => t.positionId !== positionId));
  }, []);

  const setTabTitle = useCallback((positionId: string, title: string) => {
    if (!title) return;
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.positionId === positionId);
      if (idx === -1 || prev[idx].title === title) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], title };
      return next;
    });
  }, []);

  const actions = useMemo<PositionTabsActions>(
    () => ({ openTab, closeTab, setTabTitle }),
    [openTab, closeTab, setTabTitle],
  );

  return (
    <PositionTabsActionsContext.Provider value={actions}>
      <PositionTabsStateContext.Provider value={tabs}>
        {children}
      </PositionTabsStateContext.Provider>
    </PositionTabsActionsContext.Provider>
  );
};

/** Только стабильные действия — не перерендеривается при изменении списка вкладок. */
// eslint-disable-next-line react-refresh/only-export-components
export const usePositionTabActions = (): PositionTabsActions => {
  const actions = useContext(PositionTabsActionsContext);
  if (actions === undefined) {
    throw new Error('usePositionTabActions must be used within a PositionTabsProvider');
  }
  return actions;
};

/** Список вкладок + действия. Перерендеривается при изменении tabs. */
// eslint-disable-next-line react-refresh/only-export-components
export const usePositionTabs = (): PositionTabsContextType => {
  const tabs = useContext(PositionTabsStateContext);
  const actions = useContext(PositionTabsActionsContext);
  if (tabs === undefined || actions === undefined) {
    throw new Error('usePositionTabs must be used within a PositionTabsProvider');
  }
  return { tabs, ...actions };
};
