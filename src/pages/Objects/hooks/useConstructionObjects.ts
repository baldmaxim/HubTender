import { useCallback, useEffect, useState } from 'react';
import { fetchConstructionObjects } from '../../../lib/api/constructionObjects';
import type { IConstructionObject } from '../../../lib/types/types';

interface IUseConstructionObjects {
  objects: IConstructionObject[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export const useConstructionObjects = (): IUseConstructionObjects => {
  const [objects, setObjects] = useState<IConstructionObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setObjects(await fetchConstructionObjects());
    } catch (e) {
      console.error('Error loading construction objects:', e);
      setError(e instanceof Error ? e.message : 'Не удалось загрузить объекты');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { objects, loading, error, reload };
};
