// Persist layer for the in-app "workspace" tab bar (every open page + opened positions),
// backed by sessionStorage (per-browser-tab, survives F5, not shared across real browser
// tabs). Storage is best-effort: any quota/parse error is swallowed and treated as an
// empty tab list. Only the tab list is persisted — page state itself is not restored.

import { pathnameOf, resolveWorkspacePage } from '../../components/Layout/workspacePages';

export type WorkspaceTabKind = 'page' | 'position';

interface WorkspaceTabBase {
  /** React key = navigate() target used to match the tab against the active URL.
   *  kind:'page' → pathname of the page (see resolveWorkspacePage); kind:'position' → positionId. */
  key: string;
  kind: WorkspaceTabKind;
  title: string;
  /** Canonical path for navigate(). kind:'page' → the last URL of the tab (pathname + search),
   *  so returning to the tab restores e.g. ?tenderId=…; kind:'position' → built once. */
  path: string;
}

export interface WorkspacePageTab extends WorkspaceTabBase {
  kind: 'page';
}

export interface WorkspacePositionTab extends WorkspaceTabBase {
  kind: 'position';
  positionId: string;
  tenderId: string;
}

export type WorkspaceTab = WorkspacePageTab | WorkspacePositionTab;

export function buildPositionTabPath(positionId: string, tenderId: string): string {
  return `/positions/${positionId}/items?tenderId=${tenderId}&positionId=${positionId}`;
}

// New key (not the legacy 'tenderHub_position_tabs'): the old records have no
// `kind` field and would fail validation below anyway, so reusing the key would
// only cost a one-time silent reset of this session-scoped, non-critical list.
const STORAGE_KEY = 'tenderHub_workspace_tabs';

// Предохранитель от разрастания списка (в норме вкладок единицы).
const MAX_TABS = 30;

// path уходит в navigate(): только внутренний путь приложения ('//host' — внешний).
const isInternalPath = (path: string): boolean => path.startsWith('/') && !path.startsWith('//');

function isValidTab(t: unknown): t is WorkspaceTab {
  if (!t || typeof t !== 'object') return false;
  const r = t as Record<string, unknown>;
  if (typeof r.key !== 'string' || typeof r.title !== 'string' || typeof r.path !== 'string') return false;
  if (!isInternalPath(r.path)) return false;
  if (r.kind === 'page') return resolveWorkspacePage(pathnameOf(r.path))?.key === r.key;
  if (r.kind === 'position') return typeof r.positionId === 'string' && typeof r.tenderId === 'string';
  return false;
}

export function readWorkspaceTabs(): WorkspaceTab[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const tabs: WorkspaceTab[] = [];
    for (const item of parsed) {
      if (tabs.length >= MAX_TABS) break;
      if (!isValidTab(item) || seen.has(item.key)) continue;
      seen.add(item.key);
      tabs.push(item);
    }
    return tabs;
  } catch {
    return [];
  }
}

export function writeWorkspaceTabs(tabs: WorkspaceTab[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // quota/private mode — ignore
  }
}

/** Used by clearSession() on logout — sessionStorage doesn't clear itself on sign-out. */
export function clearWorkspaceTabs(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
