import { message } from 'antd';
import { supabase } from '../../../../lib/supabase';
import { TreeNode } from './useConstructionCost.tsx';

interface CategoryFormValues { name: string; unit?: string; }
interface DetailFormValues { name: string; unit?: string; location?: string; }
interface LocationFormValues { unit?: string; location?: string; }

export const useCategoryActions = (loadData: () => Promise<void>) => {
  const addCategory = async (values: CategoryFormValues) => {
    try {
      const { error } = await supabase
        .from('cost_categories')
        .insert({
          name: values.name,
          unit: values.unit,
        })
        .select()
        .single();

      if (error) throw error;

      message.success('Категория успешно добавлена');
      await loadData();
      return true;
    } catch (error) {
      console.error('Ошибка добавления категории:', error);
      message.error('Ошибка при добавлении категории');
      return false;
    }
  };

  const addDetail = async (values: DetailFormValues, categoryId?: string) => {
    try {
      const { data: maxOrderData } = await supabase
        .from('detail_cost_categories')
        .select('order_num')
        .order('order_num', { ascending: false })
        .limit(1);

      const nextOrderNum = maxOrderData && maxOrderData.length > 0
        ? (maxOrderData[0].order_num + 1)
        : 1;

      const { error } = await supabase
        .from('detail_cost_categories')
        .insert({
          cost_category_id: categoryId,
          name: values.name,
          unit: values.unit,
          location: values.location,
          order_num: nextOrderNum,
        });

      if (error) throw error;

      message.success('Детализация успешно добавлена');
      await loadData();
      return true;
    } catch (error) {
      console.error('Ошибка добавления детализации:', error);
      message.error('Ошибка при добавлении детализации');
      return false;
    }
  };

  const addLocation = async (values: LocationFormValues, detail: TreeNode | null) => {
    try {
      const { error } = await supabase
        .from('detail_cost_categories')
        .insert({
          cost_category_id: detail?.categoryId,
          name: detail?.structure,
          unit: detail?.unit || values.unit,
          location: values.location,
          order_num: detail?.orderNum || 999,
        });

      if (error) throw error;

      message.success('Локализация успешно добавлена');
      await loadData();
      return true;
    } catch (error) {
      console.error('Ошибка добавления локализации:', error);
      message.error('Ошибка при добавлении локализации');
      return false;
    }
  };

  return {
    addCategory,
    addDetail,
    addLocation,
  };
};
