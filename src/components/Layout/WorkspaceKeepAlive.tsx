import { Suspense, memo, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Spin } from 'antd';
import { useLocation, useMatch } from 'react-router-dom';
import PositionItems from '../../pages/PositionItems/PositionItems';
import ErrorFallback from '../ErrorFallback';
import { Sentry } from '../../lib/sentry';
import { useWorkspaceTabs, type WorkspaceTab } from '../../contexts/WorkspaceTabsContext';
import { TabHost } from './TabHost';
import { useTabScrollMemory } from './useTabScrollMemory';
import { resolveTabKey, resolveWorkspacePage } from './workspacePages';

/** Memo-граница страниц. Keep-alive перерендеривается на каждую навигацию (useLocation) и
 *  пересоздаёт элементы вкладок — без границы все смонтированные страницы рендерились бы
 *  заново на каждое переключение/открытие вкладки. `component` — стабильная ссылка из
 *  WORKSPACE_PAGES, поэтому memo держится всегда; от перерисовок по router-контексту
 *  (страница сама подписана на useSearchParams/useNavigate) защищает заморозка в TabHost. */
const PageHost = memo(({ component: Page }: { component: React.ComponentType }) => <Page />);

const TabSpinner: React.FC = () => (
  <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
    <Spin size="large" />
  </div>
);

interface TabSlotProps {
  tab: WorkspaceTab;
  active: boolean;
  /** ?itemId=… — только активной вкладке позиции: подсветка ищет строку через
   *  document.querySelector (глобально), скрытые вкладки перехватывали бы deep-link на себя. */
  deepLinkItemId: string | null;
}

/** Слот одной вкладки: скрывается display:none, свои Suspense (первое открытие lazy-чанка) и
 *  ErrorBoundary (сбой одной страницы не должен ронять остальные вкладки). */
const TabSlot = memo(({ tab, active, deepLinkItemId }: TabSlotProps) => {
  let content: ReactNode;
  if (tab.kind === 'page') {
    const page = resolveWorkspacePage(tab.key)?.page;
    if (!page) return null; // защита от «протухшей» sessionStorage-записи после deploy
    content = <PageHost component={page.component} />;
  } else {
    content = <PositionItems positionId={tab.positionId} deepLinkItemId={deepLinkItemId} />;
  }
  return (
    <div style={{ display: active ? 'block' : 'none', height: tab.kind === 'page' ? '100%' : undefined }}>
      <TabHost tabKey={tab.key} active={active}>
        <Sentry.ErrorBoundary fallback={(props) => <ErrorFallback {...props} compact />}>
          <Suspense fallback={<TabSpinner />}>{content}</Suspense>
        </Sentry.ErrorBoundary>
      </TabHost>
    </div>
  );
});

interface Instance {
  /** Уникальный номер экземпляра страницы (растёт при каждом создании/пересоздании) — часть React
   *  key слота и ключ прокрутки: закрытая и снова открытая вкладка не наследует чужую прокрутку. */
  rev: number;
  /** Последнее известное значение identityParam страницы (tenderId), '' — не задано. */
  identity: string;
}

interface KeepAliveState {
  tabs: WorkspaceTab[];
  locKey: string;
  activeKey: string | null;
  /** Вкладки, восстановленные из sessionStorage и ещё не показанные: монтируются лениво. */
  pending: ReadonlySet<string>;
  /** Смонтированные вкладки (key → экземпляр). */
  instances: Record<string, Instance>;
  /** Следующий номер экземпляра (счётчик в state, а не в модуле: derive чистая). */
  nextRev: number;
}

interface DeriveInput {
  tabs: WorkspaceTab[];
  locKey: string;
  activeKey: string | null;
  /** Значение identityParam активной страницы из URL ('' — параметра нет). */
  identity: string;
}

/**
 * Какие вкладки смонтированы и когда пересоздавать страницу. Чистая функция: вызывается во время
 * рендера (паттерн «adjust state during render»), поэтому устаревший экземпляр страницы вообще
 * не рендерится с чужим URL — эффект «после» успел бы откатить адрес обратно через
 * setSearchParams самой страницы.
 *  - закрытые вкладки уходят; активная, а также созданные в сессии (в т.ч. фоновая вкладка
 *    позиции) монтируются сразу; восстановленные из sessionStorage ждут первого показа;
 *  - приход из ДРУГОЙ вкладки по ссылке с другим identity (tenderId): страница читает его один
 *    раз при монтировании, поэтому пересоздаём (новый rev). Пустой identity (клик по вкладке/меню,
 *    редирект), тот же identity и вкладки позиций — просто показ;
 *  - внутри вкладки (навигация без смены вкладки) identity обновляется, только если страница сама
 *    сменила тендер — непустой другой параметр. Пустой не затирает: «страница сбросила тендер» от
 *    «вернулись по вкладке без query» не отличить. Смена одного лишь списка вкладок (upsert URL
 *    сразу после прихода) identity не трогает.
 */
