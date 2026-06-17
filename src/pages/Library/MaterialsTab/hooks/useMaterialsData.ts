import { useState, useEffect, useRef } from 'react';
import { message } from 'antd';
import type { MaterialLibraryFull, MaterialName } from '../../../../lib/supabase';
import { listMaterialsLibrary } from '../../../../lib/api/library';
import { listMaterialNames } from '../../../../lib/api/nomenclatures';
import { useRealtimeTopic } from '../../../../lib/realtime/useRealtimeTopic';

export const useMaterialsData = () => {
  const [data, setData] = useState<MaterialLibraryFull[]>([]);
  const [loading, setLoading] = useState(false);
  const [materialNames, setMaterialNames] = useState<MaterialName[]>([]);
  const hasFetchedNames = useRef(false);

  const fetchMaterials = async () => {
    setLoading(true);
    try {
      const materialsData = await listMaterialsLibrary();

      const formatted = materialsData?.map(item => ({
        ...item,
        material_name: item.material_names?.name || '',
        unit: item.material_names?.unit || 'шт'
      })) as MaterialLibraryFull[];

      setData(formatted || []);
    } catch (error) {
      console.error('Error fetching materials:', error);
      message.error('Ошибка загрузки материалов');
    } finally {
      setLoading(false);
    }
  };

  const fetchMaterialNames = async () => {
    if (hasFetchedNames.current) return;
    hasFetchedNames.current = true;

    try {
      // Go отдаёт все material_names одним запросом (без 1000-стр. пагинации).
      const allNames = (await listMaterialNames()) as unknown as MaterialName[];

      // Дедупликация: сначала по name (оставляем первое вхождение), потом по id
      const uniqueByName = Array.from(
        new Map(allNames.map(item => [item.name, item])).values()
      );
      const uniqueNames = Array.from(
        new Map(uniqueByName.map(item => [item.id, item])).values()
      );

      console.log(`[MaterialsData] Loaded ${allNames.length} raw, ${uniqueNames.length} unique material names`);
      setMaterialNames(uniqueNames);
    } catch (error) {
      console.error('Error fetching material names:', error);
      hasFetchedNames.current = false; // Сброс при ошибке
    }
  };

  useEffect(() => {
    fetchMaterials();
    fetchMaterialNames();
  }, []);

  // Native WS hub — обновляем библиотеку материалов при изменениях справочников.
  useRealtimeTopic('references', () => {
    void fetchMaterials();
  });

  return {
    data,
    loading,
    materialNames,
    fetchMaterials,
  };
};
