/**
 * Хук данных модалки drill-down: позиции заказчика выбранной категории затрат.
 * Считает суммы total_amount boq_items одной detail_cost_category_id,
 * сгруппированные по типу элемента, внутри каждой client_position.
 */
import { useEffect, useState } from 'react';
import { message } from 'antd';
import {
  fetchPositionsWithCosts,
  listBoqItemsFullByTender,
} from '../../../../lib/api/positions';
import { getErrorMessage } from '../../../../utils/errors';

interface BoqItemRow {
  client_position_id?: string | null;
  detail_cost_category_id?: string | null;
  boq_item_type?: string | null;
  total_amount?: number | null;
  client_positions?: { id?: string } | null;
}

export interface CategoryPositionRow {
  id: string;
  position_number: number;
  item_no: string | null;
  work_name: string;
  subWorks: number;
  subMaterials: number;
  works: number;
  materials: number;
  materialsComp: number;
  worksComp: number;
  total: number;
}

interface TypeBuckets {
  subWorks: number;
  subMaterials: number;
  works: number;
  materials: number;
  materialsComp: number;
  worksComp: number;
}

const emptyBuckets = (): TypeBuckets => ({
  subWorks: 0,
  subMaterials: 0,
  works: 0,
  materials: 0,
  materialsComp: 0,
  worksComp: 0,
});

export const useCategoryPositions = (
  tenderId: string | null,
  detailCategoryId: string | null,
) => {
  const [rows, setRows] = useState<CategoryPositionRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenderId || !detailCategoryId) {
      setRows([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [positions, boqItems] = await Promise.all([
          fetchPositionsWithCosts(tenderId),
          listBoqItemsFullByTender(tenderId) as Promise<BoqItemRow[]>,
        ]);

        // Агрегируем суммы выбранной категории по позиции и типу элемента
        const aggMap = new Map<string, TypeBuckets>();

        for (const item of boqItems) {
          if (item.detail_cost_category_id !== detailCategoryId) continue;
          const posId = item.client_position_id ?? item.client_positions?.id;
          if (!posId) continue;

          let acc = aggMap.get(posId);
          if (!acc) {
            acc = emptyBuckets();
            aggMap.set(posId, acc);
          }

          const amount = item.total_amount || 0;
          switch (item.boq_item_type) {
            case 'суб-раб':
              acc.subWorks += amount;
              break;
            case 'суб-мат':
              acc.subMaterials += amount;
              break;
            case 'раб':
              acc.works += amount;
              break;
            case 'мат':
              acc.materials += amount;
              break;
            case 'мат-комп.':
              acc.materialsComp += amount;
              break;
            case 'раб-комп.':
              acc.worksComp += amount;
              break;
          }
        }

        const posById = new Map(positions.map((p) => [p.id, p]));

        const result: CategoryPositionRow[] = [];
        for (const [posId, acc] of aggMap.entries()) {
          const total =
            acc.subWorks +
            acc.subMaterials +
            acc.works +
            acc.materials +
            acc.materialsComp +
            acc.worksComp;
          if (total <= 0) continue;

          const pos = posById.get(posId);
          if (!pos) continue;

          result.push({
            id: posId,
            position_number: pos.position_number,
            item_no: pos.item_no,
            work_name: pos.work_name,
            ...acc,
            total,
          });
        }

        result.sort((a, b) => a.position_number - b.position_number);

        if (!cancelled) setRows(result);
      } catch (error) {
        if (!cancelled) {
          message.error('Не удалось загрузить позиции категории: ' + getErrorMessage(error));
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [tenderId, detailCategoryId]);

  return { rows, loading };
};
