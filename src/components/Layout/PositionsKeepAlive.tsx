import { useEffect, useRef } from 'react';
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

  // tabs читаем через ref: эффект должен реагировать ТОЛЬКО на смену URL, а не на
  // мутации списка вкладок.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Deep-link: если открыта позиция, которой ещё нет в tabs — регистрируем её.
  // ВАЖНО: tabs НЕ в зависимостях. Иначе при закрытии активной вкладки эффект
  // повторно срабатывает на промежуточном рендере, где tabs уже без позиции, а
  // currentPositionId (старый URL) всё ещё равен ей (react-router v7 коммитит
  // локацию в startTransition — позже, чем срочный closeTab), и openTab возвращает
  // только что закрытую вкладку → «нужно нажать × дважды». Инвариант: закрытие
  // активной вкладки всегда сопровождается навигацией прочь (см. onEdit в
  // PositionTabsBar — единственный вызывающий closeTab).
  useEffect(() => {
    if (currentPositionId && !tabsRef.current.some((t) => t.positionId === currentPositionId)) {
      openTab({ positionId: currentPositionId, tenderId: searchParams.get('tenderId') ?? '', title: 'Позиция' });
    }
  }, [currentPositionId, searchParams, openTab]);

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