const deriveInstances = (prev: KeepAliveState, { tabs, locKey, activeKey, identity }: DeriveInput): KeepAliveState => {
  const instances: Record<string, Instance> = {};
  const pending = new Set<string>();
  let nextRev = prev.nextRev;
  for (const tab of tabs) {
    const existing = prev.instances[tab.key];
    if (existing) {
      instances[tab.key] = existing;
    } else if (tab.key === activeKey || !prev.pending.has(tab.key)) {
      instances[tab.key] = { rev: nextRev++, identity: tab.key === activeKey ? identity : '' };
    } else {
      pending.add(tab.key);
    }
  }

  const before = activeKey ? prev.instances[activeKey] : undefined;
  if (activeKey && before && instances[activeKey] === before && identity && before.identity !== identity) {
    if (prev.activeKey !== activeKey) {
      instances[activeKey] = { rev: nextRev++, identity };
    } else if (prev.locKey !== locKey) {
      instances[activeKey] = { ...before, identity };
    }
  }

  return { tabs, locKey, activeKey, pending, instances, nextRev };
};

/**
 * Keep-alive «рабочего стола» вкладок: каждая открытая страница приложения и все открытые
 * позиции живут смонтированными, пока присутствуют в едином списке `tabs`
 * (WorkspaceTabsContext) — неактивные скрыты через display:none, закрытые размонтируются и
 * вычищаются из sessionStorage. Так переключение между вкладками не сбрасывает состояние
 * (прокрутку, фильтры, выбранный тендер).
 *
 * Смонтирован в MainLayout всегда (рядом с <Outlet/> для путей вне реестра — редиректов), иначе
 * переходный рендер снёс бы все вкладки. Панель вкладок (WorkspaceTabsBar) рендерится в шапке
 * (HeaderTitleOrTabs); здесь — регистрация вкладки по URL, жизненный цикл страниц и прокрутка.
 */
const WorkspaceKeepAlive: React.FC = () => {
  const location = useLocation();
  const { tabs, openPageTab, openPositionTab } = useWorkspaceTabs();
  const positionId = useMatch('/positions/:positionId/items')?.params.positionId;
  const activeKey = resolveTabKey(location.pathname);

  const identityParam = positionId ? undefined : resolveWorkspacePage(location.pathname)?.page.identityParam;
  const identity = identityParam ? (new URLSearchParams(location.search).get(identityParam) ?? '') : '';

  const [state, setState] = useState(() =>
    deriveInstances(
      { tabs: [], locKey: '', activeKey: null, pending: new Set(tabs.map((t) => t.key)), instances: {}, nextRev: 0 },
      { tabs, locKey: location.key, activeKey, identity },
    ),
  );
  let current = state;
  if (state.tabs !== tabs || state.locKey !== location.key) {
    current = deriveInstances(state, { tabs, locKey: location.key, activeKey, identity });
    setState(current);
  }

  // tabs читаем через ref: регистрация должна реагировать ТОЛЬКО на смену URL, а не на
  // мутации списка вкладок (иначе при закрытии активной вкладки эффект вернул бы её на
  // промежуточном рендере — «нужно нажать × дважды»; закрытие активной сопровождается
  // навигацией прочь, см. onEdit в WorkspaceTabsBar).
  const tabsRef = useRef(tabs);
  useLayoutEffect(() => {
    tabsRef.current = tabs;
  });

  // Регистрация вкладки по URL (deep-link, переход по меню) и запоминание её последнего URL.
  // useLayoutEffect: вкладка появляется до отрисовки — панель и страница не мигают пустотой.
  useLayoutEffect(() => {
    if (positionId) {
      if (!tabsRef.current.some((t) => t.key === positionId)) {
        const tenderId = new URLSearchParams(location.search).get('tenderId') ?? '';
        openPositionTab({ positionId, tenderId, title: 'Позиция' });
      }
      return;
    }
    if (activeKey) openPageTab(location.pathname + location.search);
  }, [positionId, activeKey, location.pathname, location.search, openPageTab, openPositionTab]);

  const anchorRef = useRef<HTMLSpanElement>(null);
  const activeRev = activeKey ? (current.instances[activeKey]?.rev ?? 0) : 0;
  useTabScrollMemory(anchorRef, activeKey ? `${activeKey}#${activeRev}` : null);

  const itemId = new URLSearchParams(location.search).get('itemId');

  return (
    <>
      <span ref={anchorRef} hidden />
      {tabs.map((tab) => {
        const instance = current.instances[tab.key];
        if (!instance) return null;
        const active = tab.key === activeKey;
        return (
          <TabSlot
            key={`${tab.key}#${instance.rev}`}
            tab={tab}
            active={active}
            deepLinkItemId={active && tab.kind === 'position' ? itemId : null}
          />
        );
      })}
    </>
  );
};

export default WorkspaceKeepAlive;
