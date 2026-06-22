import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePositionTabs } from '../../../contexts/PositionTabsContext';

interface PositionLike {
  tender_id?: string;
  position_number?: number | string | null;
  work_name?: string | null;
}

const truncate = (s: string, max = 20) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * Регистрирует вкладку текущей позиции (для прямых ссылок / перезагрузки) и
 * уточняет её заголовок, когда позиция загрузилась. Навигацию не выполняет —
 * мы уже находимся на странице позиции.
 */
export function usePositionTabRegistration(
  positionId: string | undefined,
  position: PositionLike | null,
) {
  const [searchParams] = useSearchParams();
  const { openTab, setTabTitle } = usePositionTabs();
  const tenderIdFromUrl = searchParams.get('tenderId');

  // Саморегистрация при заходе по прямой ссылке/обновлении страницы.
  useEffect(() => {
    if (!positionId) return;
    openTab({ positionId, tenderId: tenderIdFromUrl ?? position?.tender_id ?? '', title: 'Позиция' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionId, tenderIdFromUrl]);

  // Уточнение заголовка после загрузки позиции.
  useEffect(() => {
    if (!positionId || !position) return;
    const num = position.position_number;
    const name = position.work_name ? truncate(position.work_name) : '';
    const title = num != null ? (name ? `№ ${num} · ${name}` : `№ ${num}`) : name || 'Позиция';
    setTabTitle(positionId, title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionId, position?.position_number, position?.work_name]);
}
