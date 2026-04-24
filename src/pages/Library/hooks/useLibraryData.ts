import { useState, useEffect } from 'react';
import { message } from 'antd';
import { supabase } from '../../../lib/supabase';
import type { WorkLibraryFull, MaterialLibraryFull } from '../../../lib/supabase';
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
      const { data, error } = await supabase
        .from('works_library')
        .select('*, work_names(name, unit)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formatted = (data || []).map((item: any) => ({
        ...item,
        work_name: item.work_names?.name || '',
        unit: item.work_names?.unit || '',
      }));

      setWorks(formatted);
    } catch (error) {
      message.error('Ошибка загрузки работ: ' + getErrorMessage(error));
    }
  };

  const fetchMaterials = async () => {
    try {
      const { data, error } = await supabase
        .from('materials_library')
        .select('*, material_names(name, unit)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formatted = (data || []).map((item: any) => ({
        ...item,
        material_name: item.material_names?.name || '',
        unit: item.material_names?.unit || '',
      }));

      setMaterials(formatted);
    } catch (error) {
      message.error('Ошибка загрузки материалов: ' + getErrorMessage(error));
    }
  };

  const fetchCostCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('detail_cost_categories')
        .select('*, cost_categories(name)')
        .order('order_num', { ascending: true });

      if (error) throw error;

      const options: CostCategoryOption[] = (data || []).map((item: any) => ({
        value: item.id,
        label: `${item.cost_categories?.name} / ${item.name} / ${item.location}`,
        cost_category_name: item.cost_categories?.name || '',
        location: item.location,
      }));

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
