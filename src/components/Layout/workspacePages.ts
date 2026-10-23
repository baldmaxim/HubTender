import { lazy } from 'react';
import type React from 'react';
import { matchPath } from 'react-router-dom';
import ClientPositions from '../../pages/ClientPositions/ClientPositions';
import Commerce from '../../pages/Commerce/Commerce';
import ConstructionCostNew from '../../pages/Admin/ConstructionCostNew/ConstructionCostNew';
import { PAGE_LABELS } from '../../lib/types/types';

/**
 * Реестр страниц приложения. Каждая открытая страница — вкладка «рабочего стола»: держится
 * смонтированной (keep-alive), неактивные скрыты через display:none, закрытая размонтируется.
 * Порядок вкладок — порядок открытия (реестр его не задаёт). Роуты в App.tsx строятся отсюда.
 */
export interface WorkspacePage {
  /** Паттерн роута: '/tenders' или '/projects/:projectId'. У статических совпадает с key вкладки. */
  pattern: string;
  /** Подпись вкладки по умолчанию (PAGE_LABELS[pattern] — как название страницы в шапке). */
  title: string;
  /** Компонент страницы. Читает router-хуки как обычно: у скрытой вкладки TabHost замораживает их контекст. */
  component: React.ComponentType;
  /**
   * Query-параметр, определяющий, «о чём» страница (tenderId). Страница читает его один раз при
   * монтировании, поэтому ссылка с другим значением на уже открытую вкладку пересоздаёт её.
   */
  identityParam?: string;
}

const page = (pattern: string, component: React.ComponentType, identityParam?: string): WorkspacePage => ({
  pattern,
  title: PAGE_LABELS[pattern],
  component,
  identityParam,
});

// Якоря (ClientPositions / Commerce / ConstructionCostNew) импортируются статически: их уже
// тянет MainLayout, dynamic import не вынес бы их из основного бандла. Остальные страницы —
// lazy-чанки: чанк догружается при первом открытии вкладки.
export const WORKSPACE_PAGES: WorkspacePage[] = [
  page('/dashboard', lazy(() => import('../../pages/Dashboard/Dashboard'))),
  page('/tenders', lazy(() => import('../../pages/Tenders/Tenders'))),
  page('/tender-timeline', lazy(() => import('../../pages/TenderTimeline'))),
  page('/tasks', lazy(() => import('../../pages/Tasks'))),
  page('/positions', ClientPositions, 'tenderId'),
  page('/commerce/proposal', Commerce),
  page('/commerce/redistribution', lazy(() => import('../../pages/CostRedistribution'))),
  page('/library', lazy(() => import('../../pages/Library'))),
  page('/library/templates', lazy(() => import('../../pages/Library/Templates'))),
  page('/bsm', lazy(() => import('../../pages/Bsm/Bsm'))),
  page('/costs', ConstructionCostNew),
  page('/financial-indicators', lazy(() => import('../../pages/FinancialIndicators/FinancialIndicators'))),
  page('/data-quality', lazy(() => import('../../pages/DataQuality/DataQuality'))),
  page('/analytics/comparison', lazy(() => import('../../pages/Analytics/ObjectComparison'))),
  page('/analytics/quality', lazy(() => import('../../pages/TenderQuality/TenderQuality')), 'tenderId'),
  page('/analytics/price-benchmark', lazy(() => import('../../pages/PriceBenchmark/PriceBenchmark')), 'tenderId'),
  page('/analytics/price-sources', lazy(() => import('../../pages/PriceSourceQuality/PriceSourceQuality')), 'tenderId'),
  page('/analytics/action-plan', lazy(() => import('../../pages/ActionPlan/ActionPlan')), 'tenderId'),
  page('/analytics/change-impact', lazy(() => import('../../pages/ChangeImpact/ChangeImpact')), 'tenderId'),
  page('/analytics/review-pack', lazy(() => import('../../pages/ReviewPack/ReviewPack')), 'tenderId'),
  page('/projects', lazy(() => import('../../pages/Projects'))),
  page('/projects/:projectId', lazy(() => import('../../pages/Projects/ProjectDetail'))),
  page('/objects', lazy(() => import('../../pages/Objects'))),
  page('/admin/nomenclatures', lazy(() => import('../../pages/Admin/Nomenclatures/Nomenclatures'))),
  page('/admin/construction_cost', lazy(() => import('../../pages/Admin/ConstructionCost/ConstructionCost'))),
  page('/admin/tenders', lazy(() => import('../../pages/Admin/Tenders/Tenders'))),
  page('/admin/markup_constructor', lazy(() => import('../../pages/Admin/MarkupConstructor/MarkupConstructor'))),
  page('/admin/markup', lazy(() => import('../../pages/Admin/MarkupPercentages/MarkupPercentages'))),
  page('/admin/import-log', lazy(() => import('../../pages/Admin/ImportLog/ImportLog'))),
  page('/admin/insurance', lazy(() => import('../../pages/Admin/Insurance/Insurance'))),
  page('/admin/ai-settings', lazy(() => import('../../pages/AdminAiSettings/AdminAiSettings'))),
  page('/admin/api-access', lazy(() => import('../../pages/AdminApiAccess/AdminApiAccess'))),
  page('/users', lazy(() => import('../../pages/Users/Users'))),
  page('/settings/agents', lazy(() => import('../../pages/AgentConnections/AgentConnections'))),
];

/** Вкладка позиции (не страница реестра): key = positionId. */
const POSITION_ITEMS_PATTERN = '/positions/:positionId/items';

export interface ResolvedPage {
  page: WorkspacePage;
  /** key вкладки: паттерн статической страницы либо реальный pathname параметризованной. */
  key: string;
}

// matchPath компилирует паттерн в RegExp на каждый вызов, а резолвят на каждую навигацию в
// нескольких компонентах — кэшируем по pathname (набор путей ограничен, но id объектов растут).
const RESOLVE_CACHE_LIMIT = 200;
const resolveCache = new Map<string, ResolvedPage | null>();

/** Страница реестра по pathname (точное совпадение паттерна) либо null — редиректы и неизвестные пути. */
export function resolveWorkspacePage(pathname: string): ResolvedPage | null {
  const cached = resolveCache.get(pathname);
  if (cached !== undefined) return cached;
  let resolved: ResolvedPage | null = null;
  for (const candidate of WORKSPACE_PAGES) {
    const match = matchPath({ path: candidate.pattern, end: true }, pathname);
    if (match) {
      resolved = {
        page: candidate,
        key: candidate.pattern.includes(':') ? match.pathnameBase : candidate.pattern,
      };
      break;
    }
  }
  if (resolveCache.size >= RESOLVE_CACHE_LIMIT) resolveCache.clear();
  resolveCache.set(pathname, resolved);
  return resolved;
}

/**
 * key вкладки, которой принадлежит URL: positionId для `/positions/:id/items`, key страницы
 * реестра, иначе null (редирект-роуты и неизвестные пути вкладки не имеют).
 */
export function resolveTabKey(pathname: string): string | null {
  const positionId = matchPath(POSITION_ITEMS_PATTERN, pathname)?.params.positionId;
  if (positionId) return positionId;
  return resolveWorkspacePage(pathname)?.key ?? null;
}

/** true — путь принадлежит keep-alive рабочему столу (страница реестра или элементы позиции). */
export function isWorkspacePath(pathname: string): boolean {
  return resolveTabKey(pathname) !== null;
}

/** pathname из URL вида '/path?query#hash'. */
export function pathnameOf(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}
