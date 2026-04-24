import { useState, useRef } from 'react';
import { message } from 'antd';
import { supabase } from '../../../lib/supabase';
import { getErrorMessage } from '../../../utils/errors';
import type { TemplateItem } from '../../../lib/supabase';

export interface TemplateItemWithDetails extends TemplateItem {
  work_name?: string;
  work_unit?: string;
  work_item_type?: string;
  work_unit_rate?: number;
  work_currency_type?: string;
  material_name?: string;
  material_unit?: string;
  material_item_type?: string;
  material_type?: string;
  material_consumption_coefficient?: number;
  material_unit_rate?: number;
  material_currency_type?: string;
  material_delivery_price_type?: string;
  material_delivery_amount?: number;
  parent_work_name?: string;
  detail_cost_category_name?: string;
  detail_cost_category_full?: string;
  manual_cost_override?: boolean;
}

const ITEMS_QUERY = `
  *,
  works_library:work_library_id(*, work_names(name, unit)),
  materials_library:material_library_id(*, material_names(name, unit)),
  detail_cost_categories:detail_cost_category_id(name, location, cost_categories(name))
`;

// O(n) — Map вместо повторных filter()
const sortItemsByHierarchy = (items: TemplateItemWithDetails[]): TemplateItemWithDetails[] => {
  const works: TemplateItemWithDetails[] = [];
  const linkedMaterialsMap = new Map<string, TemplateItemWithDetails[]>();
  const unlinkedMaterials: TemplateItemWithDetails[] = [];

  for (const item of items) {
    if (item.kind === 'work') {
      works.push(item);
    } else if (item.parent_work_item_id) {
      const arr = linkedMaterialsMap.get(item.parent_work_item_id) ?? [];
      arr.push(item);
      linkedMaterialsMap.set(item.parent_work_item_id, arr);
    } else {
      unlinkedMaterials.push(item);
    }
  }

  works.sort((a, b) => (a.position || 0) - (b.position || 0));

  const result: TemplateItemWithDetails[] = [];
  const worksWithoutMaterials: TemplateItemWithDetails[] = [];

  for (const work of works) {
    const mats = linkedMaterialsMap.get(work.id);
    if (mats?.length) {
      result.push(work);
      mats.sort((a, b) => (a.position || 0) - (b.position || 0));
      result.push(...mats);
    } else {
      worksWithoutMaterials.push(work);
    }
  }

  result.push(...worksWithoutMaterials);
  result.push(...unlinkedMaterials);
  return result;
};

type RawTemplateItem = {
  detail_cost_categories?: { name?: string; location?: string; cost_categories?: { name?: string } | Array<{ name?: string }> } | null;
  works_library?: { work_names?: { name?: string; unit?: string } | Array<{ name?: string; unit?: string }>; item_type?: string; unit_rate?: number; currency_type?: string } | null;
  materials_library?: { material_names?: { name?: string; unit?: string } | Array<{ name?: string; unit?: string }>; item_type?: string; material_type?: string; consumption_coefficient?: number; unit_rate?: number; currency_type?: string; delivery_price_type?: string; delivery_amount?: number } | null;
  [key: string]: unknown;
};

const formatItem = (item: RawTemplateItem, parentWorkName?: string): TemplateItemWithDetails => {
  let detailCostCategoryFull: string | undefined;
  const dcc = item.detail_cost_categories;
  if (dcc) {
    const costCats = Array.isArray(dcc.cost_categories) ? dcc.cost_categories[0] : dcc.cost_categories;
    const cat = costCats?.name || '';
    const det = dcc.name || '';
    const loc = dcc.location || '';
    detailCostCategoryFull = `${cat} / ${det} / ${loc}`;
  }
  const wl = item.works_library;
  const wn = wl ? (Array.isArray(wl.work_names) ? wl.work_names[0] : wl.work_names) : undefined;
  const ml = item.materials_library;
  const mn = ml ? (Array.isArray(ml.material_names) ? ml.material_names[0] : ml.material_names) : undefined;
  return {
    ...(item as unknown as TemplateItem),
    work_name: wn?.name,
    work_unit: wn?.unit,
    work_item_type: wl?.item_type,
    work_unit_rate: wl?.unit_rate,
    work_currency_type: wl?.currency_type,
    material_name: mn?.name,
    material_unit: mn?.unit,
    material_item_type: ml?.item_type,
    material_type: ml?.material_type,
    material_consumption_coefficient: ml?.consumption_coefficient,
    material_unit_rate: ml?.unit_rate,
    material_currency_type: ml?.currency_type,
    material_delivery_price_type: ml?.delivery_price_type,
    material_delivery_amount: ml?.delivery_amount,
    parent_work_name: parentWorkName,
    detail_cost_category_name: dcc?.name,
    detail_cost_category_full: detailCostCategoryFull,
  };
};

