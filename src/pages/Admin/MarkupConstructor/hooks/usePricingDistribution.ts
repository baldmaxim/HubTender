import { useState } from 'react';
import { message } from 'antd';
import type { PricingDistribution, PricingDistributionInsert, DistributionTarget } from '../../../../lib/supabase';
import {
  getTenderPricingDistribution,
  upsertTenderPricingDistribution,
} from '../../../../lib/api/markup';
import { useRealtimeRefetch } from '../../../../lib/realtime/useRealtimeRefetch';

// Настройки ценообразования (распределение затрат между КП и работами)
// выбранного тендера + realtime-подписка. markPricingMutation живёт рядом
// с handleSavePricingDistribution — иначе сломается подавление эха.
export const usePricingDistribution = ({
  selectedTenderId,
  selectedTacticId,
}: {
  selectedTenderId: string | null;
  selectedTacticId: string | null;
}) => {
  const [pricingDistribution, setPricingDistribution] = useState<PricingDistribution | null>(null);
  const [loadingPricing, setLoadingPricing] = useState(false);
  const [savingPricing, setSavingPricing] = useState(false);

  const fetchPricingDistribution = async (tenderId: string) => {
    setLoadingPricing(true);
    try {
      const data = await getTenderPricingDistribution(tenderId);
      setPricingDistribution(data);
    } catch (error) {
      console.error('Ошибка загрузки настроек ценообразования:', error);
      message.error('Не удалось загрузить настройки ценообразования');
    } finally {
      setLoadingPricing(false);
    }
  };

  // Native WS hub — настройки ценообразования выбранного тендера. Фильтр по
  // таблице, чтобы прочие события tender:{id} (boq_items и т.п.) не сбрасывали
  // форму распределения; markPricingMutation подавляет эхо своего сохранения.
  const { markLocalMutation: markPricingMutation } = useRealtimeRefetch(
    selectedTenderId ? `tender:${selectedTenderId}` : null,
    () => {
      if (selectedTenderId) void fetchPricingDistribution(selectedTenderId);
    },
    {
      enabled: !!selectedTenderId,
      shouldRefetch: (ev) => ev.table === 'tender_pricing_distribution',
    },
  );

  // Обработка изменения настройки распределения
  const handleDistributionChange = (
    itemType: string,
    targetType: 'base' | 'markup',
    value: DistributionTarget
  ) => {
    setPricingDistribution((prev) => {
      const fieldName =
        `${itemType}_${targetType}_target` as keyof PricingDistribution;

      return {
        ...(prev || {
          id: '',
          tender_id: selectedTenderId!,
          created_at: '',
          updated_at: '',
        }),
        [fieldName]: value,
      };
    });
  };

  // Сохранение настроек ценообразования
  const handleSavePricingDistribution = async () => {
    if (!selectedTenderId) {
      message.warning('Выберите тендер');
      return;
    }

    setSavingPricing(true);
    markPricingMutation();
    try {
      const dataToSave: PricingDistributionInsert = {
        tender_id: selectedTenderId,
        markup_tactic_id: selectedTacticId,
        basic_material_base_target: pricingDistribution?.basic_material_base_target || 'material',
        basic_material_markup_target: pricingDistribution?.basic_material_markup_target || 'work',
        auxiliary_material_base_target: pricingDistribution?.auxiliary_material_base_target || 'work',
        auxiliary_material_markup_target: pricingDistribution?.auxiliary_material_markup_target || 'work',
        component_material_base_target: pricingDistribution?.component_material_base_target || 'work',
        component_material_markup_target: pricingDistribution?.component_material_markup_target || 'work',
        subcontract_basic_material_base_target: pricingDistribution?.subcontract_basic_material_base_target || 'material',
        subcontract_basic_material_markup_target: pricingDistribution?.subcontract_basic_material_markup_target || 'work',
        subcontract_auxiliary_material_base_target: pricingDistribution?.subcontract_auxiliary_material_base_target || 'work',
        subcontract_auxiliary_material_markup_target: pricingDistribution?.subcontract_auxiliary_material_markup_target || 'work',
        work_base_target: pricingDistribution?.work_base_target || 'work',
        work_markup_target: pricingDistribution?.work_markup_target || 'work',
        component_work_base_target: pricingDistribution?.component_work_base_target || 'work',
        component_work_markup_target: pricingDistribution?.component_work_markup_target || 'work',
      };

      const data = await upsertTenderPricingDistribution(dataToSave);
      setPricingDistribution(data);
      message.success('Настройки ценообразования успешно сохранены');
    } catch (error) {
      console.error('Ошибка сохранения настроек ценообразования:', error);
      message.error('Не удалось сохранить настройки ценообразования');
    } finally {
      setSavingPricing(false);
    }
  };

  // Сброс к значениям по умолчанию
  const handleResetPricingToDefaults = () => {
    setPricingDistribution((prev) => ({
      ...(prev || {
        id: '',
        tender_id: selectedTenderId!,
        created_at: '',
        updated_at: '',
      }),
      basic_material_base_target: 'material',
      basic_material_markup_target: 'work',
      auxiliary_material_base_target: 'work',
      auxiliary_material_markup_target: 'work',
      component_material_base_target: 'work',
      component_material_markup_target: 'work',
      subcontract_basic_material_base_target: 'material',
      subcontract_basic_material_markup_target: 'work',
      subcontract_auxiliary_material_base_target: 'work',
      subcontract_auxiliary_material_markup_target: 'work',
      work_base_target: 'work',
      work_markup_target: 'work',
      component_work_base_target: 'work',
      component_work_markup_target: 'work',
    }));
    message.info('Настройки сброшены к значениям по умолчанию');
  };

  return {
    pricingDistribution,
    loadingPricing,
    savingPricing,
    fetchPricingDistribution,
    handleDistributionChange,
    handleSavePricingDistribution,
    handleResetPricingToDefaults,
  };
};
