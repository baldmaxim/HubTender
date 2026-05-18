import { useState, useCallback } from 'react';
import { message } from 'antd';
import type { PricingDistribution, PricingDistributionInsert } from '../../../../lib/supabase';
import {
  getTenderPricingDistribution,
  upsertTenderPricingDistribution,
} from '../../../../lib/api/markup';

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
      const data = await getTenderPricingDistribution(tenderId);
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
      // Go-эндпоинт делает upsert по tender_id атомарно на сервере.
      const result = await upsertTenderPricingDistribution({
        ...distributionData,
        tender_id: tenderId,
      });

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
