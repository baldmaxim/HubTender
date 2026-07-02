import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import {
  type Tender,
  type ClientPosition,
  type CurrencyType,
  type DeliveryPriceType,
} from '../../../lib/types';
import { fetchTenders as apiFetchTenders } from '../../../lib/api/tenders';
import { fetchPositionsWithCosts } from '../../../lib/api/positions';
import { listAllBoqItemsForTender, getTenderById } from '../../../lib/api/fi';
import { invalidateApiCache } from '../../../lib/api/client';
import { useRealtimeRefetch } from '../../../lib/realtime/useRealtimeRefetch';
import { useRealtimeAwareLoading } from '../../../lib/realtime/useRealtimeAwareLoading';
import { getErrorMessage } from '../../../utils/errors';
import {
  readCache as readPositionsCache,
  writeCache as writePositionsCache,
  dropCache as dropPositionsCache,
} from '../../../lib/cache/clientPositionsCache';
import {
  setRows as setRowCacheRows,
  invalidateRow as invalidatePositionRowCache,
} from '../../../lib/cache/positionRowCache';

type PositionCountMap = Record<string, { works: number; materials: number; total: number }>;

type RawBoqItem = {
  client_position_id: string;
  boq_item_type: string;
  total_amount: number | null;
  quantity: number | null;
  unit_rate: number | null;
  currency_type: CurrencyType | null;
  delivery_price_type: DeliveryPriceType | null;
  delivery_amount: number | null;
  consumption_coefficient: number | null;
  parent_work_item_id: string | null;
};

async function loadAllPositions(tenderId: string, fresh?: boolean): Promise<ClientPosition[]> {
  // Go: /tenders/:id/positions/with-costs (ORDER BY position_number,id);
  // пагинация больше не нужна — сервер отдаёт всё.
  const rows = await fetchPositionsWithCosts(tenderId, { fresh });
  return rows as unknown as ClientPosition[];
}

async function loadAllBoqItems(tenderId: string): Promise<RawBoqItem[]> {
  // Go: /tenders/:id/boq-items-flat — все boq_items тендера (суперсет
  // нужных полей; порядок не важен — агрегируется по позициям).
  const rows = await listAllBoqItemsForTender(tenderId);
  return rows as unknown as RawBoqItem[];
}

async function loadTenderById(tenderId: string): Promise<Tender | null> {
  return (await getTenderById(tenderId)) ?? null;
}

function getCurrencyRate(
  currency: CurrencyType | null | undefined,
  tender: Pick<Tender, 'usd_rate' | 'eur_rate' | 'cny_rate'>
): number {
  switch (currency) {
    case 'USD':
      return tender.usd_rate || 0;
    case 'EUR':
      return tender.eur_rate || 0;
    case 'CNY':
      return tender.cny_rate || 0;
    case 'RUB':
    default:
      return 1;
  }
}

function calculateBoqItemAmount(
  item: RawBoqItem,
  tender: Pick<Tender, 'usd_rate' | 'eur_rate' | 'cny_rate'>
): number {
  const quantity = Number(item.quantity) || 0;
  const unitRate = Number(item.unit_rate) || 0;
  const rate = getCurrencyRate(item.currency_type, tender);

  if (['раб', 'суб-раб', 'раб-комп.'].includes(item.boq_item_type)) {
    return quantity * unitRate * rate;
  }

  if (['мат', 'суб-мат', 'мат-комп.'].includes(item.boq_item_type)) {
    let deliveryPrice = 0;

    if (item.delivery_price_type === 'не в цене') {
      deliveryPrice = unitRate * rate * 0.03;
    } else if (item.delivery_price_type === 'суммой') {
      deliveryPrice = Number(item.delivery_amount) || 0;
    }

    const consumptionCoefficient = item.parent_work_item_id
      ? 1
      : Number(item.consumption_coefficient) || 1;

    return quantity * consumptionCoefficient * (unitRate * rate + deliveryPrice);
  }

  return Number(item.total_amount) || 0;
}

function buildPositionStats(
  boqItems: RawBoqItem[],
  tender: Pick<Tender, 'usd_rate' | 'eur_rate' | 'cny_rate'> | null
): { counts: PositionCountMap; totalSum: number } {
  const counts: PositionCountMap = {};
  let totalSum = 0;

  for (const item of boqItems) {
    if (!counts[item.client_position_id]) {
      counts[item.client_position_id] = { works: 0, materials: 0, total: 0 };
    }

    if (['раб', 'суб-раб', 'раб-комп.'].includes(item.boq_item_type)) {
      counts[item.client_position_id].works++;
    } else if (['мат', 'суб-мат', 'мат-комп.'].includes(item.boq_item_type)) {
      counts[item.client_position_id].materials++;
    }

    const amount = tender
      ? calculateBoqItemAmount(item, tender)
      : (Number(item.total_amount) || 0);

    counts[item.client_position_id].total += amount;
    totalSum += amount;
  }

  return { counts, totalSum };
}