export const useTemplateItems = () => {
  const [loadedTemplateItems, setLoadedTemplateItems] = useState<Record<string, TemplateItemWithDetails[]>>({});
  const [loadingTemplates, setLoadingTemplates] = useState<Set<string>>(new Set());
  // Ref для предотвращения двойной загрузки одного шаблона
  const fetchedRef = useRef(new Set<string>());

  // Ленивая загрузка элементов одного шаблона
  const fetchTemplateItems = async (templateId: string) => {
    if (fetchedRef.current.has(templateId)) return;
    fetchedRef.current.add(templateId);
    setLoadingTemplates(prev => new Set(prev).add(templateId));

    try {
      const { data, error } = await supabase
        .from('template_items')
        .select(ITEMS_QUERY)
        .eq('template_id', templateId)
        .order('position');

      if (error) throw error;

      const raw = data || [];
      // Строим Map для поиска родительских имён за O(n)
      const rawItems = raw as unknown as RawTemplateItem[];
      const idToWork = new Map<string, RawTemplateItem>(
        rawItems.filter(i => i.kind === 'work').map(i => [i.id as string, i])
      );
      const formatted = rawItems.map(item => {
        const parent = item.parent_work_item_id ? idToWork.get(item.parent_work_item_id as string) : undefined;
        const wn = parent?.works_library;
        const wnNames = wn ? (Array.isArray(wn.work_names) ? wn.work_names[0] : wn.work_names) : undefined;
        return formatItem(item, wnNames?.name);
      });

      setLoadedTemplateItems(prev => ({ ...prev, [templateId]: sortItemsByHierarchy(formatted) }));
    } catch (error) {
      fetchedRef.current.delete(templateId); // позволяем повторную попытку
      message.error('Ошибка загрузки элементов шаблона: ' + getErrorMessage(error));
    } finally {
      setLoadingTemplates(prev => { const s = new Set(prev); s.delete(templateId); return s; });
    }
  };

  // Принудительная перезагрузка (после сохранения редактирования)
  const refetchTemplateItems = async (templateId: string) => {
    fetchedRef.current.delete(templateId);
    await fetchTemplateItems(templateId);
  };

  const handleDeleteTemplateItem = async (templateId: string, itemId: string) => {
    try {
      const currentItems = loadedTemplateItems[templateId] || [];
      const itemToDelete = currentItems.find(item => item.id === itemId);

      if (itemToDelete?.kind === 'work') {
        const linkedIds = currentItems
          .filter(item => item.kind === 'material' && item.parent_work_item_id === itemId)
          .map(item => item.id);

        if (linkedIds.length > 0) {
          // Один запрос вместо цикла
          const { error: updateError } = await supabase
            .from('template_items')
            .update({ parent_work_item_id: null, conversation_coeff: null })
            .in('id', linkedIds);
          if (updateError) throw updateError;
        }
      }

      const { error } = await supabase
        .from('template_items')
        .delete()
        .eq('id', itemId);

      if (error) throw error;

      message.success('Элемент удален');

      setLoadedTemplateItems(prev => {
        const items = prev[templateId] || [];
        const updatedItems = items
          .filter(item => item.id !== itemId)
          .map(item =>
            item.kind === 'material' && item.parent_work_item_id === itemId
              ? { ...item, parent_work_item_id: null, conversation_coeff: null }
              : item
          );
        return { ...prev, [templateId]: updatedItems };
      });
    } catch (error) {
      message.error('Ошибка удаления элемента: ' + getErrorMessage(error));
    }
  };

  // Оставляем для обратной совместимости (вызывается при первом открытии если нужно)
  const fetchAllTemplateItems = async () => {
    // Не вызывается автоматически — только по явному запросу
  };

  return {
    loadedTemplateItems,
    loadingTemplates,
    setLoadedTemplateItems,
    fetchTemplateItems,
    refetchTemplateItems,
    fetchAllTemplateItems,
    handleDeleteTemplateItem,
  };
};
