import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import type { BoqItemAudit, AuditFilters } from '../../../types/audit';

interface UseAuditHistoryReturn {
  auditRecords: BoqItemAudit[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Хук для загрузки истории изменений BOQ items по позиции заказчика
 *
 * @param positionId - ID позиции заказчика
 * @param filters - Фильтры для поиска
 * @returns История изменений с методом refetch
 */
export function useAuditHistory(
  positionId: string | undefined,
  filters: AuditFilters
): UseAuditHistoryReturn {
  const [auditRecords, setAuditRecords] = useState<BoqItemAudit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchAudit = async () => {
    if (!positionId) {
      setAuditRecords([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Загрузить audit записи напрямую по client_position_id из JSON полей
      // Это позволяет видеть записи DELETE (удаленные элементы больше не в boq_items)
      let query = supabase
        .from('boq_items_audit')
        .select(
          `
          *,
          user:changed_by(id, full_name, email)
        `
        )
        .or(`new_data->>client_position_id.eq.${positionId},old_data->>client_position_id.eq.${positionId}`)
        .order('changed_at', { ascending: false });

      // Применить фильтры
      if (filters.dateFrom) {
        query = query.gte('changed_at', filters.dateFrom);
      }

      if (filters.dateTo) {
        query = query.lte('changed_at', filters.dateTo);
      }

      if (filters.userId) {
        query = query.eq('changed_by', filters.userId);
      }

      if (filters.operationType) {
        query = query.eq('operation_type', filters.operationType);
      }

      const { data, error: auditError } = await query;

      if (auditError) throw auditError;

      // Трансформация данных: user из joined объекта
      let transformedData: BoqItemAudit[] = (data || []).map((record) => ({
        ...record,
        user: Array.isArray(record.user) ? record.user[0] : record.user,
      }));

      // Шаг 3: Загрузить названия работ, материалов и затрат
      const workNameIds = new Set<string>();
      const materialNameIds = new Set<string>();
      const costCategoryIds = new Set<string>();

      transformedData.forEach((record) => {
        const itemData = record.new_data || record.old_data;
        if (itemData) {
          if (itemData.work_name_id) {
            workNameIds.add(itemData.work_name_id);
          }
          if (itemData.material_name_id) {
            materialNameIds.add(itemData.material_name_id);
          }
          if (itemData.detail_cost_category_id) {
            costCategoryIds.add(itemData.detail_cost_category_id);
          }
        }

        // Также проверяем changed_fields для detail_cost_category_id
        if (record.old_data?.detail_cost_category_id) {
          costCategoryIds.add(record.old_data.detail_cost_category_id);
        }
        if (record.new_data?.detail_cost_category_id) {
          costCategoryIds.add(record.new_data.detail_cost_category_id);
        }
      });

      // Загрузить названия работ
      const workNamesMap = new Map<string, string>();
      if (workNameIds.size > 0) {
        const { data: workNames } = await supabase
          .from('work_names')
          .select('id, name')
          .in('id', Array.from(workNameIds));

        workNames?.forEach((wn) => {
          workNamesMap.set(wn.id, wn.name);
        });
      }

      // Загрузить названия материалов
      const materialNamesMap = new Map<string, string>();
      if (materialNameIds.size > 0) {
        const { data: materialNames } = await supabase
          .from('material_names')
          .select('id, name')
          .in('id', Array.from(materialNameIds));

        materialNames?.forEach((mn) => {
          materialNamesMap.set(mn.id, mn.name);
        });
      }

      // Загрузить названия затрат
      const costCategoriesMap = new Map<string, string>();
      if (costCategoryIds.size > 0) {
        const { data: costCategories, error: costCategoriesError } = await supabase
          .from('detail_cost_categories')
          .select('id, name')
          .in('id', Array.from(costCategoryIds));

        if (costCategoriesError) {
          console.error('[useAuditHistory] Error loading cost categories:', costCategoriesError);
        }

        costCategories?.forEach((cc) => {
          costCategoriesMap.set(cc.id, cc.name);
        });
      }

      // Добавить названия к каждой записи
      transformedData = transformedData.map((record) => {
        const itemData = record.new_data || record.old_data;
        let item_name = '-';

        if (itemData) {
          const workNameId = itemData.work_name_id;
          const materialNameId = itemData.material_name_id;

          if (workNameId && workNamesMap.has(workNameId)) {
            item_name = workNamesMap.get(workNameId)!;
          } else if (materialNameId && materialNamesMap.has(materialNameId)) {
            item_name = materialNamesMap.get(materialNameId)!;
          }
        }

        return {
          ...record,
          item_name,
          cost_categories_map: costCategoriesMap,
          work_names_map: workNamesMap,
          material_names_map: materialNamesMap,
        };
      });

      setAuditRecords(transformedData);
    } catch (err) {
      console.error('[useAuditHistory] Ошибка загрузки истории:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
      setAuditRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionId, filters.dateFrom, filters.dateTo, filters.userId, filters.operationType]);

  return {
    auditRecords,
    loading,
    error,
    refetch: fetchAudit,
  };
}
