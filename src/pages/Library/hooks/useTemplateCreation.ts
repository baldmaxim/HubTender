import { useState } from 'react';
import { message } from 'antd';
import { createTemplate } from '../../../lib/api/library';
import type { WorkLibraryFull, MaterialLibraryFull } from '../../../lib/types';
import type { TemplateItemWithDetails } from './useTemplateItems';

interface CostCategoryOption {
  value: string;
  label: string;
  cost_category_name: string;
  location: string;
}

export const useTemplateCreation = (
  _works: WorkLibraryFull[],
  _materials: MaterialLibraryFull[],
  costCategories: CostCategoryOption[]
) => {
  const [tempIdCounter, setTempIdCounter] = useState(0);
  const [templateItems, setTemplateItems] = useState<TemplateItemWithDetails[]>([]);
  const [selectedWork, setSelectedWork] = useState<string | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);

  const addWork = (work: WorkLibraryFull, templateCostCategoryId: string | null) => {
    const selectedCategory = costCategories.find(c => c.value === templateCostCategoryId);
    const categoryLabel = selectedCategory?.label || '';

    const newId = `temp-${Date.now()}-${tempIdCounter}`;
    setTempIdCounter(prev => prev + 1);

    const newItem: TemplateItemWithDetails = {
      id: newId,
      template_id: '',
      kind: 'work',
      work_library_id: work.id,
      material_library_id: null,
      parent_work_item_id: null,
      conversation_coeff: null,
      position: templateItems.length,
      note: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      work_name: work.work_name,
      work_unit: work.unit,
      work_item_type: work.item_type,
      work_unit_rate: work.unit_rate,
      work_currency_type: work.currency_type,
      detail_cost_category_id: templateCostCategoryId || null,
      detail_cost_category_full: categoryLabel || undefined,
      manual_cost_override: false,
    };

    setTemplateItems([...templateItems, newItem]);
  };

  const addMaterial = (material: MaterialLibraryFull, templateCostCategoryId: string | null) => {
    const selectedCategory = costCategories.find(c => c.value === templateCostCategoryId);
    const categoryLabel = selectedCategory?.label || '';

    const newId = `temp-${Date.now()}-${tempIdCounter}`;
    setTempIdCounter(prev => prev + 1);

    const newItem: TemplateItemWithDetails = {
      id: newId,
      template_id: '',
      kind: 'material',
      work_library_id: null,
      material_library_id: material.id,
      parent_work_item_id: null,
      conversation_coeff: null,
      position: templateItems.length,
      note: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      material_name: material.material_name,
      material_unit: material.unit,
      material_item_type: material.item_type,
      material_type: material.material_type,
      material_consumption_coefficient: material.consumption_coefficient,
      material_unit_rate: material.unit_rate,
      material_currency_type: material.currency_type,
      material_delivery_price_type: material.delivery_price_type,
      material_delivery_amount: material.delivery_amount,
      detail_cost_category_id: templateCostCategoryId || null,
      detail_cost_category_full: categoryLabel || undefined,
      manual_cost_override: false,
    };

    setTemplateItems([...templateItems, newItem]);
  };

  const deleteItem = (id: string) => {
    const itemToDelete = templateItems.find(item => item.id === id);

    if (itemToDelete?.kind === 'work') {
      const updatedItems = templateItems
        .filter((item) => item.id !== id)
        .map((item) => {
          if (item.kind === 'material' && item.parent_work_item_id === id) {
            return {
              ...item,
              parent_work_item_id: null,
              conversation_coeff: null,
            };
          }
          return item;
        });
      setTemplateItems(updatedItems);
    } else {
      setTemplateItems(templateItems.filter((item) => item.id !== id));
    }
  };

  const saveTemplate = async (name: string, detailCostCategoryId: string) => {
    if (templateItems.length === 0) {
      message.warning('Добавьте хотя бы один элемент в шаблон');
      return false;
    }

    const invalidMaterials = templateItems.filter(
      item => item.kind === 'material' &&
      item.parent_work_item_id &&
      !item.conversation_coeff
    );

    if (invalidMaterials.length > 0) {
      message.error('Введите коэффициент перевода');
      return false;
    }

    const workItems = templateItems.filter(item => item.kind === 'work');
    const materialItems = templateItems.filter(item => item.kind === 'material');

    // parent_work_item_id материала — temp-id work-элемента; маппим в индекс
    // массива работ (сервер резолвит в реальный id после вставки работ).
    await createTemplate({
      name,
      detail_cost_category_id: detailCostCategoryId,
      works: workItems.map((item) => ({
        work_library_id: item.work_library_id ?? null,
        detail_cost_category_id: item.detail_cost_category_id || null,
        note: item.note ?? null,
      })),
      materials: materialItems.map((item) => {
        const parentIndex = item.parent_work_item_id
          ? workItems.findIndex(w => w.id === item.parent_work_item_id)
          : -1;
        return {
          material_library_id: item.material_library_id ?? null,
          parent_work_index: parentIndex >= 0 ? parentIndex : null,
          conversation_coeff: item.conversation_coeff ?? null,
          detail_cost_category_id: item.detail_cost_category_id || null,
          note: item.note ?? null,
        };
      }),
    });

    return true;
  };

  const resetCreation = () => {
    setTemplateItems([]);
    setSelectedWork(null);
    setSelectedMaterial(null);
    setTempIdCounter(0);
  };

  return {
    templateItems,
    setTemplateItems,
    selectedWork,
    setSelectedWork,
    selectedMaterial,
    setSelectedMaterial,
    addWork,
    addMaterial,
    deleteItem,
    saveTemplate,
    resetCreation,
  };
};