export const useClientPositions = () => {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTender, setSelectedTender] = useState<Tender | null>(null);
  const [clientPositions, setClientPositions] = useState<ClientPosition[]>([]);
  const [loading, setLoading] = useRealtimeAwareLoading(false);
  const [positionCounts, setPositionCounts] = useState<PositionCountMap>({});
  const [totalSum, setTotalSum] = useState<number>(0);
  const [leafPositionIndices, setLeafPositionIndices] = useState<Set<string>>(new Set());

  const fetchTenders = useCallback(async () => {
    try {
      const data = await apiFetchTenders();
      setTenders((data as Tender[]) || []);
    } catch (error) {
      message.error('Ошибка загрузки тендеров: ' + getErrorMessage(error));
    }
  }, []);

  useEffect(() => {
    void fetchTenders();
  }, [fetchTenders]);

  const computeLeafPositions = (positions: ClientPosition[]): Set<string> => {
    const leafIds = new Set<string>();

    positions.forEach((position, index) => {
      if (index === positions.length - 1) {
        leafIds.add(position.id);
        return;
      }

      const currentLevel = position.hierarchy_level || 0;
      let nextIndex = index + 1;

      while (nextIndex < positions.length && positions[nextIndex].is_additional) {
        nextIndex++;
      }

      if (nextIndex >= positions.length) {
        leafIds.add(position.id);
        return;
      }

      if (currentLevel >= (positions[nextIndex].hierarchy_level || 0)) {
        leafIds.add(position.id);
      }
    });

    return leafIds;
  };

  const applyAggregate = useCallback(
    (positions: ClientPosition[], boqItems: RawBoqItem[], tender: Tender | null) => {
      setClientPositions(positions);
      setLeafPositionIndices(computeLeafPositions(positions));
      setRowCacheRows(positions);

      if (tender) {
        setSelectedTender(tender);
      }

      const { counts, totalSum: nextTotalSum } = buildPositionStats(boqItems, tender);
      setPositionCounts(counts);
      setTotalSum(nextTotalSum);
    },
    [],
  );

  // Tracks the timestamp of the last successful fetch per tenderId so that
  // refetches triggered by mutations (within RECENT_FETCH_MS) bypass the SWR
  // cache and avoid a stale-flash. First mount or revisits after the window
  // still benefit from instant cached render.
  const recentlyFetchedRef = useRef<Map<string, number>>(new Map());
  const RECENT_FETCH_MS = 30_000;

  // Native WS hub (Go BFF) — обновляем кеш + позиции при изменении тендера.
  // markLocalMutation() вызывается в оптимистичных мутациях ниже, чтобы подавить
  // self-echo: наша же мутация шлёт NOTIFY, который через ~200 мс возвращается
  // WS-событием. Правки других пользователей приходят позже и не теряются.
  const { markLocalMutation } = useRealtimeRefetch(
    selectedTender?.id ? `tender:${selectedTender.id}` : null,
    () => {
      if (!selectedTender?.id) return;
      dropPositionsCache(selectedTender.id);
      invalidateApiCache(`positions:${selectedTender.id}`);
      void fetchTenders();
      // fresh: минуем серверный кэш positions/with-costs, чтобы примечание ГП
      // обновлялось онлайн так же, как сумма/строки (см. план).
      void fetchClientPositions(selectedTender.id, { fresh: true });
    },
    // selfEchoOnly: таблица и детальная вкладка PositionItems оба keep-alive и
    // подписаны на tender:<id>. Правка примечания в PositionItems штампует общий
    // модульный реестр и иначе глушила бы рефетч таблицы. Своё эхо таблицы по-
    // прежнему подавляется через mutatedAtRef (markLocalMutation).
    { selfEchoOnly: true },
  );

  // Оптимистичное обнуление работ/материалов у позиций (clear-boq): строки
  // получают works=0/materials=0/total=0, итоги строки обнуляются. Избавляет
  // от полного рефетча тендера на каждую очистку.
  const applyLocalBoqClear = useCallback(
    (positionIds: string[]) => {
      const ids = new Set(positionIds);
      markLocalMutation();

      let removed = 0;
      const nextCounts: PositionCountMap = { ...positionCounts };
      for (const id of ids) {
        if (nextCounts[id]) removed += nextCounts[id].total;
        nextCounts[id] = { works: 0, materials: 0, total: 0 };
      }
      setPositionCounts(nextCounts);
      setTotalSum((s) => Math.max(0, s - removed));

      const nextPositions = clientPositions.map((p) =>
        ids.has(p.id)
          ? {
              ...p,
              total_material: 0,
              total_works: 0,
              total_commercial_material: 0,
              total_commercial_work: 0,
              material_cost_per_unit: 0,
              work_cost_per_unit: 0,
              total_commercial_material_per_unit: 0,
              total_commercial_work_per_unit: 0,
            }
          : p,
      );
      setRowCacheRows(nextPositions);
      setClientPositions(nextPositions);
      // leafPositionIndices при очистке BOQ не меняется (порядок/иерархия те же).
    },
    [positionCounts, clientPositions, markLocalMutation],
  );

  // Оптимистичное проставление «примечания ГП» (manual_note) у выбранных
  // позиций без полного рефетча тендера: запись note не влияет на
  // works/materials/total, поэтому достаточно подменить поле в state.
  // markLocalMutation() гасит self-echo WS (NOTIFY от UPDATE), иначе тяжёлый
  // fetchClientPositions снова дёрнется и упрётся в 10-сек таймаут.
  const applyLocalNoteUpdate = useCallback(
    (positionIds: string[], note: string) => {
      const ids = new Set(positionIds);
      markLocalMutation();

      const nextPositions = clientPositions.map((p) =>
        ids.has(p.id) ? { ...p, manual_note: note } : p,
      );
      setRowCacheRows(nextPositions);
      setClientPositions(nextPositions);
    },
    [clientPositions, markLocalMutation],
  );

  // Оптимистичное удаление строк целиком (ДОП / массовое удаление строк
  // заказчика). На бэке это два DELETE без перенумерации сиблингов, поэтому
  // локальное удаление строки полностью корректно.
  const applyLocalPositionRemove = useCallback(
    (positionIds: string[]) => {
      const ids = new Set(positionIds);
      markLocalMutation();

      let removed = 0;
      const nextCounts: PositionCountMap = { ...positionCounts };
      for (const id of ids) {
        if (nextCounts[id]) removed += nextCounts[id].total;
        delete nextCounts[id];
      }
      setPositionCounts(nextCounts);
      setTotalSum((s) => Math.max(0, s - removed));

      const nextPositions = clientPositions.filter((p) => !ids.has(p.id));
      setRowCacheRows(nextPositions);
      setClientPositions(nextPositions);
      setLeafPositionIndices(computeLeafPositions(nextPositions));

      for (const id of ids) invalidatePositionRowCache(id);
    },
    [positionCounts, clientPositions, markLocalMutation],
  );

  const fetchClientPositions = useCallback(
    async (tenderId: string, opts?: { fresh?: boolean }) => {
      const recentTs = recentlyFetchedRef.current.get(tenderId);
      const fetchedRecently = recentTs !== undefined && Date.now() - recentTs < RECENT_FETCH_MS;

      if (fetchedRecently) {
        // Свежий refetch: дропаем и module-cache, и apiFetch ETag (иначе
        // GET вернёт 304 со старым телом после только что прошедшей мутации).
        dropPositionsCache(tenderId);
        invalidateApiCache(`positions:${tenderId}`);
        setLoading(true);
      } else {
        const cached = readPositionsCache<ClientPosition[], RawBoqItem[], Tender | null>(tenderId);
        if (cached) {
          applyAggregate(cached.positions, cached.boqItems, cached.tender);
        } else {
          setLoading(true);
        }
      }

      try {
        const [positions, boqItems, tender] = await Promise.all([
          loadAllPositions(tenderId, opts?.fresh),
          loadAllBoqItems(tenderId),
          loadTenderById(tenderId),
        ]);

        applyAggregate(positions, boqItems, tender);
        writePositionsCache(tenderId, positions, boqItems, tender);
        recentlyFetchedRef.current.set(tenderId, Date.now());
      } catch (error) {
        message.error('Ошибка загрузки позиций: ' + getErrorMessage(error));
      } finally {
        setLoading(false);
      }
    },
    [applyAggregate, setLoading],
  );

  return {
    tenders,
    selectedTender,
    setSelectedTender,
    clientPositions,
    setClientPositions,
    loading,
    setLoading,
    positionCounts,
    setPositionCounts,
    totalSum,
    setTotalSum,
    leafPositionIndices,
    fetchClientPositions,
    applyLocalBoqClear,
    applyLocalNoteUpdate,
    applyLocalPositionRemove,
  };
};
