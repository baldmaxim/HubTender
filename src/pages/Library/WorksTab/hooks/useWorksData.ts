import { useState, useEffect, useRef } from 'react';
import { message } from 'antd';
import type { WorkLibraryFull, WorkName } from '../../../../lib/supabase';
import { listWorksLibrary } from '../../../../lib/api/library';
import { listWorkNames } from '../../../../lib/api/nomenclatures';
import { useRealtimeTopic } from '../../../../lib/realtime/useRealtimeTopic';

export const useWorksData = () => {
  const [data, setData] = useState<WorkLibraryFull[]>([]);
  const [loading, setLoading] = useState(false);
  const [workNames, setWorkNames] = useState<WorkName[]>([]);
  const hasFetchedNames = useRef(false);

  const fetchWorks = async () => {
    setLoading(true);
    try {
      const worksData = await listWorksLibrary();

      const formatted = worksData?.map(item => ({
        ...item,
        work_name: item.work_names?.name || '',
        unit: item.work_names?.unit || 'шт'
      })) as WorkLibraryFull[];

      setData(formatted || []);
    } catch (error) {
      console.error('Error fetching works:', error);
      message.error('Ошибка загрузки работ');
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkNames = async () => {
    if (hasFetchedNames.current) return;
    hasFetchedNames.current = true;

    try {
      // Go отдаёт все work_names одним запросом (без 1000-стр. пагинации).
      const allNames = (await listWorkNames()) as unknown as WorkName[];

      // Дедупликация: сначала по name (оставляем первое вхождение), потом по id
      const uniqueByName = Array.from(
        new Map(allNames.map(item => [item.name, item])).values()
      );
      const uniqueNames = Array.from(
        new Map(uniqueByName.map(item => [item.id, item])).values()
      );

      console.log(`[WorksData] Loaded ${allNames.length} raw, ${uniqueNames.length} unique work names`);
      setWorkNames(uniqueNames);
    } catch (error) {
      console.error('Error fetching work names:', error);
      hasFetchedNames.current = false; // Сброс при ошибке
    }
  };

  useEffect(() => {
    fetchWorks();
    fetchWorkNames();
  }, []);

  // Native WS hub — обновляем библиотеку работ при изменениях справочников.
  useRealtimeTopic('references', () => {
    void fetchWorks();
  });

  return {
    data,
    loading,
    workNames,
    fetchWorks,
  };
};
