import { createContext, useContext } from 'react';

/**
 * Активна ли вкладка рабочего стола, в которой отрисован компонент (см. TabHost).
 * Вне хоста вкладки (шапка, меню, публичные страницы) — всегда true.
 */
export const TabActiveContext = createContext(true);

/** key вкладки в WorkspaceTabsContext; вне хоста вкладки — null. */
export const TabKeyContext = createContext<string | null>(null);

export const useIsTabActive = (): boolean => useContext(TabActiveContext);

export const useTabKey = (): string | null => useContext(TabKeyContext);
