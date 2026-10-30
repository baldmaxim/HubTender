import { useEffect, useState } from 'react';
import { analogErrorMessage, fetchAnalogSource } from '../../../lib/api/analogs';
import type { IAnalogSource } from '../../../lib/api/analogs.types';

/** Полная позиция-источник (все строки состава). */
export const useAnalogSource = (sourcePositionId: string) => {
  const [source, setSource] = useState<IAnalogSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAnalogSource(sourcePositionId)
      .then((res) => !cancelled && setSource(res))
      .catch((e: unknown) => !cancelled && setError(analogErrorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sourcePositionId]);

  return { source, loading, error };
};
