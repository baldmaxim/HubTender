import { useState, useEffect } from 'react';
import { message } from 'antd';
import { supabase, type Tender, type ClientPosition } from '../../../lib/supabase';

// Загружает все позиции тендера постранично
async function loadAllPositions(tenderId: string): Promise<ClientPosition[]> {
  const all: ClientPosition[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('client_positions')
      .select('*')
      .eq('tender_id', tenderId)
      .order('position_number', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

// Загружает boq_items по tender_id — один тип запроса вместо батчинга по position_id
async function loadAllBoqItems(tenderId: string): Promise<Array<{
  client_position_id: string;
  boq_item_type: string;
  total_amount: number | null;
}>> {
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('boq_items')
      .select('client_position_id, boq_item_type, total_amount')
      .eq('tender_id', tenderId)
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

export const useClientPositions = () => {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTender, setSelectedTender] = useState<Tender | null>(null);
  const [clientPositions, setClientPositions] = useState<ClientPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [positionCounts, setPositionCounts] = useState<Record<string, { works: number; materials: number; total: number }>>({});
  const [totalSum, setTotalSum] = useState<number>(0);
  const [leafPositionIndices, setLeafPositionIndices] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchTenders();
  }, []);

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

  // Вычисление листовых позиций (конечных узлов иерархии)
  const computeLeafPositions = (positions: ClientPosition[]): Set<string> => {
    const leafIds = new Set<string>();
    positions.forEach((position, index) => {
      if (index === positions.length - 1) { leafIds.add(position.id); return; }
      const currentLevel = position.hierarchy_level || 0;
      let nextIndex = index + 1;
      while (nextIndex < positions.length && positions[nextIndex].is_additional) nextIndex++;
      if (nextIndex >= positions.length) { leafIds.add(position.id); return; }
      if (currentLevel >= (positions[nextIndex].hierarchy_level || 0)) leafIds.add(position.id);
    });
    return leafIds;
  };

  // Загрузка позиций заказчика
  // ОПТИМИЗИРОВАНО: позиции и boq_items загружаются параллельно;
  // boq_items запрашиваются по tender_id (без батчинга по position_id);
  // totalSum вычисляется из уже загруженных данных без дополнительных запросов.
  const fetchClientPositions = async (tenderId: string) => {
    setLoading(true);
    try {
      // Параллельная загрузка позиций и всех boq_items тендера
      const [positions, boqItems] = await Promise.all([
        loadAllPositions(tenderId),
        loadAllBoqItems(tenderId),
      ]);

      setClientPositions(positions);
      setLeafPositionIndices(computeLeafPositions(positions));

      // Считаем статистику и общую сумму в памяти — без дополнительных запросов к БД
      const counts: Record<string, { works: number; materials: number; total: number }> = {};
      let runningTotal = 0;

      for (const item of boqItems) {
        if (!counts[item.client_position_id]) {
          counts[item.client_position_id] = { works: 0, materials: 0, total: 0 };
        }
        if (['раб', 'суб-раб', 'раб-комп.'].includes(item.boq_item_type)) {
          counts[item.client_position_id].works++;
        } else if (['мат', 'суб-мат', 'мат-комп.'].includes(item.boq_item_type)) {
          counts[item.client_position_id].materials++;
        }
        const amount = Number(item.total_amount) || 0;
        counts[item.client_position_id].total += amount;
        runningTotal += amount;
      }

      setPositionCounts(counts);
      setTotalSum(runningTotal);
    } catch (error: any) {
      message.error('Ошибка загрузки позиций: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

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
  };
};
