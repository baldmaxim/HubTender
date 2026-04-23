import { useState, useEffect } from 'react';
import { message } from 'antd';
import { supabase, type Tender } from '../../../../lib/supabase';
import { useRealtimeTopic } from '../../../../lib/realtime/useRealtimeTopic';
import {
  calculateLiveCommercialAmounts,
  loadLiveCommercialCalculationContext,
  resetLiveCommercialCalculationCache,
} from '../../../../utils/boq/liveCommercialCalculation';

export interface CostRow {
  key: string;
  detail_cost_category_id?: string;
  cost_category_name: string;
  detail_category_name: string;
  location_name: string;
  volume: number;
  unit: string;
  materials_cost: number;
  works_cost: number;
  sub_materials_cost: number;
  sub_works_cost: number;
  materials_comp_cost: number;
  works_comp_cost: number;
  total_cost: number;
  cost_per_unit: number;
  order_num?: number;
  is_category?: boolean;
  is_location?: boolean;  // Промежуточный уровень группировки по локализации
  children?: CostRow[];
}

export interface TenderOption {
  value: string;
  label: string;
  clientName: string;
}

export const useCostData = () => {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [selectedTenderTitle, setSelectedTenderTitle] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CostRow[]>([]);
  const [costType, setCostType] = useState<'base' | 'commercial'>('base');

  // Архивные тендеры отображаются в фильтре для всех пользователей
  const shouldFilterArchived = false;

  const getTenderTitles = (): TenderOption[] => {
    const uniqueTitles = new Map<string, TenderOption>();

    const filteredTenders = shouldFilterArchived
      ? tenders.filter(t => !t.is_archived)
      : tenders;

    filteredTenders.forEach(tender => {
      if (!uniqueTitles.has(tender.title)) {
        uniqueTitles.set(tender.title, {
          value: tender.title,
          label: tender.title,
          clientName: tender.client_name,
        });
      }
    });

    return Array.from(uniqueTitles.values());
  };

  const getVersionsForTitle = (title: string) => {
    const filtered = shouldFilterArchived
      ? tenders.filter(t => t.title === title && !t.is_archived)
      : tenders.filter(t => t.title === title);

    return filtered.map(t => ({
      value: t.version || 1,
      label: `Версия ${t.version || 1}`,
    }));
  };

  const handleTenderTitleChange = (title: string) => {
    setSelectedTenderTitle(title);
    // Автоматически выбираем последнюю версию нового тендера
    const versionsOfTitle = tenders
      .filter(t => t.title === title)
      .sort((a, b) => (b.version || 1) - (a.version || 1));
    if (versionsOfTitle.length > 0) {
      const latest = versionsOfTitle[0];
      setSelectedVersion(latest.version || 1);
      setSelectedTenderId(latest.id);
    } else {
      setSelectedVersion(null);
      setSelectedTenderId(null);
      setData([]);
    }
  };

  const handleVersionChange = (version: number) => {
    setSelectedVersion(version);
    const tender = tenders.find(t => t.title === selectedTenderTitle && t.version === version);
    if (tender) {
      setSelectedTenderId(tender.id);
    }
  };

  const fetchTenders = async () => {
    try {
      const { data, error } = await supabase
        .from('tenders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTenders(data || []);
    } catch (error: any) {
      message.error('Ошибка загрузки тендеров: ' + error.message);
    }
  };

  const fetchConstructionCosts = async () => {
    if (!selectedTenderId) return;

    setLoading(true);
    try {
      const { data: categories, error: catError } = await supabase
        .from('detail_cost_categories')
        .select(`
          id,
          name,
          unit,
          location,
          order_num,
          cost_categories (name)
        `)
        .order('order_num', { ascending: true });

      if (catError) throw catError;

      const { data: volumes, error: volError } = await supabase
        .from('construction_cost_volumes')
        .select('*')
        .eq('tender_id', selectedTenderId);

      if (volError) throw volError;

      // Разделяем объемы деталей и групп
      const volumeMap = new Map<string, number>();
      const groupVolumesMap = new Map<string, number>();

      (volumes || []).forEach(v => {
        if (v.detail_cost_category_id) {
          // Объем детали
          volumeMap.set(v.detail_cost_category_id, v.volume || 0);
        } else if (v.group_key) {
          // Объем группы
          groupVolumesMap.set(v.group_key, v.volume || 0);
        }
      });

      console.log('Loaded group volumes from DB:', Array.from(groupVolumesMap.entries()));

      // Загружаем ВСЕ BOQ элементы с батчингом (Supabase лимит 1000 строк)
      let boqItems: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;
      const calculationContext = await loadLiveCommercialCalculationContext(selectedTenderId);

      resetLiveCommercialCalculationCache();

      while (hasMore) {
        const { data, error } = await supabase
          .from('boq_items')
          .select(`
            detail_cost_category_id,
            boq_item_type,
            material_type,
            quantity,
            unit_rate,
            currency_type,
            delivery_price_type,
            delivery_amount,
            consumption_coefficient,
            parent_work_item_id,
            total_amount,
            total_commercial_material_cost,
            total_commercial_work_cost,
            client_positions!inner(tender_id)
          `)
          .eq('client_positions.tender_id', selectedTenderId)
          .range(from, from + batchSize - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          boqItems = [...boqItems, ...data];
          from += batchSize;
          hasMore = data.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      const costMap = new Map<string, {
        materials: number;
        works: number;
        subMaterials: number;
        subWorks: number;
        materialsComp: number;
        worksComp: number;
      }>();

      (boqItems || []).forEach((item: any) => {
        const catId = item.detail_cost_category_id || 'uncategorized';

        if (!costMap.has(catId)) {
          costMap.set(catId, { materials: 0, works: 0, subMaterials: 0, subWorks: 0, materialsComp: 0, worksComp: 0 });
        }

        const costs = costMap.get(catId)!;
        const liveAmounts = calculateLiveCommercialAmounts(item as any, calculationContext);

        if (costType === 'base') {
          const amount = liveAmounts.baseAmount;
          switch (item.boq_item_type) {
            case 'мат':
              costs.materials += amount;
              break;
            case 'суб-мат':
              costs.subMaterials += amount;
              break;
            case 'мат-комп.':
              costs.materialsComp += amount;
              break;
            case 'раб':
              costs.works += amount;
              break;
            case 'суб-раб':
              costs.subWorks += amount;
              break;
            case 'раб-комп.':
              costs.worksComp += amount;
              break;
          }
        } else {
          const materialCost = liveAmounts.materialCost;
          const workCost = liveAmounts.workCost;

          // Просто распределяем по типам элементов
          // total_commercial_material_cost и total_commercial_work_cost уже содержат правильные суммы
          switch (item.boq_item_type) {
            case 'мат':
              costs.materials += materialCost;
              costs.works += workCost;
              break;
            case 'суб-мат':
              costs.subMaterials += materialCost;
              costs.subWorks += workCost;
              break;
            case 'мат-комп.':
              costs.materialsComp += materialCost;
              costs.worksComp += workCost;
              break;
            case 'раб':
              costs.materials += materialCost;
              costs.works += workCost;
              break;
            case 'суб-раб':
              costs.subMaterials += materialCost;
              costs.subWorks += workCost;
              break;
            case 'раб-комп.':
              costs.materialsComp += materialCost;
              costs.worksComp += workCost;
              break;
          }
        }
      });

      // Группируем детальные категории по категориям и локализациям
      const categoryMap = new Map<string, CostRow>();
      const categoryLocations = new Map<string, Set<string>>(); // Для подсчета локализаций

      // Первый проход: собираем детальные строки и определяем структуру
      const detailRowsByCategory = new Map<string, CostRow[]>();

      (categories || []).forEach((cat: any) => {
        const volume = volumeMap.get(cat.id) || 0;
        const costs = costMap.get(cat.id) || { materials: 0, works: 0, subMaterials: 0, subWorks: 0, materialsComp: 0, worksComp: 0 };
        const totalCost = costs.materials + costs.works + costs.subMaterials + costs.subWorks + costs.materialsComp + costs.worksComp;
        const costPerUnit = volume > 0 ? totalCost / volume : 0;

        const categoryName = cat.cost_categories?.name || '';
        const location = cat.location || '';

        const detailRow: CostRow = {
          key: cat.id,
          detail_cost_category_id: cat.id,
          cost_category_name: categoryName,
          detail_category_name: cat.name,
          location_name: location,
          volume,
          unit: cat.unit,
          materials_cost: costs.materials,
          works_cost: costs.works,
          sub_materials_cost: costs.subMaterials,
          sub_works_cost: costs.subWorks,
          materials_comp_cost: costs.materialsComp,
          works_comp_cost: costs.worksComp,
          total_cost: totalCost,
          cost_per_unit: costPerUnit,
          order_num: cat.order_num,
        };

        // Собираем строки по категориям
        if (!detailRowsByCategory.has(categoryName)) {
          detailRowsByCategory.set(categoryName, []);
        }
        detailRowsByCategory.get(categoryName)!.push(detailRow);

        // Собираем уникальные локализации для каждой категории
        if (!categoryLocations.has(categoryName)) {
          categoryLocations.set(categoryName, new Set());
        }
        if (location) {
          categoryLocations.get(categoryName)!.add(location);
        }
      });

      // Кастомный порядок для отделочных работ
      const finishingWorksOrder: Record<string, number> = {
        'Отделка полов': 1,
        'Отделка Стен': 2,
        'Отделка Потолков': 3,
        'навигация': 4,
        'Почтовые ящики': 5,
        'Лифтовые порталы': 6,
        'Мебель': 7,
      };

      // Кастомный порядок для дверей по локализациям
      const doorsOrder: Record<string, Record<string, number>> = {
        'Автостоянка': {
          'Двери тех помещений': 1,
          'двери кладовых': 2,
          'ворота': 3,
          'противопожарные шторы': 4,
        },
        'МОПы': {
          'двери лифтового холла': 1,
          'двери лестничной клетки': 2,
          'двери квартирные': 3,
          'выход на кровлю': 4,
          'люки скрытые': 5,
          'Двери тех помещений': 6,
          'потолочные люки': 7,
        },
        '1-й этаж лобби': {
          'двери скрытого монтажа': 1,
          'двери входные': 2,
        },
      };

      // Функция для определения порядка отделочных работ по частичному совпадению
      const getFinishingWorkOrder = (name: string): number => {
        const lowerName = name.toLowerCase();
        if (lowerName.includes('отделка полов')) return 1;
        if (lowerName.includes('отделка стен')) return 2;
        if (lowerName.includes('отделка потолков')) return 3;
        return finishingWorksOrder[name] || 999;
      };

      const sortDetailRows = (rows: CostRow[], categoryName: string, locationName?: string): CostRow[] => {
        // Для отделочных работ - всегда первые 3 элемента в строгом порядке внутри любой локализации
        if (categoryName.toLowerCase().includes('отделочн')) {
          const priorityItems: CostRow[] = [];
          const otherItems: CostRow[] = [];

          // Разделяем на приоритетные (первые 3) и остальные
          rows.forEach(row => {
            const order = getFinishingWorkOrder(row.detail_category_name);
            if (order <= 3) {
              priorityItems.push(row);
            } else {
              otherItems.push(row);
            }
          });

          // Сортируем приоритетные в строгом порядке 1-2-3
          priorityItems.sort((a, b) => {
            const orderA = getFinishingWorkOrder(a.detail_category_name);
            const orderB = getFinishingWorkOrder(b.detail_category_name);
            return orderA - orderB;
          });

          // Сортируем остальные по своему порядку
          otherItems.sort((a, b) => {
            const orderA = getFinishingWorkOrder(a.detail_category_name);
            const orderB = getFinishingWorkOrder(b.detail_category_name);
            if (orderA !== orderB) return orderA - orderB;
            return (a.order_num || 0) - (b.order_num || 0);
          });

          // Объединяем: сначала приоритетные, потом остальные
          return [...priorityItems, ...otherItems];
        }

        if (categoryName.toLowerCase().includes('двер') && locationName) {
          const locationOrder = doorsOrder[locationName];
          if (locationOrder) {
            return [...rows].sort((a, b) => {
              const orderA = locationOrder[a.detail_category_name] || 999;
              const orderB = locationOrder[b.detail_category_name] || 999;
              if (orderA !== orderB) return orderA - orderB;
              return (a.order_num || 0) - (b.order_num || 0);
            });
          }
        }

        return rows;
      };

      // Второй проход: строим иерархию с учетом локализаций
      for (const [categoryName, detailRows] of detailRowsByCategory.entries()) {
        const locations = categoryLocations.get(categoryName) || new Set();
        const hasMultipleLocations = locations.size > 1;

        // Создаем категорию
        const categoryRow: CostRow = {
          key: `category-${categoryName}`,
          cost_category_name: categoryName,
          detail_category_name: '',
          location_name: '',
          volume: 0,
          unit: '',
          materials_cost: 0,
          works_cost: 0,
          sub_materials_cost: 0,
          sub_works_cost: 0,
          materials_comp_cost: 0,
          works_comp_cost: 0,
          total_cost: 0,
          cost_per_unit: 0,
          is_category: true,
          children: [],
          order_num: detailRows[0]?.order_num || 0,
        };

        if (hasMultipleLocations) {
          // Группируем по локализациям
          const locationGroups = new Map<string, CostRow[]>();

          detailRows.forEach(row => {
            const location = row.location_name || '';
            if (!locationGroups.has(location)) {
              locationGroups.set(location, []);
            }
            locationGroups.get(location)!.push(row);
          });

          // Создаем строки локализаций
          for (const [location, rows] of locationGroups.entries()) {
            const sortedRows = sortDetailRows(rows, categoryName, location);

            const locationRow: CostRow = {
              key: `location-${categoryName}-${location}`,
              cost_category_name: categoryName,
              detail_category_name: '',
              location_name: location,
              volume: 0,
              unit: '',
              materials_cost: 0,
              works_cost: 0,
              sub_materials_cost: 0,
              sub_works_cost: 0,
              materials_comp_cost: 0,
              works_comp_cost: 0,
              total_cost: 0,
              cost_per_unit: 0,
              is_location: true,
              children: sortedRows,
              order_num: sortedRows[0]?.order_num || 0,
            };

            // Суммируем затраты для локализации
            sortedRows.forEach(row => {
              locationRow.materials_cost += row.materials_cost;
              locationRow.works_cost += row.works_cost;
              locationRow.sub_materials_cost += row.sub_materials_cost;
              locationRow.sub_works_cost += row.sub_works_cost;
              locationRow.materials_comp_cost += row.materials_comp_cost;
              locationRow.works_comp_cost += row.works_comp_cost;
              locationRow.total_cost += row.total_cost;
            });

            categoryRow.children!.push(locationRow);

            // Суммируем в категорию
            categoryRow.materials_cost += locationRow.materials_cost;
            categoryRow.works_cost += locationRow.works_cost;
            categoryRow.sub_materials_cost += locationRow.sub_materials_cost;
            categoryRow.sub_works_cost += locationRow.sub_works_cost;
            categoryRow.materials_comp_cost += locationRow.materials_comp_cost;
            categoryRow.works_comp_cost += locationRow.works_comp_cost;
            categoryRow.total_cost += locationRow.total_cost;
          }
        } else {
          // Одна локализация или без локализации - добавляем напрямую
          const sortedRows = sortDetailRows(detailRows, categoryName);
          categoryRow.children = sortedRows;

          // Суммируем в категорию
          sortedRows.forEach(row => {
            categoryRow.materials_cost += row.materials_cost;
            categoryRow.works_cost += row.works_cost;
            categoryRow.sub_materials_cost += row.sub_materials_cost;
            categoryRow.sub_works_cost += row.sub_works_cost;
            categoryRow.materials_comp_cost += row.materials_comp_cost;
            categoryRow.works_comp_cost += row.works_comp_cost;
            categoryRow.total_cost += row.total_cost;
          });
        }

        categoryMap.set(categoryName, categoryRow);
      }

      // Добавляем категорию "Не распределено" если есть items без detail_cost_category_id
      if (costMap.has('uncategorized')) {
        const uncategorizedCosts = costMap.get('uncategorized')!;
        const uncategorizedTotal = uncategorizedCosts.materials + uncategorizedCosts.works +
          uncategorizedCosts.subMaterials + uncategorizedCosts.subWorks +
          uncategorizedCosts.materialsComp + uncategorizedCosts.worksComp;

        if (uncategorizedTotal > 0) {
          categoryMap.set('Не распределено', {
            key: 'category-uncategorized',
            cost_category_name: 'Не распределено',
            detail_category_name: '',
            location_name: '',
            volume: 0,
            unit: '',
            materials_cost: uncategorizedCosts.materials,
            works_cost: uncategorizedCosts.works,
            sub_materials_cost: uncategorizedCosts.subMaterials,
            sub_works_cost: uncategorizedCosts.subWorks,
            materials_comp_cost: uncategorizedCosts.materialsComp,
            works_comp_cost: uncategorizedCosts.worksComp,
            total_cost: uncategorizedTotal,
            cost_per_unit: 0,
            is_category: true,
            children: [{
              key: 'uncategorized-detail',
              cost_category_name: 'Не распределено',
              detail_category_name: 'Элементы без затрат',
              location_name: '-',
              volume: 0,
              unit: '-',
              materials_cost: uncategorizedCosts.materials,
              works_cost: uncategorizedCosts.works,
              sub_materials_cost: uncategorizedCosts.subMaterials,
              sub_works_cost: uncategorizedCosts.subWorks,
              materials_comp_cost: uncategorizedCosts.materialsComp,
              works_comp_cost: uncategorizedCosts.worksComp,
              total_cost: uncategorizedTotal,
              cost_per_unit: 0,
            }],
            order_num: 999999, // В конец списка
          });
        }
      }

      let rows: CostRow[] = Array.from(categoryMap.values()).sort((a, b) =>
        (a.order_num || 0) - (b.order_num || 0)
      );

      // Рекурсивная фильтрация нулевых затрат на всех уровнях
      const filterZeroCosts = (items: CostRow[]): CostRow[] => {
        return items
          .map(item => {
            if (item.children) {
              const filteredChildren = filterZeroCosts(item.children);
              return {
                ...item,
                children: filteredChildren.length > 0 ? filteredChildren : undefined
              };
            }
            return item;
          })
          .filter(item => {
            // Для категорий и локализаций - проверяем наличие children
            if (item.is_category || item.is_location) {
              return item.children && item.children.length > 0;
            }
            // Для деталей - проверяем total_cost
            return item.total_cost > 0;
          });
      };

      rows = filterZeroCosts(rows);

      // Восстанавливаем объемы групп из загруженных значений
      const restoreGroupVolumes = (items: CostRow[], volumesMap: Map<string, number>): CostRow[] => {
        return items.map(item => {
          if ((item.is_category || item.is_location) && volumesMap.has(item.key)) {
            const restoredVolume = volumesMap.get(item.key)!;
            console.log('Restoring volume for group:', item.key, 'volume:', restoredVolume);
            return {
              ...item,
              volume: restoredVolume,
              children: item.children ? restoreGroupVolumes(item.children, volumesMap) : undefined
            };
          }
          if (item.children) {
            return { ...item, children: restoreGroupVolumes(item.children, volumesMap) };
          }
          return item;
        });
      };

      rows = restoreGroupVolumes(rows, groupVolumesMap);
      console.log('Rows after restoring group volumes:', rows.length);

      // Логирование итоговых сумм
      const totalSums = rows.reduce((sum, row) => ({
        materials: sum.materials + row.materials_cost,
        works: sum.works + row.works_cost,
        subMaterials: sum.subMaterials + row.sub_materials_cost,
        subWorks: sum.subWorks + row.sub_works_cost,
        materialsComp: sum.materialsComp + row.materials_comp_cost,
        worksComp: sum.worksComp + row.works_comp_cost,
        total: sum.total + row.total_cost
      }), { materials: 0, works: 0, subMaterials: 0, subWorks: 0, materialsComp: 0, worksComp: 0, total: 0 });

      console.log('\n=== ИТОГОВЫЕ СУММЫ COSTS PAGE (costType=' + costType + ') ===');
      console.log('Материалы:', totalSums.materials.toLocaleString('ru-RU'));
      console.log('Работы:', totalSums.works.toLocaleString('ru-RU'));
      console.log('Суб-материалы:', totalSums.subMaterials.toLocaleString('ru-RU'));
      console.log('Суб-работы:', totalSums.subWorks.toLocaleString('ru-RU'));
      console.log('Комп. материалы:', totalSums.materialsComp.toLocaleString('ru-RU'));
      console.log('Комп. работы:', totalSums.worksComp.toLocaleString('ru-RU'));
      console.log('ИТОГО:', totalSums.total.toLocaleString('ru-RU'));
      console.log('Ожидается: 5,613,631,822');

      setData(rows);
    } catch (error: any) {
      console.error('Ошибка загрузки затрат:', error);
      message.error(`Не удалось загрузить данные затрат: ${error.message || 'Неизвестная ошибка'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleVolumeChange = async (value: number | null, record: CostRow) => {
    if (value === null || value === record.volume) return;

    try {
      // Для деталей - сохраняем в базу с detail_cost_category_id
      if (record.detail_cost_category_id) {
        // Проверяем существование записи
        const { data: existing } = await supabase
          .from('construction_cost_volumes')
          .select('id')
          .eq('tender_id', selectedTenderId!)
          .eq('detail_cost_category_id', record.detail_cost_category_id)
          .single();

        let error;
        if (existing) {
          // Обновляем существующую запись
          ({ error } = await supabase
            .from('construction_cost_volumes')
            .update({ volume: value })
            .eq('tender_id', selectedTenderId!)
            .eq('detail_cost_category_id', record.detail_cost_category_id));
        } else {
          // Создаем новую запись
          ({ error } = await supabase
            .from('construction_cost_volumes')
            .insert({
              tender_id: selectedTenderId!,
              detail_cost_category_id: record.detail_cost_category_id,
              volume: value,
            }));
        }

        if (error) throw error;

        // Обновляем локально без перезагрузки
        setData(prevData => {
          const updateVolume = (rows: CostRow[]): CostRow[] => {
            return rows.map(row => {
              if (row.key === record.key) {
                return { ...row, volume: value };
              }
              if (row.children) {
                return { ...row, children: updateVolume(row.children) };
              }
              return row;
            });
          };
          return updateVolume(prevData);
        });

        message.success('Объем сохранен');
      }
      // Для категорий и локализаций - сохраняем в базу с group_key
      else if (record.is_category || record.is_location) {
        console.log('Saving group volume:', { key: record.key, value, tenderId: selectedTenderId });

        // Проверяем существование записи
        const { data: existing } = await supabase
          .from('construction_cost_volumes')
          .select('id')
          .eq('tender_id', selectedTenderId!)
          .eq('group_key', record.key)
          .maybeSingle();

        console.log('Existing record:', existing);

        let error;
        if (existing) {
          // Обновляем существующую запись
          console.log('Updating existing record');
          ({ error } = await supabase
            .from('construction_cost_volumes')
            .update({ volume: value })
            .eq('tender_id', selectedTenderId!)
            .eq('group_key', record.key));
        } else {
          // Создаем новую запись
          console.log('Creating new record');
          ({ error } = await supabase
            .from('construction_cost_volumes')
            .insert({
              tender_id: selectedTenderId!,
              group_key: record.key,
              volume: value,
            }));
        }

        if (error) {
          console.error('Save error:', error);
          throw error;
        }

        console.log('Group volume saved successfully');

        // Сохраняем в Map
        setGroupVolumes(prev => {
          const newMap = new Map(prev);
          newMap.set(record.key, value);
          return newMap;
        });

        // Обновляем в данных
        setData(prevData => {
          const updateVolume = (rows: CostRow[]): CostRow[] => {
            return rows.map(row => {
              if (row.key === record.key) {
                return { ...row, volume: value };
              }
              if (row.children) {
                return { ...row, children: updateVolume(row.children) };
              }
              return row;
            });
          };
          return updateVolume(prevData);
        });
        message.success('Объем группы сохранен');
      }
    } catch (error: any) {
      message.error('Ошибка сохранения: ' + error.message);
    }
  };

  useEffect(() => {
    fetchTenders();
  }, []);

  useEffect(() => {
    if (selectedTenderId) {
      setGroupVolumes(new Map());
      fetchConstructionCosts();
    }
  }, [selectedTenderId, costType]);

  // Native WS hub (Go BFF) path.
  const wsActive = useRealtimeTopic(
    selectedTenderId ? `tender:${selectedTenderId}` : null,
    () => {
      void fetchConstructionCosts();
    },
  );

  // Supabase Realtime fallback.
  useEffect(() => {
    if (!selectedTenderId || wsActive) return;

    const channel = supabase
      .channel(`construction_costs_${selectedTenderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tenders',
          filter: `id=eq.${selectedTenderId}`,
        },
        () => {
          void fetchConstructionCosts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedTenderId, costType, wsActive]);

  return {
    tenders,
    selectedTenderId,
    selectedTenderTitle,
    selectedVersion,
    loading,
    data,
    costType,
    setCostType,
    setSelectedTenderId,
    setSelectedTenderTitle,
    setSelectedVersion,
    setData,
    getTenderTitles,
    getVersionsForTitle,
    handleTenderTitleChange,
    handleVersionChange,
    fetchConstructionCosts,
    handleVolumeChange,
  };
};
