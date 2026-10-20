import { useContext, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { UNSAFE_LocationContext, UNSAFE_RouteContext } from 'react-router-dom';
import { TabActiveContext, TabKeyContext } from '../../hooks/useIsTabActive';

interface TabHostProps {
  tabKey: string;
  active: boolean;
  children: ReactNode;
}

/**
 * Хост вкладки «рабочего стола»: сообщает странице, активна ли она (useIsTabActive), и
 * замораживает для скрытой вкладки router-контексты.
 *
 * Зачем. useNavigate/useSearchParams/useLocation подписывают страницу на LocationContext, а
 * useNavigate ещё и на RouteContext, который react-router пересоздаёт на каждый рендер Routes.
 * Без заморозки каждая скрытая страница перерисовывалась бы на любую навигацию и видела URL
 * активной вкладки (ClientPositions подхватила бы чужой tenderId). С заморозкой скрытая
 * страница видит тот URL и те params, что были, пока она была активной, и не перерисовывается;
 * при показе получает живые значения. Те же params-ы работают и у useParams (ProjectDetail).
 *
 * Замороженное значение фиксируем в useLayoutEffect — только из закоммиченного рендера: рендер
 * в startTransition может быть отброшен, и в ref осталась бы локация, которой на экране не было.
 *
 * UNSAFE_*: публичного API для подмены router-контекста у react-router нет.
 */
export const TabHost: React.FC<TabHostProps> = ({ tabKey, active, children }) => {
  const liveLocation = useContext(UNSAFE_LocationContext);
  const liveRoute = useContext(UNSAFE_RouteContext);
  const frozen = useRef({ liveLocation, liveRoute });

  useLayoutEffect(() => {
    if (active) frozen.current = { liveLocation, liveRoute };
  });

  return (
    <TabKeyContext.Provider value={tabKey}>
      <TabActiveContext.Provider value={active}>
        <UNSAFE_LocationContext.Provider value={active ? liveLocation : frozen.current.liveLocation}>
          <UNSAFE_RouteContext.Provider value={active ? liveRoute : frozen.current.liveRoute}>
            {children}
          </UNSAFE_RouteContext.Provider>
        </UNSAFE_LocationContext.Provider>
      </TabActiveContext.Provider>
    </TabKeyContext.Provider>
  );
};
