import { matchPath } from 'react-router-dom';
import { POSITION_ITEMS_PATTERN, resolveWorkspacePage } from './workspacePages';

/** Пути-редиректы без собственной страницы: просмотром не считаются. */
const REDIRECT_ONLY_PATHS = new Set(['/', '/pricing-drafts', '/commerce', '/admin', '/settings']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^\d+$/;

const MAX_KEY_LENGTH = 200;

/**
 * Ключ страницы для учёта просмотров: путь-шаблон из реестра ('/projects/:projectId'),
 * для вкладки позиции — её шаблон, для прочих путей — pathname с uuid/числами → ':id'.
 * null — путь не считается просмотром (редирект без страницы).
 */
export const getPageViewKey = (pathname: string): string | null => {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (REDIRECT_ONLY_PATHS.has(path)) return null;

  const resolved = resolveWorkspacePage(path);
  if (resolved) return resolved.page.pattern;
  if (matchPath(POSITION_ITEMS_PATTERN, path)) return POSITION_ITEMS_PATTERN;

  const normalized = path
    .split('/')
    .map((segment) => (UUID_RE.test(segment) || NUMERIC_RE.test(segment) ? ':id' : segment))
    .join('/');
  return normalized.length <= MAX_KEY_LENGTH ? normalized : null;
};
