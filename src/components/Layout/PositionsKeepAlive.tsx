import { useEffect } from 'react';
import { useLocation, useMatch, useSearchParams } from 'react-router-dom';
import PositionTabsBar from './PositionTabsBar';
import ClientPositions from '../../pages/ClientPositions/ClientPositions';
import PositionItems from '../../pages/PositionItems/PositionItems';
import { usePositionTabs } from '../../contexts/PositionTabsContext';

/**
 * Keep-alive раздела «Позиции»: список и все открытые позиции смонтированы
 * одновременно, неактивные скрыты через display:none. Так переключение между
 * списком и позициями (и между позициями) не сбрасывает их состояние.
 *
 * Рендерится вместо <Outlet/> для /positions* (см. MainLayout), поэтому
 * route-элементы positions/* не монтируются повторно.
 */
const PositionsKeepAlive: React.FC = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { tabs, openTab } = usePositionTabs();
  const match = useMatch('/positions/:positionId/items');
  const currentPositionId = match?.params.positionId;
  const isList = location.pathname === '/positions';

  // Deep-link: если открыта позиция, которой ещё нет в tabs — регистрируем её.
  // searchParams здесь корректен, т.к. относится к текущему (активному) роуту.
  useEffect(() => {
    if (currentPositionId && !tabs.some((t) => t.positionId === currentPositionId)) {
      openTab({ positionId: currentPositionId, tenderId: searchParams.get('tenderId') ?? '', title: 'Позиция' });
    }
  }, [currentPositionId, tabs, openTab, searchParams]);

  return (
    <>
      <PositionTabsBar />
      <div style={{ display: isList ? 'block' : 'none' }}>
        <ClientPositions />
      </div>
      {tabs.map((t) => (
        <div
          key={t.positionId}
          style={{ display: currentPositionId === t.positionId ? 'block' : 'none' }}
        >
          <PositionItems positionId={t.positionId} />
        </div>
      ))}
    </>
  );
};

export default PositionsKeepAlive;
