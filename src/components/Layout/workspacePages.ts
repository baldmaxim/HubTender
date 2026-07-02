import type React from 'react';
import ClientPositions from '../../pages/ClientPositions/ClientPositions';
import Commerce from '../../pages/Commerce/Commerce';
import ConstructionCostNew from '../../pages/Admin/ConstructionCostNew/ConstructionCostNew';

/**
 * Страницы «рабочего стола» вкладок: держатся смонтированными одновременно (keep-alive),
 * неактивные скрыты через display:none. Порядок задаёт порядок якорей-вкладок.
 */
export interface WorkspacePage {
  /** Точный pathname роута (источник истины активной вкладки — URL). */
  path: string;
  /** Подпись вкладки-якоря. */
  title: string;
  /** Компонент страницы (внутренний стейт, не зависит от URL — безопасно скрывать). */
  component: React.ComponentType;
}

export const WORKSPACE_PAGES: WorkspacePage[] = [
  { path: '/positions', title: 'Позиции', component: ClientPositions },
  { path: '/commerce/proposal', title: 'Форма КП', component: Commerce },
  { path: '/costs', title: 'Затраты', component: ConstructionCostNew },
];

/**
 * true — если путь относится к keep-alive рабочему столу: список/элементы позиций
 * (`/positions`, `/positions/:id/items`) или одна из страниц-якорей (точное сравнение,
 * поэтому `/commerce/redistribution`, `/admin/*` и т.п. сюда НЕ попадают).
 */
export function isWorkspacePath(pathname: string): boolean {
  return pathname.startsWith('/positions/') || WORKSPACE_PAGES.some((p) => p.path === pathname);
}
