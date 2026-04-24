import { useState, useCallback } from 'react';
import { message } from 'antd';
import { supabase, PricingDistribution, PricingDistributionInsert } from '../../../../lib/supabase';

export const usePricingDistribution = () => {
  const [pricingDistribution, setPricingDistribution] = useState<PricingDistribution | null>(null);
  const [loadingPricing, setLoadingPricing] = useState(false);
  const [savingPricing, setSavingPricing] = useState(false);

  const fetchPricingDistribution = useCallback(async (tenderId: string | null) => {
    if (!tenderId) {
      setPricingDistribution(null);
      return;
    }

    setLoadingPricing(true);
    try {
      const { data, error } = await supabase
        .from('tender_pricing_distribution')
        .select('*')
        .eq('tender_id', tenderId)
        .maybeSingle();

      if (error) throw error;
      setPricingDistribution(data);
    } catch (error) {
      console.error('Error fetching pricing distribution:', error);
      message.error('Ошибка загрузки распределения ценообразования');
    } finally {
      setLoadingPricing(false);
    }
  }, []);

  const savePricingDistribution = useCallback(async (
    tenderId: string,
    distributionData: PricingDistributionInsert
  ) => {
    setSavingPricing(true);
    try {
      // Проверяем существование записи
      const { data: existing } = await supabase
        .from('tender_pricing_distribution')
        .select('id')
        .eq('tender_id', tenderId)
        .maybeSingle();

      let result;
      if (existing) {
        // Обновляем существующую запись
        const { data, error } = await supabase
          .from('tender_pricing_distribution')
          .update(distributionData)
          .eq('tender_id', tenderId)
          .select()
          .single();

        if (error) throw error;
        result = data;
      } else {
        // Создаем новую запись
        const { data, error } = await supabase
          .from('tender_pricing_distribution')
          .insert({ ...distributionData, tender_id: tenderId })
          .select()
          .single();

        if (error) throw error;
        result = data;
      }

      setPricingDistribution(result);
      message.success('Распределение ценообразования сохранено');
      return result;
    } catch (error) {
      console.error('Error saving pricing distribution:', error);
      message.error('Ошибка сохранения распределения ценообразования');
      throw error;
    } finally {
      setSavingPricing(false);
    }
  }, []);

  const updateDistributionField = useCallback((
    field: keyof PricingDistribution,
    value: PricingDistribution[keyof PricingDistribution]
  ) => {
    setPricingDistribution(prev => {
      if (!prev) return null;
      return { ...prev, [field]: value };
    });
  }, []);

  return {
    pricingDistribution,
    loadingPricing,
    savingPricing,
    setPricingDistribution,
    fetchPricingDistribution,
    savePricingDistribution,
    updateDistributionField,
  };
};
