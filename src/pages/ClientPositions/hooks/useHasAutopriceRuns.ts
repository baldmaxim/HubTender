import { useEffect, useState } from 'react';
import { activeRuns, fetchAutopriceRuns } from '../../../lib/api/autoprice';

/** Есть ли у тендера хотя бы один неотменённый прогон авторасценки. Ошибка запроса = нет. */
export const useHasAutopriceRuns = (tenderId: string | null | undefined): boolean => {
  const [result, setResult] = useState<{ tenderId: string; has: boolean } | null>(null);

  useEffect(() => {
    if (!tenderId) return;
    let cancelled = false;
    fetchAutopriceRuns(tenderId)
      .then((runs) => !cancelled && setResult({ tenderId, has: activeRuns(runs).length > 0 }))
      .catch(() => !cancelled && setResult({ tenderId, has: false }));
    return () => {
      cancelled = true;
    };
  }, [tenderId]);

  return !!tenderId && result?.tenderId === tenderId && result.has;
};
