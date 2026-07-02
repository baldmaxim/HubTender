// Общие хелперы Excel-импорта BOQ. Используются одиночным импортом
// (PositionItems/useBoqItemsImport) и зеркалируют семантику mass-импорта
// (ClientPositions/utils/massBoqImport*). ВАЖНО: одиночный и массовый импорт —
// параллельные реализации, которые держат в синхроне (см. memory
// boq-import-dual-impl); осознанно разошедшиеся хелперы (normalizeMaterialType)
// здесь НЕ живут.

export const isWork = (type: string): boolean => {
  return ['раб', 'суб-раб', 'раб-комп.'].includes(type);
};

export const isMaterial = (type: string): boolean => {
  return ['мат', 'суб-мат', 'мат-комп.'].includes(type);
};

export const normalizeString = (str: string): string => {
  return str.trim()
    .replace(/\s+/g, ' ');  // Множественные пробелы -> один пробел
  // НЕ убираем пробелы вокруг слэша, т.к. в БД категории хранятся как "ВИС / Электрические системы"
};

export const normalizeForLookup = (str: string): string => {
  return normalizeString(str).toLowerCase();
};

export const buildNomenclatureLookupKey = (name: string, unit: string): string => {
  return `${normalizeForLookup(name)}|${normalizeForLookup(unit)}`;
};

export const parseNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const num = typeof value === 'string' ? parseFloat(value.replace(',', '.')) : Number(value);
  return isNaN(num) ? undefined : num;
};

export const parseBoolean = (value: unknown): boolean => {
  if (!value) return false;
  const str = String(value).toLowerCase().trim();
  return str === 'да' || str === 'yes' || str === 'true' || str === '1';
};

export interface ImportCurrencyRates {
  usd: number;
  eur: number;
  cny: number;
}

// Курсы передаются явно (state-фолбэка нет — все вызовы в импорте передают rates).
export const getCurrencyRate = (currency: string, rates: ImportCurrencyRates): number => {
  switch (currency) {
    case 'USD':
      return rates.usd;
    case 'EUR':
      return rates.eur;
    case 'CNY':
      return rates.cny;
    case 'RUB':
    default:
      return 1;
  }
};

// Минимальная структурная форма элемента импорта, достаточная для расчёта
// стоимости (ParsedBoqItem обоих импортов ей соответствует).
export interface ImportCostItem {
  boq_item_type: string;
  nameText: string;
  currency_type?: string;
  unit_rate?: number;
  quantity?: number;
  delivery_price_type?: string;
  delivery_amount?: number;
  parent_work_item_id?: string;
  consumption_coefficient?: number;
}

export const calculateTotalAmount = (item: ImportCostItem, rates: ImportCurrencyRates): number => {
  const rate = getCurrencyRate(item.currency_type || 'RUB', rates);
  const unitRate = item.unit_rate || 0;
  const quantity = item.quantity || 0;

  // Логирование для валютных позиций
  if (item.currency_type && item.currency_type !== 'RUB') {
    console.log(`[TotalAmount] Расчёт для валютной позиции "${item.nameText.substring(0, 50)}...":`, {
      currency: item.currency_type,
      rate,
      unitRate,
      quantity,
      unitRateInRub: unitRate * rate,
    });
  }

  if (isWork(item.boq_item_type)) {
    // Для работ: quantity × unit_rate × currency_rate (полная точность)
    const total = quantity * unitRate * rate;

    if (item.currency_type && item.currency_type !== 'RUB') {
      console.log(`[TotalAmount] Работа - итого: ${total} ₽`);
    }

    return total;
  } else {
    // Для материалов: quantity × (unit_rate × currency_rate + delivery_price)
    const unitPriceInRub = unitRate * rate;
    let deliveryPrice = 0;

    if (item.delivery_price_type === 'не в цене') {
      // 3% от цены в рублях (полная точность)
      deliveryPrice = unitPriceInRub * 0.03;
    } else if (item.delivery_price_type === 'суммой') {
      // Конкретная сумма
      deliveryPrice = item.delivery_amount || 0;
    }
    // Для 'в цене' deliveryPrice остается 0

    // Для непривязанных материалов применяем коэффициент расхода
    const consumptionCoeff = !item.parent_work_item_id ? (item.consumption_coefficient || 1) : 1;

    const total = quantity * consumptionCoeff * (unitPriceInRub + deliveryPrice);

    if (item.currency_type && item.currency_type !== 'RUB') {
      console.log(`[TotalAmount] Материал - итого: ${total} ₽ (доставка: ${deliveryPrice} ₽, коэфф.расхода: ${consumptionCoeff})`);
    }

    return total;
  }
};
