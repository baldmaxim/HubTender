import type {
  BoqItemInsert,
  BoqItemType,
  CurrencyType,
  DeliveryPriceType,
  MaterialLibraryFull,
  MaterialType,
  WorkLibraryFull,
} from '../../../lib/types';

/** Чистая сборка тела INSERT для работы из библиотеки (как «Добавить работу» на странице позиции). */
export const buildWorkInsert = (
  workLib: WorkLibraryFull,
  ctx: { tenderId: string; positionId: string; sortNumber: number; currencyRate: number },
): BoqItemInsert => {
  const quantity = 1;
  const unitRate = workLib.unit_rate || 0;
  const totalAmount = quantity * unitRate * ctx.currencyRate;

  return {
    tender_id: ctx.tenderId,
    client_position_id: ctx.positionId,
    sort_number: ctx.sortNumber,
    boq_item_type: workLib.item_type as BoqItemType,
    work_name_id: workLib.work_name_id,
    unit_code: workLib.unit,
    quantity: quantity,
    unit_rate: unitRate,
    currency_type: workLib.currency_type as CurrencyType,
    total_amount: totalAmount,
  };
};

/**
 * Чистая сборка тела INSERT для материала из библиотеки (как «Добавить материал»).
 * gpVolume — количество ГП позиции (manual_volume) для непривязанного материала.
 */
export const buildMaterialInsert = (
  matLib: MaterialLibraryFull,
  ctx: { tenderId: string; positionId: string; sortNumber: number; currencyRate: number; gpVolume: number },
): BoqItemInsert => {
  // base_quantity должно быть > 0 из-за CHECK constraint
  const baseQuantity = ctx.gpVolume > 0 ? ctx.gpVolume : 1;
  const consumptionCoeff = matLib.consumption_coefficient || 1;
  // Quantity теперь представляет базовое количество (без коэффициента расхода)
  const quantity = baseQuantity;
  const unitRate = matLib.unit_rate || 0;

  let deliveryPrice = 0;
  if (matLib.delivery_price_type === 'не в цене') {
    deliveryPrice = unitRate * ctx.currencyRate * 0.03; // Полная точность (5 знаков)
  } else if (matLib.delivery_price_type === 'суммой' && matLib.delivery_amount) {
    deliveryPrice = matLib.delivery_amount;
  }

  // Для непривязанных материалов применяем коэффициент расхода к итоговой сумме
  const totalAmount = quantity * consumptionCoeff * (unitRate * ctx.currencyRate + deliveryPrice);

  return {
    tender_id: ctx.tenderId,
    client_position_id: ctx.positionId,
    sort_number: ctx.sortNumber,
    boq_item_type: matLib.item_type as BoqItemType,
    material_type: matLib.material_type as MaterialType,
    material_name_id: matLib.material_name_id,
    unit_code: matLib.unit,
    quantity: quantity,
    base_quantity: baseQuantity,
    unit_rate: unitRate,
    consumption_coefficient: matLib.consumption_coefficient,
    currency_type: matLib.currency_type as CurrencyType,
    delivery_price_type: matLib.delivery_price_type as DeliveryPriceType,
    delivery_amount: matLib.delivery_amount,
    total_amount: totalAmount,
  };
};
