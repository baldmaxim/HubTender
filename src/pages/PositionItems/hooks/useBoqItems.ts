import { useState, useEffect } from 'react';
import { message } from 'antd';
import {
  supabase,
  type ClientPosition,
  type BoqItemFull,
  type WorkLibraryFull,
  type MaterialLibraryFull,
  type CurrencyType,
  type WorkName,
  type MaterialName,
} from '../../../lib/supabase';
import { calculateBoqItemTotalAmount } from '../../../utils/boq/calculateBoqAmount';
import { getErrorMessage } from '../../../utils/errors';

interface CostCategoryOption {
  value: string;
  label: string;
  cost_category_name: string;
  location: string;
}

interface Template {
  id: string;
  name: string;
  detail_cost_category_id: string | null;
  detail_cost_category_full?: string | null;
}

export const useBoqItems = (positionId: string | undefined) => {
  const [position, setPosition] = useState<ClientPosition | null>(null);
  const [items, setItems] = useState<BoqItemFull[]>([]);
  const [works, setWorks] = useState<WorkLibraryFull[]>([]);
  const [materials, setMaterials] = useState<MaterialLibraryFull[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [currencyRates, setCurrencyRates] = useState<{ usd: number; eur: number; cny: number }>({ usd: 0, eur: 0, cny: 0 });
  const [costCategories, setCostCategories] = useState<CostCategoryOption[]>([]);
  const [workNames, setWorkNames] = useState<WorkName[]>([]);
  const [materialNames, setMaterialNames] = useState<MaterialName[]>([]);
  const [units, setUnits] = useState<Array<{ code: string; name: string }>>([]);

  // Состояния для данных ГП
  const [gpVolume, setGpVolume] = useState<number>(0);
  const [gpNote, setGpNote] = useState<string>('');

  // Состояния для редактирования доп работ
  const [workName, setWorkName] = useState<string>('');
  const [unitCode, setUnitCode] = useState<string>('');

  const getCurrencyRate = (currency: CurrencyType): number => {
    switch (currency) {
      case 'USD':
        return currencyRates.usd;
      case 'EUR':
        return currencyRates.eur;
      case 'CNY':
        return currencyRates.cny;
      case 'RUB':
      default:
        return 1;
    }
  };

  const fetchPositionData = async () => {
    try {
      const { data, error } = await supabase
        .from('client_positions')
        .select('*, tenders(usd_rate, eur_rate, cny_rate)')
        .eq('id', positionId)
        .single();

      if (error) throw error;
      setPosition(data);

      setGpVolume(data.manual_volume || 0);
      setGpNote(data.manual_note || '');

      if (data.is_additional) {
        setWorkName(data.work_name || '');
        setUnitCode(data.unit_code || '');
      }

      if (data.tenders) {
        setCurrencyRates({
          usd: data.tenders.usd_rate || 0,
          eur: data.tenders.eur_rate || 0,
          cny: data.tenders.cny_rate || 0,
        });
      }
    } catch (error) {
      message.error('Ошибка загрузки позиции: ' + getErrorMessage(error));
    }
  };

  const sortItemsByHierarchy = (items: BoqItemFull[]): BoqItemFull[] => {
    // НОВАЯ УПРОЩЁННАЯ ЛОГИКА: всегда сортируем по sort_number,
    // группируя материалы сразу после их родительских работ

    const result: BoqItemFull[] = [];
    const processedIds = new Set<string>();

    // Сортируем все элементы по sort_number
    const sortedItems = [...items].sort((a, b) => {
      const aSortNum = a.sort_number ?? 0;
      const bSortNum = b.sort_number ?? 0;
      return aSortNum - bSortNum;
    });

    console.log('[sortItemsByHierarchy] Первые 3 после сортировки по sort_number:');
    sortedItems.slice(0, 3).forEach((item, index) => {
      console.log(`  ${index}:`, {
        sort_number: item.sort_number,
        name: (item as any).work_names?.name || (item as any).material_names?.name,
        type: item.boq_item_type,
      });
    });

    // Проходим по отсортированным элементам
    sortedItems.forEach(item => {
      if (processedIds.has(item.id)) return;

      result.push(item);
      processedIds.add(item.id);

      // Если это работа с привязанными материалами, добавляем материалы сразу после работы
      if (['раб', 'суб-раб', 'раб-комп.'].includes(item.boq_item_type)) {
        const linkedMaterials = items
          .filter(m => m.parent_work_item_id === item.id && !processedIds.has(m.id))
          .sort((a, b) => (a.sort_number ?? 0) - (b.sort_number ?? 0));

        linkedMaterials.forEach(mat => {
          result.push(mat);
          processedIds.add(mat.id);
        });
      }
    });

    console.log('[sortItemsByHierarchy] Первые 3 в финальном результате:');
    result.slice(0, 3).forEach((item, index) => {
      console.log(`  ${index}:`, {
        sort_number: item.sort_number,
        name: (item as any).work_names?.name || (item as any).material_names?.name,
        type: item.boq_item_type,
      });
    });

    return result;
  };

  const fetchItems = async () => {
    setLoading(true);
    try {
      let rates = currencyRates;

      const { data: positionRatesData, error: positionRatesError } = await supabase
        .from('client_positions')
        .select('tenders(usd_rate, eur_rate, cny_rate)')
        .eq('id', positionId)
        .single();

      if (positionRatesError) throw positionRatesError;

      const tenderRates = Array.isArray(positionRatesData?.tenders)
        ? positionRatesData.tenders[0]
        : positionRatesData?.tenders;

      if (tenderRates) {
        rates = {
          usd: tenderRates.usd_rate || 0,
          eur: tenderRates.eur_rate || 0,
          cny: tenderRates.cny_rate || 0,
        };
        setCurrencyRates(rates);
      }

      const { data, error } = await supabase
        .from('boq_items')
        .select(`
          *,
          material_names(name, unit),
          work_names(name, unit),
          parent_work:parent_work_item_id(work_names(name)),
          detail_cost_categories(name, cost_categories(name), location)
        `)
        .eq('client_position_id', positionId)
        .order('sort_number', { ascending: true });

      if (error) throw error;

      // Логирование первых 3 элементов для отладки порядка
      if (data && data.length > 0) {
        console.log('[fetchItems] Первые 3 элемента из БД:');
        data.slice(0, 3).forEach((item, index) => {
          console.log(`  ${index}:`, {
            sort_number: item.sort_number,
            name: item.work_names?.name || item.material_names?.name,
            type: item.boq_item_type,
          });
        });
      }

      const materialIds = (data || [])
        .filter(item => item.material_name_id)
        .map(item => item.material_name_id);

      const workIds = (data || [])
        .filter(item => item.work_name_id)
        .map(item => item.work_name_id);

      let materialRates: Record<string, number> = {};
      let workRates: Record<string, number> = {};

      if (materialIds.length > 0) {
        const { data: matData } = await supabase
          .from('materials_library')
          .select('material_name_id, unit_rate')
          .in('material_name_id', materialIds);

        materialRates = (matData || []).reduce((acc, item) => {
          acc[item.material_name_id] = item.unit_rate;
          return acc;
        }, {} as Record<string, number>);
      }

      if (workIds.length > 0) {
        const { data: workData } = await supabase
          .from('works_library')
          .select('work_name_id, unit_rate')
          .in('work_name_id', workIds);

        workRates = (workData || []).reduce((acc, item) => {
          acc[item.work_name_id] = item.unit_rate;
          return acc;
        }, {} as Record<string, number>);
      }

      const formattedItems: BoqItemFull[] = (data || []).map((item: any) => {
        let detailCostCategoryFull = '-';
        if (item.detail_cost_categories) {
          const categoryName = item.detail_cost_categories.cost_categories?.name || '';
          const detailName = item.detail_cost_categories.name || '';
          const location = item.detail_cost_categories.location || '';
          detailCostCategoryFull = `${categoryName} / ${detailName} / ${location}`;
        }

        return {
          ...item,
          material_name: item.material_names?.name,
          material_unit: item.material_names?.unit,
          work_name: item.work_names?.name,
          work_unit: item.work_names?.unit,
          parent_work_name: item.parent_work?.work_names?.name,
          detail_cost_category_full: detailCostCategoryFull,
          unit_rate: (item.unit_rate !== null && item.unit_rate !== undefined)
            ? item.unit_rate
            : (item.material_name_id
              ? materialRates[item.material_name_id]
              : workRates[item.work_name_id]),
          total_amount: calculateBoqItemTotalAmount(
            {
              ...item,
              unit_rate: (item.unit_rate !== null && item.unit_rate !== undefined)
                ? item.unit_rate
                : (item.material_name_id
                  ? materialRates[item.material_name_id]
                  : workRates[item.work_name_id]),
            },
            {
              usd_rate: rates.usd,
              eur_rate: rates.eur,
              cny_rate: rates.cny,
            }
          ),
        };
      });

      const sortedItems = sortItemsByHierarchy(formattedItems);
      setItems(sortedItems);
    } catch (error) {
      message.error('Ошибка загрузки элементов: ' + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const fetchWorks = async () => {
    try {
      const { data, error } = await supabase
        .from('works_library')
        .select('*, work_names(name, unit)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formatted: WorkLibraryFull[] = (data || []).map((item: any) => ({
        ...item,
        work_name: item.work_names?.name,
        unit: item.work_names?.unit,
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

      const formatted: MaterialLibraryFull[] = (data || []).map((item: any) => ({
        ...item,
        material_name: item.material_names?.name,
        unit: item.material_names?.unit,
      }));

      setMaterials(formatted);
    } catch (error) {
      message.error('Ошибка загрузки материалов: ' + getErrorMessage(error));
    }
  };

  const fetchTemplates = async () => {
    try {
      // Загружаем шаблоны с категориями затрат
      const { data: templatesData, error: templatesError } = await supabase
        .from('templates')
        .select(`
          id,
          name,
          detail_cost_category_id,
          detail_cost_categories(name, location, cost_categories(name))
        `)
        .order('name', { ascending: true });

      if (templatesError) throw templatesError;

      // Преобразуем данные, добавляя detail_cost_category_full
      const templatesWithCategories = (templatesData || []).map((template: any) => {
        let detailCostCategoryFull = null;

        if (template.detail_cost_categories) {
          const categoryName = template.detail_cost_categories.cost_categories?.name || '';
          const detailName = template.detail_cost_categories.name || '';
          const location = template.detail_cost_categories.location || '';
          detailCostCategoryFull = `${categoryName} / ${detailName} / ${location}`;
        }

        return {
          id: template.id,
          name: template.name,
          detail_cost_category_id: template.detail_cost_category_id,
          detail_cost_category_full: detailCostCategoryFull,
        };
      });

      setTemplates(templatesWithCategories);
    } catch (error) {
      message.error('Ошибка загрузки шаблонов: ' + getErrorMessage(error));
    }
  };

  const fetchCostCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('detail_cost_categories')
        .select(`
          id,
          name,
          cost_category_id,
          location,
          cost_categories(name)
        `)
        .order('order_num', { ascending: true });

      if (error) throw error;

      const options = (data || []).map((item: any) => ({
        value: item.id,
        label: `${item.cost_categories?.name} / ${item.name} / ${item.location}`,
        cost_category_name: item.cost_categories?.name || '',
        location: item.location || '',
      }));

      setCostCategories(options);
    } catch (error) {
      message.error('Ошибка загрузки категорий затрат: ' + getErrorMessage(error));
    }
  };

  const fetchWorkNames = async () => {
    try {
      let allWorks: WorkName[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('work_names')
          .select('*')
          .order('name', { ascending: true })
          .range(from, from + batchSize - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          allWorks = [...allWorks, ...data];
          from += batchSize;
          hasMore = data.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      setWorkNames(allWorks);
    } catch (error) {
      message.error('Ошибка загрузки наименований работ: ' + getErrorMessage(error));
    }
  };

  const fetchMaterialNames = async () => {
    try {
      let allMaterials: MaterialName[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('material_names')
          .select('*')
          .order('name', { ascending: true })
          .range(from, from + batchSize - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          allMaterials = [...allMaterials, ...data];
          from += batchSize;
          hasMore = data.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      setMaterialNames(allMaterials);
    } catch (error) {
      message.error('Ошибка загрузки наименований материалов: ' + getErrorMessage(error));
    }
  };

  const fetchUnits = async () => {
    try {
      const { data, error } = await supabase
        .from('units')
        .select('code, name')
        .order('code', { ascending: true });

      if (error) throw error;
      setUnits(data || []);
    } catch (error) {
      console.error('Ошибка загрузки единиц измерения:', error);
    }
  };

  useEffect(() => {
    if (positionId) {
      fetchPositionData();
      fetchItems();
      fetchWorks();
      fetchMaterials();
      fetchTemplates();
      fetchCostCategories();
      fetchWorkNames();
      fetchMaterialNames();
      fetchUnits();
    }
    // fetch functions are stable; intentionally excluded to avoid refetch loop on positionId change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionId]);

  return {
    position,
    items,
    works,
    materials,
    templates,
    loading,
    currencyRates,
    costCategories,
    workNames,
    materialNames,
    units,
    gpVolume,
    setGpVolume,
    gpNote,
    setGpNote,
    workName,
    setWorkName,
    unitCode,
    setUnitCode,
    getCurrencyRate,
    fetchPositionData,
    fetchItems,
  };
};
