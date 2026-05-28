import { useEffect, useState } from 'react';
import type { TenderRegistryWithRelations, TenderStatus, ConstructionScope } from '../../../lib/supabase';
import {
  fetchTenderRegistryWithRelations,
  fetchTenderStatuses,
  fetchConstructionScopes,
  fetchTenderNumbers,
  fetchRelatedTendersByNumbers,
} from '../../../lib/api/tenderRegistry';

const normalizeTenderTitle = (title?: string | null) =>
  (title || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ru-RU');

const getTenderRegistryDedupKey = (tender: TenderRegistryWithRelations) => {
  if (tender.tender_number) {
    return `number:${tender.tender_number}`;
  }

  return `title:${normalizeTenderTitle(tender.title)}|client:${(tender.client_name || '').trim().toLocaleLowerCase('ru-RU')}`;
};

const dedupeTenderRegistry = (items: TenderRegistryWithRelations[]) => {
  const map = new Map<string, TenderRegistryWithRelations>();

  items.forEach((item) => {
    const key = getTenderRegistryDedupKey(item);
    const current = map.get(key);

    if (!current) {
      map.set(key, item);
      return;
    }

    const nextTimestamp = new Date(item.updated_at || item.created_at).getTime();
    const currentTimestamp = new Date(current.updated_at || current.created_at).getTime();

    if (nextTimestamp > currentTimestamp) {
      map.set(key, item);
    }
  });

  return Array.from(map.values()).sort((left, right) => (left.sort_order || 0) - (right.sort_order || 0));
};

export const useTenderData = () => {
  const [tenders, setTenders] = useState<TenderRegistryWithRelations[]>([]);
  const [statuses, setStatuses] = useState<TenderStatus[]>([]);
  const [constructionScopes, setConstructionScopes] = useState<ConstructionScope[]>([]);
  const [tenderNumbers, setTenderNumbers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTenders = async () => {
    setLoading(true);
    try {
      const data = await fetchTenderRegistryWithRelations();
      const tendersData = dedupeTenderRegistry(data);

      setTenders(tendersData);
      setLoading(false);

      const tendersWithNumbers = tendersData.filter((t) => t.tender_number);
      const tenderIdMap = new Map<string, string>();
      const grandTotalMap = new Map<string, number>();

      if (tendersWithNumbers.length > 0) {
        const numbers = tendersWithNumbers
          .map((t) => t.tender_number)
          .filter((tn): tn is string => tn != null);
        const relatedTenders = await fetchRelatedTendersByNumbers(numbers);

        if (relatedTenders.length > 0) {
          const sorted = [...relatedTenders].sort((a, b) => (b.version || 0) - (a.version || 0));
          sorted.forEach((rt) => {
            if (rt.tender_number && !tenderIdMap.has(rt.tender_number)) {
              tenderIdMap.set(rt.tender_number, rt.id);
            }
            grandTotalMap.set(rt.id, rt.cached_grand_total || 0);
          });
        }
      }

      const updatedTenders = tendersData.map((tender) => {
        if (tender.manual_total_cost != null) {
          return { ...tender, total_cost: tender.manual_total_cost };
        }

        if (tender.tender_number && tenderIdMap.has(tender.tender_number)) {
          const tenderId = tenderIdMap.get(tender.tender_number)!;
          return { ...tender, total_cost: grandTotalMap.get(tenderId) ?? null };
        }

        return { ...tender, total_cost: null };
      });

      setTenders(updatedTenders);
    } catch {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenders();
    fetchTenderStatuses().then(setStatuses).catch(() => setStatuses([]));
    fetchConstructionScopes().then(setConstructionScopes).catch(() => setConstructionScopes([]));
    fetchTenderNumbers().then(setTenderNumbers).catch(() => setTenderNumbers([]));
  }, []);

  return { tenders, statuses, constructionScopes, tenderNumbers, loading, refetch: fetchTenders };
};
