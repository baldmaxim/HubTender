import type React from 'react';
import ClientPositions from '../../pages/ClientPositions/ClientPositions';
import Commerce from '../../pages/Commerce/Commerce';
import ConstructionCostNew from '../../pages/Admin/ConstructionCostNew/ConstructionCostNew';
import { PAGE_LABELS } from '../../lib/types/types';

/**
 * Страницы «рабочего стола» вкладок: держатся смонтированными одновременно (keep-alive),
 * неактивные скрыты через display:none. Порядок задаёт порядок якорей-вкладок.
 */
export interface WorkspacePage {
  /** Точный pathname роута (источник истины активной вкладки — URL). */
  path: string;
  /** Подпись вкладки-якоря (всегда = PAGE_LABELS[path] — как название страницы в шапке). */
  title: string;
  /** Компонент страницы (внутренний стейт, не зависит от URL — безопасно скрывать). */
  component: React.ComponentType;
}

export const WORKSPACE_PAGES: WorkspacePage[] = [
  { path: '/positions', title: PAGE_LABELS['/positions'], component: ClientPositions },
  { path: '/commerce/proposal', title: PAGE_LABELS['/commerce/proposal'], component: Commerce },
  { path: '/costs', title: PAGE_LABELS['/costs'], component: ConstructionCostNew },
];

/**
 * true — если путь относится к keep-alive рабочему столу: список/элементы позиций
 * (`/positions`, `/positions/:id/items`) или одна из страниц-якорей (точное сравнение,
 * поэтому `/commerce/redistribution`, `/admin/*` и т.п. сюда НЕ попадают).
 */
export function isWorkspacePath(pathname: string): boolean {
  return pathname.startsWith('/positions/') || WORKSPACE_PAGES.some((p) => p.path === pathname);
}
