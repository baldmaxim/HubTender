import { useState, useEffect } from 'react';
import { message } from 'antd';
import type { WorkLibraryFull, MaterialLibraryFull } from '../../../lib/types';
import { listWorksLibrary, listMaterialsLibrary } from '../../../lib/api/library';
import { listDetailCostCategoriesWithCategory } from '../../../lib/api/costs';
import { getErrorMessage } from '../../../utils/errors';

interface CostCategoryOption {
  value: string;
  label: string;
  cost_category_name: string;
  location: string;
}

export const useLibraryData = () => {
  const [works, setWorks] = useState<WorkLibraryFull[]>([]);
  const [materials, setMaterials] = useState<MaterialLibraryFull[]>([]);
  const [costCategories, setCostCategories] = useState<CostCategoryOption[]>([]);

  const fetchWorks = async () => {
    try {
      const data = await listWorksLibrary();

      const formatted = (data || []).map((item) => ({
        ...item,
        work_name: (Array.isArray(item.work_names) ? item.work_names[0] : item.work_names)?.name || '',
        unit: (Array.isArray(item.work_names) ? item.work_names[0] : item.work_names)?.unit || '',
      }));

      setWorks(formatted as unknown as WorkLibraryFull[]);
    } catch (error) {
      message.error('Ошибка загрузки работ: ' + getErrorMessage(error));
    }
  };

  const fetchMaterials = async () => {
    try {
      const data = await listMaterialsLibrary();

      const formatted = (data || []).map((item) => ({
        ...item,
        material_name: (Array.isArray(item.material_names) ? item.material_names[0] : item.material_names)?.name || '',
        unit: (Array.isArray(item.material_names) ? item.material_names[0] : item.material_names)?.unit || '',
      }));

      setMaterials(formatted as unknown as MaterialLibraryFull[]);
    } catch (error) {
      message.error('Ошибка загрузки материалов: ' + getErrorMessage(error));
    }
  };

  const fetchCostCategories = async () => {
    try {
      const data = await listDetailCostCategoriesWithCategory();

      const options: CostCategoryOption[] = (data || []).map((item) => {
        const cc = Array.isArray(item.cost_categories) ? item.cost_categories[0] : item.cost_categories;
        return {
          value: item.id,
          label: `${cc?.name} / ${item.name} / ${item.location}`,
          cost_category_name: cc?.name || '',
          location: item.location ?? '',
        };
      });

      setCostCategories(options);
    } catch (error) {
      message.error('Ошибка загрузки категорий затрат: ' + getErrorMessage(error));
    }
  };

  useEffect(() => {
    fetchWorks();
    fetchMaterials();
    fetchCostCategories();
  }, []);

  return {
    works,
    materials,
    costCategories,
  };
};
