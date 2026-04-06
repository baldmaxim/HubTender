/**
 * Хук для загрузки и управления данными коммерции
 */

import { useState, useEffect, useMemo } from 'react';
import { message } from 'antd';
import { supabase } from '../../../lib/supabase';
import type { Tender } from '../../../lib/supabase';
import type { PositionWithCommercialCost, MarkupTactic } from '../types';

export function useCommerceData() {
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState<string | undefined>();
  const [selectedTenderTitle, setSelectedTenderTitle] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [positions, setPositions] = useState<PositionWithCommercialCost[]>([]);
  const [markupTactics, setMarkupTactics] = useState<MarkupTactic[]>([]);
  const [selectedTacticId, setSelectedTacticId] = useState<string | undefined>();
  const [tacticChanged, setTacticChanged] = useState(false);
  const [referenceTotal, setReferenceTotal] = useState<number>(0);
  const [insuranceTotal, setInsuranceTotal] = useState<number>(0);

  // Загрузка списка тендеров и тактик
  useEffect(() => {
    loadTenders();
    loadMarkupTactics();
  }, []);

  // Загрузка позиций при выборе тендера
  useEffect(() => {
    if (selectedTenderId) {
      loadPositions(selectedTenderId);
      // Установить тактику из тендера
      const tender = tenders.find(t => t.id === selectedTenderId);
      if (tender?.markup_tactic_id) {
        setSelectedTacticId(tender.markup_tactic_id);
        setTacticChanged(false);
      } else {
        setSelectedTacticId(undefined);
      }
    } else {
      setPositions([]);
    }
  }, [selectedTenderId, tenders]);

  const loadTenders = async () => {
    try {
      const { data, error } = await supabase
        .from('tenders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTenders(data || []);
    } catch (error) {
      console.error('Ошибка загрузки тендеров:', error);
      message.error('Не удалось загрузить список тендеров');
    }
  };

  const loadMarkupTactics = async () => {
    try {
      const { data, error } = await supabase
        .from('markup_tactics')
        .select('*')
        .order('is_global', { ascending: false })
        .order('name');

      if (error) throw error;
      setMarkupTactics(data || []);
    } catch (error) {
      console.error('Ошибка загрузки тактик наценок:', error);
      message.error('Не удалось загрузить список тактик');
    }
  };

  const loadPositions = async (tenderId: string) => {
    setLoading(true);

    try {
      // Загружаем позиции заказчика с батчингом (Supabase лимит 1000 строк)
      let clientPositions: any[] = [];
      let posFrom = 0;
      const posBatchSize = 1000;
      let posHasMore = true;

      while (posHasMore) {
        const { data, error } = await supabase
          .from('client_positions')
          .select('*')
          .eq('tender_id', tenderId)
          .order('position_number')
          .range(posFrom, posFrom + posBatchSize - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          clientPositions = [...clientPositions, ...data];
          posFrom += posBatchSize;
          posHasMore = data.length === posBatchSize;
        } else {
          posHasMore = false;
        }
      }

      // Загружаем ВСЕ BOQ элементы для тендера с батчингом (Supabase лимит 1000 строк)
      let allBoqItems: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('boq_items')
          .select('client_position_id, boq_item_type, material_type, total_amount, total_commercial_material_cost, total_commercial_work_cost')
          .eq('tender_id', tenderId)
          .range(from, from + batchSize - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          allBoqItems = [...allBoqItems, ...data];
          from += batchSize;
          hasMore = data.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      // Вычисляем эталонную сумму напрямую из boq_items (как на странице позиций)
      const refTotal = allBoqItems.reduce((sum, item) => sum + (item.total_amount || 0), 0);
      setReferenceTotal(refTotal);

      // Группируем элементы по позициям в памяти
      const itemsByPosition = new Map<string, typeof allBoqItems>();
      for (const item of allBoqItems) {
        if (!itemsByPosition.has(item.client_position_id)) {
          itemsByPosition.set(item.client_position_id, []);
        }
        itemsByPosition.get(item.client_position_id)!.push(item);
      }

      // Обрабатываем позиции с уже загруженными данными
      const positionsWithCosts = (clientPositions || []).map((position) => {
        const boqItems = itemsByPosition.get(position.id) || [];

        // Суммируем стоимости
        let baseTotal = 0;
        let commercialTotal = 0;
        let materialCostTotal = 0;
        let workCostTotal = 0;
        let itemsCount = 0;

        for (const item of boqItems) {
          const itemBase = item.total_amount || 0;
          const itemMaterial = item.total_commercial_material_cost || 0;
          const itemWork = item.total_commercial_work_cost || 0;

          baseTotal += itemBase;
          commercialTotal += itemMaterial + itemWork;
          materialCostTotal += itemMaterial;
          workCostTotal += itemWork;
          itemsCount++;
        }

        // Рассчитываем коэффициент наценки
        const markupCoefficient = baseTotal > 0
          ? commercialTotal / baseTotal
          : 1;

        return {
          ...position,
          base_total: baseTotal,
          commercial_total: commercialTotal,
          material_cost_total: materialCostTotal,
          work_cost_total: workCostTotal,
          markup_percentage: markupCoefficient,
          items_count: itemsCount
        } as PositionWithCommercialCost;
      });

      setPositions(positionsWithCosts);

      // Загружаем данные страхования от судимостей
      const { data: insData } = await supabase
        .from('tender_insurance')
        .select('judicial_pct, total_pct, apt_price_m2, apt_area, parking_price_m2, parking_area, storage_price_m2, storage_area')
        .eq('tender_id', tenderId)
        .maybeSingle();

      if (insData) {
        const apt = (insData.apt_price_m2 || 0) * (insData.apt_area || 0);
        const park = (insData.parking_price_m2 || 0) * (insData.parking_area || 0);
        const stor = (insData.storage_price_m2 || 0) * (insData.storage_area || 0);
        setInsuranceTotal(
          (apt + park + stor) * ((insData.judicial_pct || 0) / 100) * ((insData.total_pct || 0) / 100)
        );
      } else {
        setInsuranceTotal(0);
      }
    } catch (error) {
      console.error('Ошибка загрузки позиций:', error);
      message.error('Не удалось загрузить позиции заказчика');
    } finally {
      setLoading(false);
    }
  };

  const handleTacticChange = (tacticId: string) => {
    setSelectedTacticId(tacticId);
    // Проверяем, изменилась ли тактика относительно сохраненной в тендере
    const tender = tenders.find(t => t.id === selectedTenderId);
    setTacticChanged(tacticId !== tender?.markup_tactic_id);
  };

  // Рассчитываем итоговые суммы
  const totals = useMemo(() => {
    const baseTotal = positions.reduce((sum, pos) => sum + (pos.base_total || 0), 0);
    const commercialTotal = positions.reduce((sum, pos) => sum + (pos.commercial_total || 0), 0);
    const difference = commercialTotal - baseTotal;
    const markupPercentage = baseTotal > 0 ? (difference / baseTotal) * 100 : 0;

    return {
      base: baseTotal,
      commercial: commercialTotal,
      difference,
      markupPercentage
    };
  }, [positions]);

  return {
    loading,
    calculating,
    setCalculating,
    tenders,
    selectedTenderId,
    setSelectedTenderId,
    selectedTenderTitle,
    setSelectedTenderTitle,
    selectedVersion,
    setSelectedVersion,
    positions,
    setPositions,
    markupTactics,
    selectedTacticId,
    setSelectedTacticId,
    tacticChanged,
    setTacticChanged,
    loadTenders,
    loadPositions,
    handleTacticChange,
    totals,
    referenceTotal,
    insuranceTotal,
  };
}
