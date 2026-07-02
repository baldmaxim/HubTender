import { useEffect } from 'react';
import { usePositionTabActions } from '../../../contexts/PositionTabsContext';

interface PositionLike {
  position_number?: number | string | null;
  work_name?: string | null;
}

const truncate = (s: string, max = 20) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * Уточняет заголовок вкладки позиции, когда позиция загрузилась.
 * Регистрация вкладки выполняется в WorkspaceKeepAlive (на уровне роутинга),
 * поэтому здесь только setTabTitle. Навигацию не выполняет.
 */
export function usePositionTabTitle(positionId: string | undefined, position: PositionLike | null) {
  const { setTabTitle } = usePositionTabActions();

  useEffect(() => {
    if (!positionId || !position) return;
    const num = position.position_number;
    const name = position.work_name ? truncate(position.work_name) : '';
    const title = num != null ? (name ? `№ ${num} · ${name}` : `№ ${num}`) : name || 'Позиция';
    setTabTitle(positionId, title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionId, position?.position_number, position?.work_name]);
}
