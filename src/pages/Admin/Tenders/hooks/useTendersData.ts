import { useState, useEffect, useCallback } from 'react';
import { message } from 'antd';
import { supabase, type Tender, type HousingClassType, type ConstructionScopeType } from '../../../../lib/supabase';
import dayjs from 'dayjs';

export interface TenderRecord {
  key: string;
  id: string;
  tender: string;
  tenderNumber: string;
  deadline: string;
  daysUntilDeadline: number;
  client: string;
  estimatedCost: number;
  areaClient: number;
  areaSp: number;
  areaZakazchik: number;
  usdRate: number;
  eurRate: number;
  cnyRate: number;
  hasLinks: boolean;
  uploadFolder?: string;
  bsmLink?: string;
  tzLink?: string;
  qaFormLink?: string;
  projectFolderLink?: string;
  createdAt: string;
  description: string;
  status: 'completed' | 'in_progress' | 'pending';
  version: string;
  housingClass?: HousingClassType;
  constructionScope?: ConstructionScopeType;
  is_archived?: boolean;
  /** Исходные данные тендера из БД — используется в модальных окнах */
  raw: Tender;
}

const formatTender = (tender: Tender): TenderRecord => ({
  ...tender,
  key: tender.id,
  id: tender.id,
  tender: tender.title,
  tenderNumber: tender.tender_number,
  deadline: tender.submission_deadline ? dayjs(tender.submission_deadline).format('DD.MM.YYYY') : '',
  daysUntilDeadline: tender.submission_deadline
    ? dayjs(tender.submission_deadline).diff(dayjs(), 'day')
    : 0,
  client: tender.client_name,
  estimatedCost: tender.cached_grand_total || 0,
  areaClient: tender.area_client || 0,
  areaSp: tender.area_sp || 0,
  areaZakazchik: tender.area_client || 0,
  usdRate: tender.usd_rate || 0,
  eurRate: tender.eur_rate || 0,
  cnyRate: tender.cny_rate || 0,
  hasLinks: !!(
    tender.upload_folder ||
    tender.bsm_link ||
    tender.tz_link ||
    tender.qa_form_link ||
    tender.project_folder_link
  ),
  uploadFolder: tender.upload_folder || undefined,
  bsmLink: tender.bsm_link || undefined,
  tzLink: tender.tz_link || undefined,
  qaFormLink: tender.qa_form_link || undefined,
  projectFolderLink: tender.project_folder_link || undefined,
  createdAt: dayjs(tender.created_at).format('DD.MM.YYYY'),
  description: tender.description || '',
  status: 'in_progress' as const,
  version: tender.version?.toString() || '1',
  housingClass: tender.housing_class || undefined,
  constructionScope: tender.construction_scope || undefined,
  raw: tender,
});

export const useTendersData = () => {
  const [tendersData, setTendersData] = useState<TenderRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTenders = useCallback(async () => {
    setLoading(true);
    try {
      // Один запрос — cached_grand_total уже посчитан триггером на сервере
      const { data, error } = await supabase
        .from('tenders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Ошибка загрузки тендеров:', error);
        message.error('Ошибка загрузки тендеров');
        return;
      }

      setTendersData((data ?? []).map((t: Tender) => formatTender(t)));
    } catch (err) {
      console.error('Неожиданная ошибка:', err);
      message.error('Произошла неожиданная ошибка');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTenders();

    // Подписка на tenders (не boq_items).
    // Триггер в БД обновляет cached_grand_total при изменении boq_items /
    // tender_markup_percentage / subcontract_growth_exclusions, что вызывает
    // UPDATE-событие в tenders — мы обновляем только затронутую запись.
    const subscription = supabase
      .channel('tenders_grand_total')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tenders' },
        (payload) => {
          const updated = payload.new as Tender;
          setTendersData((prev) =>
            prev.map((t) => (t.id === updated.id ? formatTender(updated) : t))
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tenders' },
        () => {
          fetchTenders();
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'tenders' },
        (payload) => {
          setTendersData((prev) => prev.filter((t) => t.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [fetchTenders]);

  return {
    tendersData,
    loading,
    fetchTenders,
  };
};
