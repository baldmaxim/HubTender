import { useEffect, useState } from 'react';

const QUERY = '(min-width: 1280px)';

/** true на десктопе ≥ 1280 px — там панель позиции стоит справа от списка, а не в Drawer. */
export const useWideScreen = (): boolean => {
  const [wide, setWide] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setWide(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return wide;
};
