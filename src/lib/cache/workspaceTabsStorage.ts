// Persist layer for the in-app "workspace" tab bar (Позиции / Форма КП / Затраты /
// Элементы позиции), backed by sessionStorage (per-browser-tab, survives F5, not
// shared across real browser tabs). Storage is best-effort: any quota/parse error
// is swallowed and treated as an empty tab list.

import { WORKSPACE_PAGES } from '../../components/Layout/workspacePages';

export type WorkspaceTabKind = 'page' | 'position';

interface WorkspaceTabBase {
  /** React key = navigate() target used to match the tab against the active URL.
   *  kind:'page' → path from WORKSPACE_PAGES; kind:'position' → positionId. */
  key: string;
  kind: WorkspaceTabKind;
  title: string;
  /** Canonical path for navigate() — the single place a tab's URL is built. */
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

function isValidTab(t: unknown): t is WorkspaceTab {
  if (!t || typeof t !== 'object') return false;
  const r = t as Record<string, unknown>;
  if (typeof r.key !== 'string' || typeof r.title !== 'string' || typeof r.path !== 'string') return false;
  if (r.kind === 'page') return WORKSPACE_PAGES.some((p) => p.path === r.key);
  if (r.kind === 'position') return typeof r.positionId === 'string' && typeof r.tenderId === 'string';
  return false;
}

export function readWorkspaceTabs(): WorkspaceTab[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTab);
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
