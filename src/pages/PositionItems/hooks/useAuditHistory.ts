import { useState, useEffect } from 'react';
import { listBoqAuditByPosition } from '../../../lib/api/boq';
import { listWorkNames, listMaterialNames } from '../../../lib/api/nomenclatures';
import { listAllDetailCostCategoriesByOrder } from '../../../lib/api/costs';
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
      // Go: GET /api/v1/boq-audit?position_id=…&… — JSONB-filter
      // (new_data->>client_position_id OR old_data->>client_position_id) +
      // user embed + optional date/user/operation filters.
      const data = await listBoqAuditByPosition({
        positionId,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        userId: filters.userId,
        operationType: filters.operationType,
      });

      let transformedData: BoqItemAudit[] = (data || []).map((record) => ({
        ...(record as unknown as BoqItemAudit),
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

      // Имена/категории — Go-helpers отдают полные списки, фильтруем по ids
      // на клиенте (выборки маленькие, audit-модал открывается редко).
      const workNamesMap = new Map<string, string>();
      if (workNameIds.size > 0) {
        const allWorks = await listWorkNames();
        allWorks.forEach((wn) => {
          if (workNameIds.has(wn.id)) workNamesMap.set(wn.id, wn.name);
        });
      }

      const materialNamesMap = new Map<string, string>();
      if (materialNameIds.size > 0) {
        const allMaterials = await listMaterialNames();
        allMaterials.forEach((mn) => {
          if (materialNameIds.has(mn.id)) materialNamesMap.set(mn.id, mn.name);
        });
      }

      const costCategoriesMap = new Map<string, string>();
      if (costCategoryIds.size > 0) {
        const allCategories = await listAllDetailCostCategoriesByOrder();
        allCategories.forEach((cc) => {
          if (costCategoryIds.has(cc.id)) costCategoriesMap.set(cc.id, cc.name);
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
