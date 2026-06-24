import { useState, useEffect } from 'react';
import { message } from 'antd';
import { useRealtimeAwareLoading } from '../../../lib/realtime/useRealtimeAwareLoading';
import type { UnitType, BoqItemType } from '../../../lib/supabase';
import { fetchTenders as apiFetchTenders } from '../../../lib/api/tenders';
import { listAllBoqItemsForTender } from '../../../lib/api/fi';
import { listDetailCostCategoriesWithCategory } from '../../../lib/api/costs';
import { listMaterialNames, listWorkNames } from '../../../lib/api/nomenclatures';
import { apiFetch } from '../../../lib/api/client';
import { useRealtimeTopic } from '../../../lib/realtime/useRealtimeTopic';
import type { BoqItemData, Tender, TenderOption } from '../types';

const shouldFilterArchived = false;

export function useBsmData() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [selectedTenderTitle, setSelectedTenderTitle] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [loading, setLoading] = useRealtimeAwareLoading(false);
  const [allItems, setAllItems] = useState<BoqItemData[]>([]);

  const fetchTenders = async () => {
    try {
      const data = await apiFetchTenders();
      setTenders(
        data.map((t) => ({
          id: t.id,
          title: t.title,
          tender_number: t.tender_number,
          client_name: t.client_name,
          version: t.version ?? undefined,
          is_archived: t.is_archived ?? undefined,
        })),
      );
    } catch (error) {
      console.error('Error fetching tenders:', error);
      message.error('Ошибка загрузки тендеров');
    }
  };

  // Загрузка boq_items тендера через Go + резолв имён работ/материалов.
  const loadTenderBoqRaw = async (tenderId: string) => {
    const [items, mats, works] = await Promise.all([
      listAllBoqItemsForTender(tenderId),
      listMaterialNames(),
      listWorkNames(),
    ]);
    const matMap = new Map(mats.map((m) => [m.id, m]));
    const workMap = new Map(works.map((wk) => [wk.id, wk]));
    return items.map((i) => {
      const matRow = i.material_name_id ? matMap.get(i.material_name_id) : undefined;
      const workRow = i.work_name_id ? workMap.get(i.work_name_id) : undefined;
      return {
        id: i.id,
        boq_item_type: i.boq_item_type as string,
        material_type: (i.material_type ?? null) as string | null,
        quantity: i.quantity ?? null,
        // boq-items-flat не отдаёт unit_code → резолвим из справочника номенклатуры
        unit_code: ((i.unit_code as string) || workRow?.unit || matRow?.unit || '') as string,
        total_amount: i.total_amount ?? null,
        work_name_id: i.work_name_id ?? null,
        material_name_id: i.material_name_id ?? null,
        quote_link: i.quote_link ?? null,
        detail_cost_category_id: i.detail_cost_category_id ?? null,
        work_names: workRow ? { name: workRow.name } : null,
        material_names: matRow ? { name: matRow.name } : null,
      };
    });
  };

  const getTenderTitles = (): TenderOption[] => {
    const uniqueTitles = new Map<string, TenderOption>();
    const filteredTenders = shouldFilterArchived ? tenders.filter(t => !t.is_archived) : tenders;
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

  const getVersionsForTitle = (title: string): { value: number; label: string }[] => {
    const filtered = shouldFilterArchived
      ? tenders.filter(tender => tender.title === title && !tender.is_archived)
      : tenders.filter(tender => tender.title === title);
    return filtered
      .map(tender => ({ value: tender.version || 1, label: `Версия ${tender.version || 1}` }))
      .sort((a, b) => b.value - a.value);
  };

  // Fetch BOQ items for selected tender (группировка по материал/работа + затрата).
  const fetchBoqItems = async (tenderId: string) => {
    setLoading(true);
    try {
      const categories = await listDetailCostCategoriesWithCategory();
      const expenseMap = new Map<string, string>();
      categories.forEach((cat) => {
        const catName = cat.cost_categories?.name || '';
        const label = [catName, cat.name, (cat as { location?: string | null }).location]
          .filter(Boolean)
          .join(' / ');
        expenseMap.set(cat.id, label);
      });

      interface RawBoqItem {
        id: string;
        boq_item_type: string;
        material_type: string | null;
        quantity: number | null;
        unit_code: string;
        total_amount: number | null;
        work_name_id: string | null;
        material_name_id: string | null;
        quote_link: string | null;
        detail_cost_category_id: string | null;
        work_names: { name: string } | null;
        material_names: { name: string } | null;
      }
      const data: RawBoqItem[] = await loadTenderBoqRaw(tenderId);

      const grouped = new Map<string, BoqItemData>();
      data?.forEach((item: RawBoqItem) => {
        const name = item.work_names?.name || item.material_names?.name || '—';
        const expenseKey = item.detail_cost_category_id || '';
        const key = `${item.boq_item_type}_${item.work_name_id || item.material_name_id}_${expenseKey}`;

        if (grouped.has(key)) {
          const existing = grouped.get(key)!;
          existing.total_quantity += item.quantity || 0;
          existing.total_amount += item.total_amount || 0;
          existing.usage_count += 1;
        } else {
          const expenseLabel = item.detail_cost_category_id
            ? (expenseMap.get(item.detail_cost_category_id) || '—')
            : '—';
          grouped.set(key, {
            id: key,
            boq_item_type: item.boq_item_type as BoqItemType,
            material_type: item.material_type as 'основн.' | 'вспомогат.' | undefined,
            name,
            total_quantity: item.quantity || 0,
            unit_code: item.unit_code as UnitType,
            price_per_unit: item.total_amount && item.quantity ? (item.total_amount / item.quantity) : 0,
            total_amount: item.total_amount || 0,
            usage_count: 1,
            quote_link: item.quote_link || '',
            work_name_id: item.work_name_id ?? undefined,
            material_name_id: item.material_name_id ?? undefined,
            detail_cost_category_id: item.detail_cost_category_id ?? undefined,
            expense_label: expenseLabel,
          });
        }
      });

      const formatted = Array.from(grouped.values()).map(item => ({
        ...item,
        price_per_unit: item.total_quantity > 0 ? (item.total_amount / item.total_quantity) : 0,
      }));

      setAllItems(formatted);
    } catch (error) {
      console.error('Error fetching BOQ items:', error);
      message.error('Ошибка загрузки позиций');
    } finally {
      setLoading(false);
    }
  };

  const handleTenderTitleChange = (title: string) => {
    setSelectedTenderTitle(title);
    const versionsOfTitle = (shouldFilterArchived
      ? tenders.filter(t => t.title === title && !t.is_archived)
      : tenders.filter(t => t.title === title)
    ).sort((a, b) => (b.version || 1) - (a.version || 1));
    if (versionsOfTitle.length > 0) {
      const latest = versionsOfTitle[0];
      setSelectedVersion(latest.version || 1);
      setSelectedTenderId(latest.id);
      fetchBoqItems(latest.id);
    } else {
      setSelectedTenderId(null);
      setSelectedVersion(null);
      setAllItems([]);
    }
  };

  const handleVersionChange = (version: number) => {
    setSelectedVersion(version);
    const tender = tenders.find(t => t.title === selectedTenderTitle && t.version === version);
    if (tender) {
      setSelectedTenderId(tender.id);
      fetchBoqItems(tender.id);
    }
  };

  // Inline-обновление ссылки на КП: апдейтит все boq_items с тем же материалом/работой.
  const handleUpdateQuoteLink = async (record: BoqItemData, newQuoteLink: string) => {
    try {
      const updateField = record.material_name_id ? 'material_name_id' : 'work_name_id';
      const updateValue = record.material_name_id || record.work_name_id;
      if (!updateValue) {
        message.error('Невозможно обновить ссылку: отсутствует ID материала/работы');
        return;
      }
      await apiFetch<{ updated: number }>(
        `/api/v1/tenders/${encodeURIComponent(selectedTenderId!)}/boq/quote-link`,
        {
          method: 'PATCH',
          body: JSON.stringify({ field: updateField, value: updateValue, quote_link: newQuoteLink || null }),
        },
      );
      setAllItems(prevItems =>
        prevItems.map(item => (item.id === record.id ? { ...item, quote_link: newQuoteLink } : item))
      );
      message.success('Ссылка на КП обновлена');
    } catch (error) {
      console.error('Error updating quote link:', error);
      message.error('Ошибка обновления ссылки на КП');
    }
  };

  // Автоматическая простановка ссылок: ищет совпадающие строки и батчем апдейтит.
  const handleApplyQuoteLinks = async () => {
    if (!selectedTenderId) {
      message.error('Не выбран тендер');
      return;
    }
    try {
      setLoading(true);
      const itemsWithLinks = allItems.filter(item => item.quote_link && item.quote_link.trim() !== '');
      if (itemsWithLinks.length === 0) {
        message.warning('Нет ссылок для простановки. Сначала заполните ссылки на КП в таблице.');
        return;
      }

      interface BoqItemForLinkMatch {
        id: string;
        boq_item_type: string;
        material_type: string | null;
        work_name_id: string | null;
        material_name_id: string | null;
        unit_code: string;
        quantity: number | null;
        total_amount: number | null;
        work_names: { name: string } | null;
        material_names: { name: string } | null;
      }
      const boqItems: BoqItemForLinkMatch[] =
        (await loadTenderBoqRaw(selectedTenderId)) as unknown as BoqItemForLinkMatch[];

      let updatedCount = 0;
      for (const sourceItem of itemsWithLinks) {
        const matchingItems = boqItems?.filter((targetItem) => {
          if (targetItem.boq_item_type !== sourceItem.boq_item_type) return false;
          const isMat = ['мат', 'суб-мат', 'мат-комп.'].includes(sourceItem.boq_item_type);
          if (isMat && targetItem.material_type !== sourceItem.material_type) return false;
          const targetName = targetItem.work_names?.name || targetItem.material_names?.name;
          if (targetName !== sourceItem.name) return false;
          if (targetItem.unit_code !== sourceItem.unit_code) return false;
          return true;
        }) || [];

        if (matchingItems.length > 0) {
          const itemIds = matchingItems.map(item => item.id);
          try {
            await apiFetch<{ updated: number }>('/api/v1/boq/quote-link-by-ids', {
              method: 'PATCH',
              body: JSON.stringify({ ids: itemIds, quote_link: sourceItem.quote_link }),
            });
            updatedCount += matchingItems.length;
          } catch (updateError) {
            console.error('Error updating batch:', updateError);
          }
        }
      }

      message.success(`Успешно проставлено ссылок в ${updatedCount} ${updatedCount === 1 ? 'запись' : updatedCount < 5 ? 'записи' : 'записей'}`);
      await fetchBoqItems(selectedTenderId);
    } catch (error) {
      console.error('Error applying quote links:', error);
      message.error('Ошибка простановки ссылок');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenders();
  }, []);

  useEffect(() => {
    if (selectedTenderId) {
      fetchBoqItems(selectedTenderId);
    } else {
      setAllItems([]);
    }
    // fetchBoqItems is stable for our usage; refetch is driven solely by selectedTenderId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenderId]);

  // Native WS hub — список тендеров (topic `tenders`) и BOQ выбранного тендера.
  useRealtimeTopic('tenders', () => {
    void fetchTenders();
  });
  useRealtimeTopic(
    selectedTenderId ? `tender:${selectedTenderId}` : null,
    () => {
      if (selectedTenderId) void fetchBoqItems(selectedTenderId);
    },
    !!selectedTenderId,
  );

  return {
    tenders,
    allItems,
    loading,
    selectedTenderId,
    selectedTenderTitle,
    selectedVersion,
    setSelectedTenderId,
    setSelectedTenderTitle,
    setSelectedVersion,
    getTenderTitles,
    getVersionsForTitle,
    handleTenderTitleChange,
    handleVersionChange,
    fetchBoqItems,
    handleUpdateQuoteLink,
    handleApplyQuoteLinks,
  };
}
