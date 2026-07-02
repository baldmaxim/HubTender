import { useState, useEffect } from 'react';
import { message } from 'antd';
import type { BoqItemFull, CurrencyType, MaterialName, BoqItemType, MaterialType, DeliveryPriceType } from '../../../lib/types';
import type { CostCategoryOption } from '../components/editFormShared';

export interface MaterialFormData {
  boq_item_type: BoqItemType;
  material_type: MaterialType;
  material_name_id: string | null;
  unit_code: string | null;
  parent_work_item_id: string | null;
  consumption_coefficient: number;
  conversion_coefficient: number | null;
  base_quantity: number | null;
  quantity: number;
  unit_rate: number;
  currency_type: CurrencyType;
  delivery_price_type: DeliveryPriceType;
  delivery_amount: number;
  detail_cost_category_id: string | null;
  quote_link: string;
  description: string;
}

/**
 * Состояние и расчёты inline-формы редактирования материала BOQ.
 * Вынесено из MaterialEditForm без изменений логики (в т.ч. паттерн
 * setFormData({ ...formData, ... }) в JSX остаётся как был).
 */
export const useMaterialEditForm = ({
  record,
  materialNames,
  workItems,
  costCategories,
  currencyRates,
  gpVolume,
  onSave,
}: {
  record: BoqItemFull;
  materialNames: MaterialName[];
  workItems: BoqItemFull[];
  costCategories: CostCategoryOption[];
  currencyRates: { usd: number; eur: number; cny: number };
  gpVolume: number;
  onSave: (data: Record<string, unknown>) => Promise<void>;
}) => {
  const [formData, setFormData] = useState<MaterialFormData>({
    boq_item_type: record.boq_item_type,
    material_type: record.material_type || 'основн.',
    material_name_id: record.material_name_id ?? null,
    unit_code: record.unit_code ?? null,
    parent_work_item_id: record.parent_work_item_id || null,
    consumption_coefficient: record.consumption_coefficient || 1,
    conversion_coefficient: record.conversion_coefficient || 1,
    base_quantity: record.base_quantity || 0,
    quantity: record.quantity || 0,
    unit_rate: record.unit_rate || 0,
    currency_type: record.currency_type || 'RUB',
    delivery_price_type: record.delivery_price_type || 'в цене',
    delivery_amount: record.delivery_amount || 0,
    detail_cost_category_id: record.detail_cost_category_id ?? null,
    quote_link: record.quote_link || '',
    description: record.description || '',
  });

  const [materialSearchText, setMaterialSearchText] = useState<string>(record.material_name || '');

  const [costSearchText, setCostSearchText] = useState<string>(record.detail_cost_category_full || '');

  // Флаг для отслеживания ручного ввода количества (только для непривязанных материалов)
  // Инициализируем как true если материал не привязан И quantity != gpVolume
  const [isManualQuantity, setIsManualQuantity] = useState<boolean>(() => {
    if (record.parent_work_item_id) return false;
    const autoQuantity = gpVolume;
    const actualQuantity = record.quantity || 0;
    // Если разница больше 0.0001 - считаем что это ручное количество
    return Math.abs(actualQuantity - autoQuantity) > 0.0001;
  });

  // Функция для получения курса валюты
  const getCurrencyRate = (currency: CurrencyType): number => {
    switch (currency) {
      case 'USD':
        return currencyRates.usd;
      case 'EUR':
        return currencyRates.eur;
      case 'CNY':
        return currencyRates.cny;
      case 'RUB':
      default:
        return 1;
    }
  };

  // Вычисление количества
  const calculateQuantity = (): number => {
    if (formData.parent_work_item_id) {
      // Материал привязан к работе
      const parentWork = workItems.find((w) => w.id === formData.parent_work_item_id);
      if (parentWork && parentWork.quantity) {
        return parentWork.quantity * (formData.conversion_coefficient ?? 1) * formData.consumption_coefficient;
      }
      return 0;
    } else {
      // Материал не привязан к работе - используем количество ГП как базовое
      // Коэффициент расхода применяется только к итоговой сумме, а не к количеству
      return gpVolume;
    }
  };

  // Вычисление цены доставки (полная точность без округления)
  const calculateDeliveryPrice = (): number => {
    const rate = getCurrencyRate(formData.currency_type);
    const unitPriceInRub = formData.unit_rate * rate;

    if (formData.delivery_price_type === 'не в цене') {
      return unitPriceInRub * 0.03; // Используем все 5 знаков после запятой
    } else if (formData.delivery_price_type === 'суммой') {
      return formData.delivery_amount || 0;
    } else {
      // 'в цене'
      return 0;
    }
  };

  // Вычисление суммы (полная точность без округления)
  const calculateTotal = (): number => {
    // Использовать formData.quantity напрямую, т.к. оно уже содержит правильное значение
    // (либо автоматически рассчитанное, либо введенное вручную)
    const qty = formData.quantity || 0;
    const rate = getCurrencyRate(formData.currency_type);
    const deliveryPrice = calculateDeliveryPrice();

    // Для непривязанных материалов всегда применять коэффициент расхода к итоговой сумме
    const consumptionCoeff = !formData.parent_work_item_id ? (formData.consumption_coefficient || 1) : 1;
    const total = qty * consumptionCoeff * (formData.unit_rate * rate + deliveryPrice);
    return total; // Используем все 5 знаков после запятой, округление только для отображения
  };

  // Обновление количества при изменении зависимых полей
  useEffect(() => {
    // Не обновлять количество автоматически если:
    // 1. Материал не привязан к работе И
    // 2. Пользователь вручную изменил количество
    if (!formData.parent_work_item_id && isManualQuantity) {
      return;
    }

    const newQuantity = calculateQuantity();
    setFormData((prev) => ({ ...prev, quantity: newQuantity }));
    // calculateQuantity and isManualQuantity are defined in this component; excluded to avoid refetch loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    formData.parent_work_item_id,
    formData.conversion_coefficient,
    formData.consumption_coefficient,
    gpVolume,
  ]);

  // Сбросить флаг ручного ввода при привязке материала к работе
  useEffect(() => {
    if (formData.parent_work_item_id) {
      setIsManualQuantity(false);
    }
  }, [formData.parent_work_item_id]);

  // Обработчик сохранения
  const handleSave = async () => {
    if (!formData.material_name_id) {
      message.error('Выберите наименование материала');
      return;
    }

    // Проверка на коэффициент расхода
    if (formData.consumption_coefficient < 1.0) {
      message.error('Значение коэффициента расхода не может быть менее 1,00');
      return;
    }

    if (!formData.detail_cost_category_id) {
      message.error('Выберите затрату на строительство');
      return;
    }

    // Подготовить данные для сохранения
    const dataToSave: MaterialFormData = {
      ...formData,
    };

    // Если материал не привязан к работе
    if (!formData.parent_work_item_id) {
      // Явно устанавливаем null для отвязанного материала
      dataToSave.parent_work_item_id = null;
      dataToSave.conversion_coefficient = null;

      // Если количество введено вручную - использовать его
      // Иначе вычислить из количества ГП
      if (isManualQuantity) {
        dataToSave.base_quantity = formData.quantity;
        dataToSave.quantity = formData.quantity;
      } else {
        // Проверка на корректность количества ГП
        if (!gpVolume || gpVolume <= 0) {
          message.error('Введите количество ГП');
          return;
        }
        // Использовать количество ГП как базовое количество
        dataToSave.base_quantity = gpVolume;
        // Quantity представляет базовое количество (без коэффициента расхода)
        dataToSave.quantity = gpVolume;
      }
    } else {
      // Если материал привязан к работе, очистить base_quantity
      dataToSave.parent_work_item_id = formData.parent_work_item_id;
      dataToSave.base_quantity = null;
      dataToSave.quantity = calculateQuantity();
    }

    // Вычислить total_amount на основе финального quantity в dataToSave (полная точность)
    const rate = getCurrencyRate(formData.currency_type);
    const deliveryPrice = calculateDeliveryPrice();

    // Для непривязанных материалов всегда применять коэффициент расхода к итоговой сумме
    const consumptionCoeff = !dataToSave.parent_work_item_id ? (formData.consumption_coefficient || 1) : 1;
    const totalAmount = dataToSave.quantity * consumptionCoeff * (formData.unit_rate * rate + deliveryPrice);

    await onSave({ ...(dataToSave as unknown as Record<string, unknown>), total_amount: totalAmount });
  };

  // Получить опции для AutoComplete затрат
  const getCostCategoryOptions = () => {
    return costCategories
      .filter((c) => c.label.toLowerCase().includes(costSearchText.toLowerCase()))
      .map((c) => ({
        value: c.label,
        id: c.value,
        label: c.label,
      }));
  };

  // Получить опции для AutoComplete наименований материалов
  const getMaterialNameOptions = () => {
    const searchText = materialSearchText || '';
    if (searchText.length < 2) return [];

    return materialNames
      .filter((m) => m.name.toLowerCase().includes(searchText.toLowerCase()))
      .map((m) => ({
        value: m.id,
        label: m.name,
        id: m.id,
        unit: m.unit,
      }));
  };

  return {
    formData,
    setFormData,
    materialSearchText,
    setMaterialSearchText,
    costSearchText,
    setCostSearchText,
    setIsManualQuantity,
    calculateTotal,
    handleSave,
    getCostCategoryOptions,
    getMaterialNameOptions,
  };
};
