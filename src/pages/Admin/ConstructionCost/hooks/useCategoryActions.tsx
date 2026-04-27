import { message } from 'antd';
import {
  createCostCategory,
  createDetailCostCategory,
  getMaxDetailCostCategoryOrderNum,
} from '../../../../lib/api/costs';
import { TreeNode } from './useConstructionCost.tsx';

interface CategoryFormValues { name: string; unit?: string; }
interface DetailFormValues { name: string; unit?: string; location?: string; }
interface LocationFormValues { unit?: string; location?: string; }

export const useCategoryActions = (loadData: () => Promise<void>) => {
  const addCategory = async (values: CategoryFormValues) => {
    try {
      await createCostCategory({ name: values.name, unit: values.unit });
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
      const maxOrderNum = await getMaxDetailCostCategoryOrderNum();
      await createDetailCostCategory({
        cost_category_id: categoryId,
        name: values.name,
        unit: values.unit,
        location: values.location,
        order_num: maxOrderNum + 1,
      });

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
      await createDetailCostCategory({
        cost_category_id: detail?.categoryId,
        name: detail?.structure,
        unit: detail?.unit || values.unit,
        location: values.location,
        order_num: detail?.orderNum || 999,
      });

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
