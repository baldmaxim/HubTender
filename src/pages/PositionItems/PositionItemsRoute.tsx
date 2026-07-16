import { useParams, useSearchParams } from 'react-router-dom';
import PositionItems from './PositionItems';

/**
 * Роут-обёртка для прямого перехода по /positions/:positionId/items.
 *
 * Существует ровно для того, чтобы роутер-хуки жили ЗДЕСЬ, а не в PositionItems: useParams и
 * useSearchParams подписывают компонент на RouteContext/LocationContext, которые меняются на
 * каждую навигацию, и memo(PositionItems) переставал держать — каждая смонтированная под
 * keep-alive вкладка (включая скрытые) перестраивала свой список на любой переход.
 *
 * Обёртка намеренно НЕ мемоизирована: её задача — поглотить подписку на роутер и отдать вниз
 * примитивные пропы. Сама она почти ничего не рендерит, поэтому её перерисовки бесплатны.
 *
 * Практически этот путь почти не используется: MainLayout подменяет <Outlet/> на
 * <WorkspaceKeepAlive/> для workspace-роутов (см. isWorkspacePath), поэтому вкладки позиций
 * монтируются оттуда. Но роут обязан оставаться зарегистрированным — иначе путь перестанет
 * матчиться и MainLayout не отрисуется вовсе.
 */
export default function PositionItemsRoute() {
  const { positionId } = useParams<{ positionId: string }>();
  const [searchParams] = useSearchParams();

  if (!positionId) return null;

  return <PositionItems positionId={positionId} deepLinkItemId={searchParams.get('itemId')} />;
}
