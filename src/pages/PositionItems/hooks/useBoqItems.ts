import { useState, useEffect } from 'react';
import { message } from 'antd';
import type {
  ClientPosition,
  BoqItemFull,
  WorkLibraryFull,
  MaterialLibraryFull,
  CurrencyType,
  WorkName,
  MaterialName,
} from '../../../lib/supabase';
import {
  getPositionWithTender,
  listBoqItemsFullByPosition,
} from '../../../lib/api/positions';
import {
  listWorksLibrary,
  listMaterialsLibrary,
  listTemplates,
} from '../../../lib/api/library';
import {
  listWorkNames,
  listMaterialNames,
  listActiveUnits,
} from '../../../lib/api/nomenclatures';
import { listDetailCostCategoriesWithCategory } from '../../../lib/api/costs';
import { calculateBoqItemTotalAmount } from '../../../utils/boq/calculateBoqAmount';
import { getErrorMessage } from '../../../utils/errors';
import { getRow as getCachedPositionRow } from '../../../lib/cache/positionRowCache';

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
    if (!positionId) return;
    try {
      const data = (await getPositionWithTender(positionId)) as unknown as
        (ClientPosition & {
          tenders?: { usd_rate?: number; eur_rate?: number; cny_rate?: number } | null;
        });
      setPosition(data as ClientPosition);

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
        name: (item as { work_names?: { name?: string }; material_names?: { name?: string } }).work_names?.name || (item as { work_names?: { name?: string }; material_names?: { name?: string } }).material_names?.name,
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
        name: (item as { work_names?: { name?: string }; material_names?: { name?: string } }).work_names?.name || (item as { work_names?: { name?: string }; material_names?: { name?: string } }).material_names?.name,
        type: item.boq_item_type,
      });
    });

    return result;
  };

  const fetchItems = async () => {
    if (!positionId) return;
    setLoading(true);
    try {
      let rates = currencyRates;

      // Go: одна запросом одновременно с rates (positions/{id}/with-tender)
      const positionFull = (await getPositionWithTender(positionId)) as unknown as {
        tenders?: { usd_rate?: number; eur_rate?: number; cny_rate?: number } | null;
      };
      const tenderRates = positionFull.tenders ?? null;

      if (tenderRates) {
        rates = {
          usd: tenderRates.usd_rate || 0,
          eur: tenderRates.eur_rate || 0,
          cny: tenderRates.cny_rate || 0,
        };
        setCurrencyRates(rates);
      }

      // Loose shape mirroring the Go nested-embed JSON; field-by-field
      // access below preserves the original supabase-PostgREST mapping.
      type RawBoqItemJoin = {
        id: string;
        material_name_id?: string | null;
        work_name_id?: string | null;
        unit_rate?: number | null;
        material_names?: { name?: string; unit?: string } | null;
        work_names?: { name?: string; unit?: string } | null;
        parent_work?: { work_names?: { name?: string } | null } | null;
        detail_cost_categories?: {
          name?: string;
          location?: string | null;
          cost_categories?: { name?: string } | null;
        } | null;
        [k: string]: unknown;
      };
      const data = (await listBoqItemsFullByPosition(positionId)) as unknown as RawBoqItemJoin[];

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

      // Go: один listMaterialsLibrary / listWorksLibrary (полные списки) —
      // строим словари ставок на клиенте по ids.
      if (materialIds.length > 0) {
        const matIdSet = new Set(materialIds);
        const matData = await listMaterialsLibrary();
        materialRates = matData.reduce((acc, item) => {
          if (item.material_name_id && matIdSet.has(item.material_name_id)) {
            acc[item.material_name_id] = item.unit_rate;
          }
          return acc;
        }, {} as Record<string, number>);
      }

      if (workIds.length > 0) {
        const workIdSet = new Set(workIds);
        const workData = await listWorksLibrary();
        workRates = workData.reduce((acc, item) => {
          if (item.work_name_id && workIdSet.has(item.work_name_id)) {
            acc[item.work_name_id] = item.unit_rate;
          }
          return acc;
        }, {} as Record<string, number>);
      }

      const formattedItems = (data || []).map((item) => {
        let detailCostCategoryFull = '-';
        if (item.detail_cost_categories) {
          const categoryName = item.detail_cost_categories.cost_categories?.name || '';
          const detailName = item.detail_cost_categories.name || '';
          const location = item.detail_cost_categories.location || '';
          detailCostCategoryFull = `${categoryName} / ${detailName} / ${location}`;
        }
        const fallbackRate =
          item.material_name_id
            ? materialRates[item.material_name_id]
            : item.work_name_id
              ? workRates[item.work_name_id]
              : undefined;
        const effectiveUnitRate =
          item.unit_rate !== null && item.unit_rate !== undefined
            ? item.unit_rate
            : fallbackRate;

        return {
          ...item,
          material_name: item.material_names?.name,
          material_unit: item.material_names?.unit,
          work_name: item.work_names?.name,
          work_unit: item.work_names?.unit,
          parent_work_name: item.parent_work?.work_names?.name,
          detail_cost_category_full: detailCostCategoryFull,
          unit_rate: effectiveUnitRate,
          total_amount: calculateBoqItemTotalAmount(
            { ...(item as unknown as BoqItemFull), unit_rate: effectiveUnitRate },
            { usd_rate: rates.usd, eur_rate: rates.eur, cny_rate: rates.cny },
          ),
        };
      }) as unknown as BoqItemFull[];

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
      const data = await listWorksLibrary();
      const formatted = (data || []).map((item) => ({
        ...item,
        work_name: item.work_names?.name,
        unit: item.work_names?.unit,
      })) as unknown as WorkLibraryFull[];
      setWorks(formatted);
    } catch (error) {
      message.error('Ошибка загрузки работ: ' + getErrorMessage(error));
    }
  };

  const fetchMaterials = async () => {
    try {
      const data = await listMaterialsLibrary();
      const formatted = (data || []).map((item) => ({
        ...item,
        material_name: item.material_names?.name,
        unit: item.material_names?.unit,
      })) as unknown as MaterialLibraryFull[];
      setMaterials(formatted);
    } catch (error) {
      message.error('Ошибка загрузки материалов: ' + getErrorMessage(error));
    }
  };

  const fetchTemplates = async () => {
    try {
      const templatesData = await listTemplates();
      // Сервер сортирует по created_at DESC; исходный код ожидал .order('name' asc) —
      // воспроизводим клиентом.
      templatesData.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      const templatesWithCategories = templatesData.map((template) => {
        let detailCostCategoryFull: string | null = null;
        if (template.detail_cost_categories) {
          const dcc = template.detail_cost_categories;
          const categoryName = dcc.cost_categories?.name || '';
          const detailName = dcc.name || '';
          const location = dcc.location || '';
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
      const data = await listDetailCostCategoriesWithCategory();
      const options = (data || []).map((item) => {
        const ccat = Array.isArray(item.cost_categories) ? item.cost_categories[0] : item.cost_categories;
        return {
          value: item.id,
          label: `${ccat?.name} / ${item.name} / ${item.location}`,
          cost_category_name: ccat?.name || '',
          location: item.location || '',
        };
      });
      setCostCategories(options);
    } catch (error) {
      message.error('Ошибка загрузки категорий затрат: ' + getErrorMessage(error));
    }
  };

  const fetchWorkNames = async () => {
    try {
      // Go отдаёт все work_names одним запросом; пагинация убрана.
      const data = await listWorkNames();
      const sorted = [...data].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setWorkNames(sorted as unknown as WorkName[]);
    } catch (error) {
      message.error('Ошибка загрузки наименований работ: ' + getErrorMessage(error));
    }
  };

  const fetchMaterialNames = async () => {
    try {
      const data = await listMaterialNames();
      const sorted = [...data].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setMaterialNames(sorted as unknown as MaterialName[]);
    } catch (error) {
      message.error('Ошибка загрузки наименований материалов: ' + getErrorMessage(error));
    }
  };

  const fetchUnits = async () => {
    try {
      const data = await listActiveUnits();
      const sorted = [...data].sort((a, b) => (a.code || '').localeCompare(b.code || ''));
      setUnits(sorted as unknown as Array<{ code: string; name: string }>);
    } catch (error) {
      console.error('Ошибка загрузки единиц измерения:', error);
    }
  };

  useEffect(() => {
    if (!positionId) return;

    // Hydrate header instantly from the row cache populated on the parent
    // ClientPositions tab. fetchPositionData below still runs to refresh and
    // load currency rates from the joined tenders row.
    const cached = getCachedPositionRow(positionId);
    if (cached) {
      setPosition(cached);
      setGpVolume(cached.manual_volume || 0);
      setGpNote(cached.manual_note || '');
      if (cached.is_additional) {
        setWorkName(cached.work_name || '');
        setUnitCode(cached.unit_code || '');
      }
    }

    fetchPositionData();
    fetchItems();
    fetchWorks();
    fetchMaterials();
    fetchTemplates();
    fetchCostCategories();
    fetchWorkNames();
    fetchMaterialNames();
    fetchUnits();
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
