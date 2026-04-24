import { useState } from 'react';
import * as XLSX from 'xlsx';
import { message } from 'antd';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { insertBoqItemWithAudit } from '../../../lib/supabaseWithAudit';
import { getErrorMessage } from '../../../utils/errors';

// ===========================
// ТИПЫ И ИНТЕРФЕЙСЫ
// ===========================

interface ParsedBoqItem {
  rowIndex: number;

  // Основные поля
  boq_item_type: 'раб' | 'суб-раб' | 'раб-комп.' | 'мат' | 'суб-мат' | 'мат-комп.';
  material_type?: 'основн.' | 'вспомогат.';

  // Наименование (для поиска в номенклатуре)
  nameText: string;
  unit_code: string;

  // Найденные ID из номенклатуры
  work_name_id?: string;
  material_name_id?: string;

  // Привязка к работе
  bindToWork: boolean;
  parent_work_item_id?: string;
  tempId?: string;

  // Количество и коэффициенты
  base_quantity?: number;
  quantity?: number;
  conversion_coefficient?: number;
  consumption_coefficient?: number;

  // Финансовые поля
  currency_type: 'RUB' | 'USD' | 'EUR' | 'CNY';
  delivery_price_type?: 'в цене' | 'не в цене' | 'суммой';
  delivery_amount?: number;
  unit_rate?: number;

  // Затрата на строительство
  costCategoryText: string;
  detail_cost_category_id?: string;

  // Дополнительно
  quote_link?: string;
  description?: string;

  // Сортировка
  sort_number: number;
}

interface ValidationError {
  rowIndex: number;
  type: 'missing_nomenclature' | 'unit_mismatch' | 'missing_cost' | 'invalid_type' | 'missing_field' | 'binding_error';
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

interface MissingNomenclatureGroup {
  name: string;
  unit: string;
  rows: number[];
}

interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  missingNomenclature: {
    works: MissingNomenclatureGroup[];
    materials: MissingNomenclatureGroup[];
  };
  unknownCosts: Array<{ text: string; rows: number[] }>;
}

interface WorkNameRecord {
  id: string;
  name: string;
  unit: string;
}

interface MaterialNameRecord {
  id: string;
  name: string;
  unit: string;
}

interface CostCategoryRecord {
  id: string;
  name: string;
  location: string;
  cost_categories?: { name: string } | { name: string }[] | null;
}

const PAGE_SIZE = 1000;

// ===========================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ===========================

const isWork = (type: string): boolean => {
  return ['раб', 'суб-раб', 'раб-комп.'].includes(type);
};

const isMaterial = (type: string): boolean => {
  return ['мат', 'суб-мат', 'мат-комп.'].includes(type);
};

const normalizeString = (str: string): string => {
  return str.trim()
    .replace(/\s+/g, ' ');  // Множественные пробелы -> один пробел
  // НЕ убираем пробелы вокруг слэша, т.к. в БД категории хранятся как "ВИС / Электрические системы"
};

const normalizeForLookup = (str: string): string => {
  return normalizeString(str).toLowerCase();
};

const buildNomenclatureLookupKey = (name: string, unit: string): string => {
  return `${normalizeForLookup(name)}|${normalizeForLookup(unit)}`;
};

const fetchAllPages = async <T>(
  queryFactory: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> => {
  const items: T[] = [];
  let from = 0;

  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await queryFactory(from, to);

    if (error) {
      throw error;
    }

    const batch = data || [];
    items.push(...batch);

    if (batch.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return items;
};

const parseNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const num = typeof value === 'string' ? parseFloat(value.replace(',', '.')) : Number(value);
  return isNaN(num) ? undefined : num;
};

const parseBoolean = (value: unknown): boolean => {
  if (!value) return false;
  const str = String(value).toLowerCase().trim();
  return str === 'да' || str === 'yes' || str === 'true' || str === '1';
};

// Нормализация типа материала (поддержка разных вариантов написания)
const normalizeMaterialType = (value: string | undefined): 'основн.' | 'вспомогат.' | undefined => {
  if (!value) return undefined;

  const original = String(value).trim();
  const normalized = original.toLowerCase()
    .replace(/\s+/g, '')  // Убираем пробелы
    .replace(/\.$/, '');   // Убираем точку в конце если есть

  let result: 'основн.' | 'вспомогат.' | undefined = undefined;

  // Основной материал
  if (normalized === 'основной' || normalized === 'основн' || normalized === 'основ' || normalized === 'осн') {
    result = 'основн.';
  }
  // Вспомогательный материал
  else if (normalized === 'вспомогательный' || normalized === 'вспомогат' || normalized === 'вспом') {
    result = 'вспомогат.';
  }
  // Если уже в нужном формате
  else if (original === 'основн.' || original === 'вспомогат.') {
    result = original as 'основн.' | 'вспомогат.';
  }

  if (original !== result) {
    console.log(`[MaterialType] Нормализация: "${original}" -> "${result}"`);
  }

  return result;
};

// Нормализация типа доставки (поддержка разных вариантов написания)
const normalizeDeliveryPriceType = (value: string | undefined): 'в цене' | 'не в цене' | 'суммой' | undefined => {
  if (!value) return undefined;

  const original = String(value).trim();
  const normalized = original.toLowerCase()
    .replace(/\s+/g, ' ');  // Нормализуем пробелы

  let result: 'в цене' | 'не в цене' | 'суммой' | undefined = undefined;

  // "в цене"
  if (normalized === 'в цене' || normalized === 'вцене' || normalized === 'входит') {
    result = 'в цене';
  }
  // "не в цене"
  else if (normalized === 'не в цене' || normalized === 'невцене' || normalized === 'не входит' || normalized === 'невходит') {
    result = 'не в цене';
  }
  // "суммой"
  else if (normalized === 'суммой' || normalized === 'доп. стоимость' || normalized === 'доп стоимость' || normalized === 'дополнительно') {
    result = 'суммой';
  }
  // Если уже в нужном формате
  else if (original === 'в цене' || original === 'не в цене' || original === 'суммой') {
    result = original as 'в цене' | 'не в цене' | 'суммой';
  }

  if (original !== result) {
    console.log(`[DeliveryPriceType] Нормализация: "${original}" -> "${result}"`);
  }

  return result;
};

// Парсинг затраты на строительство: "Категория / Детальная категория / Локация"
// ВАЖНО: Детальная категория может содержать слэши (например, "Плиты перекрытия / покрытия / разгрузочные")
// Формат: первая часть - категория, последняя часть - локация, всё между ними - детализация
const parseCostCategory = (text: string): { category?: string; detail?: string; location?: string } => {
  if (!text) return {};

  // Разбиваем по разделителю " / " (пробел-слэш-пробел)
  const parts = text.split(' / ').map(p => p.trim());

  if (parts.length === 1) {
    // Только одна часть - возможно ошибка
    return { category: parts[0] };
  } else if (parts.length === 2) {
    // Две части: category / detail (без location)
    return {
      category: parts[0],
      detail: parts[1],
    };
  } else {
    // Три или более частей:
    // category = первая часть
    // location = последняя часть
    // detail = всё между ними, объединенное через " / "
    const category = parts[0];
    const location = parts[parts.length - 1];
    const detail = parts.slice(1, parts.length - 1).join(' / ');

    return {
      category: category || undefined,
      detail: detail || undefined,
      location: location || undefined,
    };
  }
};

// ===========================
// ОСНОВНОЙ ХУК
// ===========================

export const useBoqItemsImport = () => {
  const { user } = useAuth();
  const [parsedData, setParsedData] = useState<ParsedBoqItem[]>([]);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Справочники
  const [workNamesMap, setWorkNamesMap] = useState<Map<string, string>>(new Map());
  const [materialNamesMap, setMaterialNamesMap] = useState<Map<string, string>>(new Map());
  const [costCategoriesMap, setCostCategoriesMap] = useState<Map<string, string>>(new Map());

  // Курсы валют
  const [currencyRates, setCurrencyRates] = useState({ usd: 1, eur: 1, cny: 1 });

  // ===========================
  // ЗАГРУЗКА СПРАВОЧНИКОВ
  // ===========================

  const loadNomenclature = async () => {
    try {
      {
      const [allWorks, allMaterials, allCosts] = await Promise.all([
        fetchAllPages<WorkNameRecord>((from, to) => (
          supabase
            .from('work_names')
            .select('id, name, unit')
            .order('name')
            .range(from, to)
        )),
        fetchAllPages<MaterialNameRecord>((from, to) => (
          supabase
            .from('material_names')
            .select('id, name, unit')
            .order('name')
            .range(from, to)
        )),
        fetchAllPages<CostCategoryRecord>((from, to) => (
          supabase
            .from('detail_cost_categories')
            .select(`
              id,
              name,
              location,
              cost_categories!inner(name)
            `)
            .order('name')
            .range(from, to)
        )),
      ]);

      const nextWorksMap = new Map<string, string>();
      allWorks.forEach((work) => {
        nextWorksMap.set(buildNomenclatureLookupKey(work.name, work.unit), work.id);
      });

      const nextMaterialsMap = new Map<string, string>();
      allMaterials.forEach((material) => {
        nextMaterialsMap.set(buildNomenclatureLookupKey(material.name, material.unit), material.id);
      });

      const nextCostsMap = new Map<string, string>();
      let costLogCount = 0;
      allCosts.forEach((cost) => {
        const cc = Array.isArray(cost.cost_categories) ? cost.cost_categories[0] : cost.cost_categories;
        const costCategoryName = cc?.name || '';
        const key = `${normalizeString(costCategoryName)}|${normalizeString(cost.name)}|${normalizeString(cost.location)}`;
        nextCostsMap.set(key, cost.id);

        const fullPath = normalizeString(`${costCategoryName} / ${cost.name} / ${cost.location}`);
        nextCostsMap.set(fullPath, cost.id);

        if (costLogCount < 5 || cost.name.includes('/') || costCategoryName.includes('/')) {
          console.log('[CostCategory] Р—Р°РіСЂСѓР¶РµРЅР° Р·Р°С‚СЂР°С‚Р°:', {
            category: costCategoryName,
            detail: cost.name,
            location: cost.location,
            key,
            fullPath,
          });
          costLogCount++;
        }
      });

      setWorkNamesMap(nextWorksMap);
      setMaterialNamesMap(nextMaterialsMap);
      setCostCategoriesMap(nextCostsMap);

      console.log('[BoqImport] Р—Р°РіСЂСѓР¶РµРЅРѕ СЃРїСЂР°РІРѕС‡РЅРёРєРѕРІ:', {
        works: nextWorksMap.size,
        materials: nextMaterialsMap.size,
        costs: nextCostsMap.size,
      });

      return true;
      }
      // Загрузка work_names
      const { data: works, error: worksError } = await supabase
        .from('work_names')
        .select('id, name, unit')
        .order('name');

      if (worksError) throw worksError;

      // Загрузка material_names
      const { data: materials, error: materialsError } = await supabase
        .from('material_names')
        .select('id, name, unit')
        .order('name');

      if (materialsError) throw materialsError;

      // Загрузка detail_cost_categories с JOIN
      const { data: costs, error: costsError } = await supabase
        .from('detail_cost_categories')
        .select(`
          id,
          name,
          location,
          cost_categories!inner(name)
        `)
        .order('name');

      if (costsError) throw costsError;

      // Создание Map для быстрого поиска
      const worksMap = new Map<string, string>();
      works?.forEach((w: WorkNameRecord) => {
        const key = `${normalizeString(w.name)}|${w.unit}`;
        worksMap.set(key, w.id);
      });

      const materialsMap = new Map<string, string>();
      materials?.forEach((m: MaterialNameRecord) => {
        const key = `${normalizeString(m.name)}|${m.unit}`;
        materialsMap.set(key, m.id);
      });

      const costsMap = new Map<string, string>();
      let costLogCount = 0;
      costs?.forEach((c: CostCategoryRecord) => {
        const ccc = Array.isArray(c.cost_categories) ? c.cost_categories[0] : c.cost_categories;
        const costCategoryName = ccc?.name || '';
        // Основной ключ - раздельные части
        const key = `${normalizeString(costCategoryName)}|${normalizeString(c.name)}|${normalizeString(c.location)}`;
        costsMap.set(key, c.id);

        // Альтернативный ключ - полная строка в формате Excel "category / detail / location"
        // Это позволяет находить затраты когда категория содержит слэши
        const fullPath = normalizeString(`${costCategoryName} / ${c.name} / ${c.location}`);
        costsMap.set(fullPath, c.id);

        // Логирование первых 5 затрат и затрат со слэшами в названии
        if (costLogCount < 5 || c.name.includes('/') || costCategoryName.includes('/')) {
          console.log('[CostCategory] Загружена затрата:', {
            category: costCategoryName,
            detail: c.name,
            location: c.location,
            key,
            fullPath,
          });
          costLogCount++;
        }
      });

      setWorkNamesMap(worksMap);
      setMaterialNamesMap(materialsMap);
      setCostCategoriesMap(costsMap);

      console.log('[BoqImport] Загружено справочников:', {
        works: worksMap.size,
        materials: materialsMap.size,
        costs: costsMap.size,
      });

      return true;
    } catch (error) {
      console.error('Ошибка загрузки справочников:', error);
      return false;
    }
  };

  // ===========================
  // ПАРСИНГ EXCEL
  // ===========================

  const parseExcelFile = async (file: File): Promise<boolean> => {
    return new Promise((resolve) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1 });

          // Пропускаем заголовок (первая строка)
          const rows = jsonData.slice(1);

          const parsed: ParsedBoqItem[] = [];

          rows.forEach((row: unknown, index: number) => {
            if (!Array.isArray(row)) return;

            // Проверяем, что строка не пустая
            const hasData = row.some(cell => cell !== undefined && cell !== null && cell !== '');
            if (!hasData) return;

            const cells = row as unknown[];
            const rowNum = index + 2; // +2 потому что индекс с 0 и пропустили заголовок

            // Маппинг колонок согласно структуре из шаблона
            const item: ParsedBoqItem = {
              rowIndex: rowNum,

              // Колонка 4: Тип элемента
              boq_item_type: cells[4] ? String(cells[4]).trim() as ParsedBoqItem['boq_item_type'] : 'мат',

              // Колонка 5: Тип материала (с нормализацией)
              material_type: normalizeMaterialType(cells[5] != null ? String(cells[5]) : undefined),

              // Колонка 6: Наименование
              nameText: cells[6] ? normalizeString(String(cells[6])) : '',

              // Колонка 7: Ед. изм.
              unit_code: cells[7] ? String(cells[7]).trim() : '',

              // Колонка 3: Привязка материала к работе
              bindToWork: parseBoolean(cells[3]),

              // Колонка 9: Коэфф. перевода
              conversion_coefficient: parseNumber(cells[9]),

              // Колонка 10: Коэфф. расхода
              consumption_coefficient: parseNumber(cells[10]),

              // Колонка 11: Количество (base_quantity для непривязанных материалов)
              base_quantity: parseNumber(cells[11]),
              quantity: parseNumber(cells[11]), // Будет пересчитано для привязанных материалов

              // Колонка 12: Валюта
              currency_type: cells[12] ? String(cells[12]).trim() as ParsedBoqItem['currency_type'] : 'RUB',

              // Колонка 13: Тип доставки (с нормализацией)
              delivery_price_type: normalizeDeliveryPriceType(cells[13] != null ? String(cells[13]) : undefined),

              // Колонка 14: Стоимость доставки
              delivery_amount: parseNumber(cells[14]),

              // Колонка 15: Цена за единицу
              unit_rate: parseNumber(cells[15]),

              // Колонка 2: Затрата на строительство
              costCategoryText: cells[2] ? String(cells[2]).trim() : '',

              // Колонка 17: Ссылка на КП
              quote_link: cells[17] ? String(cells[17]).trim() : undefined,

              // Колонка 19: Примечание ГП
              description: cells[19] ? String(cells[19]).trim() : undefined,

              // Сортировка
              sort_number: index,
            };

            parsed.push(item);
          });

          setParsedData(parsed);

          // ЛОГИРОВАНИЕ: Показываем порядок элементов после парсинга
          console.log('=== ПАРСИНГ EXCEL ЗАВЕРШЁН ===');
          console.log(`Всего строк: ${parsed.length}`);
          console.log('Первые 10 элементов из файла (в порядке чтения):');
          parsed.slice(0, 10).forEach((item, idx) => {
            console.log(`  ${idx}: [Строка ${item.rowIndex}] ${item.nameText} (${item.boq_item_type})`);
          });

          // Сразу запускаем валидацию
          const validation = validateParsedData(parsed);
          setValidationResult(validation);

          message.success(`Файл обработан: ${parsed.length} строк`);
          resolve(true);
        } catch (error) {
          console.error('Ошибка парсинга Excel:', error);
          message.error('Ошибка при чтении файла Excel');
          resolve(false);
        }
      };

      reader.onerror = () => {
        message.error('Ошибка чтения файла');
        resolve(false);
      };

      reader.readAsBinaryString(file);
    });
  };

  // ===========================
  // ВАЛИДАЦИЯ
  // ===========================

  const validateParsedData = (data: ParsedBoqItem[]): ValidationResult => {
    console.log('[BoqImport] Валидация данных:', {
      rows: data.length,
      workNamesMapSize: workNamesMap.size,
      materialNamesMapSize: materialNamesMap.size,
    });

    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const missingWorksMap = new Map<string, MissingNomenclatureGroup>();
    const missingMaterialsMap = new Map<string, MissingNomenclatureGroup>();
    const unknownCostsMap = new Map<string, number[]>();

    const validBoqTypes = ['раб', 'суб-раб', 'раб-комп.', 'мат', 'суб-мат', 'мат-комп.'];
    const validMaterialTypes = ['основн.', 'вспомогат.'];
    const validCurrencies = ['RUB', 'USD', 'EUR', 'CNY'];
    const validDeliveryTypes = ['в цене', 'не в цене', 'суммой'];

    data.forEach((item) => {
      const row = item.rowIndex;

      // 1. Проверка обязательных полей
      if (!item.nameText) {
        errors.push({
          rowIndex: row,
          type: 'missing_field',
          field: 'nameText',
          message: 'Отсутствует наименование',
          severity: 'error',
        });
      }

      if (!item.unit_code) {
        errors.push({
          rowIndex: row,
          type: 'missing_field',
          field: 'unit_code',
          message: 'Отсутствует единица измерения',
          severity: 'error',
        });
      }

      // КРИТИЧЕСКОЕ: Проверка обязательной затраты на строительство
      if (!item.costCategoryText || item.costCategoryText.trim() === '') {
        errors.push({
          rowIndex: row,
          type: 'missing_field',
          field: 'costCategoryText',
          message: 'Отсутствует затрата на строительство (колонка 3 обязательна!)',
          severity: 'error',
        });
      }

      // 2. Проверка типа элемента
      if (!validBoqTypes.includes(item.boq_item_type)) {
        errors.push({
          rowIndex: row,
          type: 'invalid_type',
          field: 'boq_item_type',
          message: `Недопустимый тип элемента: "${item.boq_item_type}". Допустимые: ${validBoqTypes.join(', ')}`,
          severity: 'error',
        });
      }

      // 3. Проверка типа материала (только для материалов)
      if (isMaterial(item.boq_item_type) && item.material_type && !validMaterialTypes.includes(item.material_type)) {
        errors.push({
          rowIndex: row,
          type: 'invalid_type',
          field: 'material_type',
          message: `Недопустимый тип материала: "${item.material_type}". Допустимые: ${validMaterialTypes.join(', ')}`,
          severity: 'error',
        });
      }

      // 4. Проверка валюты
      if (!validCurrencies.includes(item.currency_type)) {
        errors.push({
          rowIndex: row,
          type: 'invalid_type',
          field: 'currency_type',
          message: `Недопустимая валюта: "${item.currency_type}". Допустимые: ${validCurrencies.join(', ')}`,
          severity: 'error',
        });
      }

      // 5. Проверка типа доставки
      if (item.delivery_price_type && !validDeliveryTypes.includes(item.delivery_price_type)) {
        errors.push({
          rowIndex: row,
          type: 'invalid_type',
          field: 'delivery_price_type',
          message: `Недопустимый тип доставки: "${item.delivery_price_type}". Допустимые: ${validDeliveryTypes.join(', ')}`,
          severity: 'error',
        });
      }

      // 6. КРИТИЧНО: Проверка наличия в номенклатуре
      if (isWork(item.boq_item_type)) {
        const key = buildNomenclatureLookupKey(item.nameText, item.unit_code);
        const workId = workNamesMap.get(key);

        if (!workId) {
          errors.push({
            rowIndex: row,
            type: 'missing_nomenclature',
            field: 'work_name',
            message: `Работа "${item.nameText}" [${item.unit_code}] отсутствует в номенклатуре`,
            severity: 'error',
          });

          // Группировка для отчета
          const groupKey = `${item.nameText}|${item.unit_code}`;
          if (!missingWorksMap.has(groupKey)) {
            missingWorksMap.set(groupKey, { name: item.nameText, unit: item.unit_code, rows: [] });
          }
          missingWorksMap.get(groupKey)!.rows.push(row);
        } else {
          item.work_name_id = workId;
        }
      }

      if (isMaterial(item.boq_item_type)) {
        const key = buildNomenclatureLookupKey(item.nameText, item.unit_code);
        const materialId = materialNamesMap.get(key);

        if (!materialId) {
          errors.push({
            rowIndex: row,
            type: 'missing_nomenclature',
            field: 'material_name',
            message: `Материал "${item.nameText}" [${item.unit_code}] отсутствует в номенклатуре`,
            severity: 'error',
          });

          // Группировка для отчета
          const groupKey = `${item.nameText}|${item.unit_code}`;
          if (!missingMaterialsMap.has(groupKey)) {
            missingMaterialsMap.set(groupKey, { name: item.nameText, unit: item.unit_code, rows: [] });
          }
          missingMaterialsMap.get(groupKey)!.rows.push(row);
        } else {
          item.material_name_id = materialId;
        }
      }

      // 7. Проверка затраты на строительство (ОБЯЗАТЕЛЬНАЯ)
      if (item.costCategoryText) {
        // Сначала пробуем найти по полной строке (более надёжный способ)
        const fullPath = normalizeString(item.costCategoryText);
        let costId = costCategoriesMap.get(fullPath);

        // Если не нашли по полной строке, пробуем парсить на части
        let key = fullPath;
        if (!costId) {
          const parsed = parseCostCategory(item.costCategoryText);
          if (parsed.category && parsed.detail && parsed.location) {
            key = `${normalizeString(parsed.category)}|${normalizeString(parsed.detail)}|${normalizeString(parsed.location)}`;
            costId = costCategoriesMap.get(key);
          }
        }

        console.log(`[CostCategory] Строка ${row}:`, {
          original: item.costCategoryText,
          fullPath,
          key,
          found: !!costId,
        });

        if (!costId) {
          errors.push({
            rowIndex: row,
            type: 'missing_cost',
            field: 'detail_cost_category_id',
            message: `Затрата "${item.costCategoryText}" не найдена в БД`,
            severity: 'error',
          });

          if (!unknownCostsMap.has(item.costCategoryText)) {
            unknownCostsMap.set(item.costCategoryText, []);
          }
          unknownCostsMap.get(item.costCategoryText)!.push(row);
        } else {
          item.detail_cost_category_id = costId;
        }
      }
    });

    const result: ValidationResult = {
      isValid: errors.length === 0,
      errors,
      warnings,
      missingNomenclature: {
        works: Array.from(missingWorksMap.values()),
        materials: Array.from(missingMaterialsMap.values()),
      },
      unknownCosts: Array.from(unknownCostsMap.entries()).map(([text, rows]) => ({ text, rows })),
    };

    console.log('[BoqImport] Результат валидации:', {
      isValid: result.isValid,
      errorsCount: errors.length,
      warningsCount: warnings.length,
      missingWorks: result.missingNomenclature.works.length,
      missingMaterials: result.missingNomenclature.materials.length,
    });

    setValidationResult(result);
    return result;
  };

  // ===========================
  // ОБРАБОТКА ПРИВЯЗОК
  // ===========================

  const processWorkBindings = (data: ParsedBoqItem[]): ValidationError[] => {
    const errors: ValidationError[] = [];
    let lastWork: ParsedBoqItem | null = null;

    data.forEach((item) => {
      if (isWork(item.boq_item_type)) {
        lastWork = item;
        item.tempId = `work_${item.rowIndex}`;
      } else if (item.bindToWork) {
        if (!lastWork) {
          errors.push({
            rowIndex: item.rowIndex,
            type: 'binding_error',
            field: 'parent_work_item_id',
            message: 'Материал с привязкой, но работа не найдена выше',
            severity: 'error',
          });
        } else {
          item.parent_work_item_id = lastWork.tempId;

          // Расчет quantity: работа.quantity * коэфф.перевода * коэфф.расхода
          const workQty = lastWork.quantity || 0;
          const convCoef = item.conversion_coefficient || 1;
          const consCoef = item.consumption_coefficient || 1;
          item.quantity = workQty * convCoef * consCoef;
        }
      } else {
        // Независимый материал: quantity = base_quantity (коэфф.расхода применяется при расчёте стоимости)
        item.quantity = item.base_quantity || 0;
      }
    });

    return errors;
  };

  // ===========================
  // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ РАСЧЕТА
  // ===========================

  const getCurrencyRate = (currency: string, rates?: { usd: number; eur: number; cny: number }): number => {
    const actualRates = rates || currencyRates;
    switch (currency) {
      case 'USD':
        return actualRates.usd;
      case 'EUR':
        return actualRates.eur;
      case 'CNY':
        return actualRates.cny;
      case 'RUB':
      default:
        return 1;
    }
  };

  const calculateTotalAmount = (item: ParsedBoqItem, rates?: { usd: number; eur: number; cny: number }): number => {
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

  const loadCurrencyRates = async (tenderId: string): Promise<{ usd: number; eur: number; cny: number }> => {
    try {
      const { data: tender, error } = await supabase
        .from('tenders')
        .select('usd_rate, eur_rate, cny_rate')
        .eq('id', tenderId)
        .single();

      if (error) {
        console.error('[BoqImport] Ошибка загрузки курсов валют:', error);
        throw new Error(`Не удалось загрузить курсы валют из тендера: ${error.message}`);
      }

      if (!tender) {
        console.error('[BoqImport] Тендер не найден:', tenderId);
        throw new Error('Тендер не найден');
      }

      const rates = {
        usd: tender.usd_rate || 1,
        eur: tender.eur_rate || 1,
        cny: tender.cny_rate || 1,
      };

      setCurrencyRates(rates);

      console.log('[BoqImport] Курсы валют загружены:', rates);

      return rates;
    } catch (error) {
      console.error('[BoqImport] Критическая ошибка загрузки курсов валют:', error);
      throw error;
    }
  };

  // ===========================
  // ВСТАВКА В БД
  // ===========================

  const insertBoqItems = async (
    data: ParsedBoqItem[],
    positionId: string,
    tenderId: string
  ): Promise<boolean> => {
    try {
      setUploading(true);
      setUploadProgress(0);

      // Загружаем курсы валют из tender
      const rates = await loadCurrencyRates(tenderId);

      // Получаем максимальный sort_number из существующих записей
      const { data: existingItems } = await supabase
        .from('boq_items')
        .select('sort_number')
        .eq('client_position_id', positionId)
        .order('sort_number', { ascending: false })
        .limit(1);

      const maxSortNumber = existingItems?.[0]?.sort_number ?? -1;
      console.log('[BoqImport] Максимальный sort_number:', maxSortNumber);

      const totalItems = data.length;
      let processedItems = 0;

      // Map для хранения tempId -> realId (для привязки материалов к работам)
      const workIdMap = new Map<string, string>();

      // Вставляем элементы в том же порядке, что и в файле
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        const actualSortNumber = maxSortNumber + 1 + i;

        // Логирование первых 3 элементов для отладки сортировки
        if (i < 3) {
          console.log(`[BoqImport] Вставка элемента ${i}:`, {
            nameText: item.nameText,
            type: item.boq_item_type,
            rowIndex: item.rowIndex,
            sort_number: actualSortNumber,
          });
        }

        // Для материалов с привязкой к работе - заменяем временный ID на реальный
        const parentId = item.parent_work_item_id
          ? workIdMap.get(item.parent_work_item_id) || null
          : null;

        // Рассчитываем итоговую сумму с передачей курсов валют
        const totalAmount = calculateTotalAmount(item, rates);

        // Формируем данные для вставки
        const insertData: Record<string, unknown> = {
          tender_id: tenderId,
          client_position_id: positionId,
          sort_number: actualSortNumber,
          boq_item_type: item.boq_item_type,
          unit_code: item.unit_code,
          quantity: item.quantity,
          base_quantity: item.base_quantity,
          consumption_coefficient: item.consumption_coefficient,
          conversion_coefficient: item.conversion_coefficient,
          currency_type: item.currency_type,
          delivery_price_type: item.delivery_price_type,
          delivery_amount: item.delivery_amount,
          unit_rate: item.unit_rate,
          total_amount: totalAmount,
          detail_cost_category_id: item.detail_cost_category_id,
          quote_link: item.quote_link,
          description: item.description,
        };

        // Добавляем специфичные поля для работ
        if (isWork(item.boq_item_type)) {
          insertData.work_name_id = item.work_name_id;
        }

        // Добавляем специфичные поля для материалов
        if (isMaterial(item.boq_item_type)) {
          insertData.material_type = item.material_type;
          insertData.material_name_id = item.material_name_id;
          insertData.parent_work_item_id = parentId;
        }

        // Вставляем элемент
        const { data: inserted } = await insertBoqItemWithAudit(user?.id, insertData);

        if (!inserted?.id) {
          throw new Error(`Row ${item.rowIndex}: insert RPC did not return BOQ item ID`);
        }

        // Сохраняем ID работы для привязки материалов
        if (isWork(item.boq_item_type) && item.tempId && inserted?.id) {
          workIdMap.set(item.tempId, inserted.id);
        }

        processedItems++;
        setUploadProgress(Math.round((processedItems / totalItems) * 100));
      }

      console.log('[BoqImport] Импорт завершён. Всего элементов:', totalItems);
      console.log('[BoqImport] Диапазон sort_number:', `${maxSortNumber + 1} - ${maxSortNumber + totalItems}`);
      message.success(`Успешно импортировано ${totalItems} элементов`);
      return true;
    } catch (error) {
      console.error('Ошибка импорта:', error);
      message.error('Ошибка при импорте: ' + getErrorMessage(error));
      return false;
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // ===========================
  // ПУБЛИЧНЫЙ API
  // ===========================

  const addMissingToNomenclature = async (): Promise<boolean> => {
    if (!validationResult) return false;

    const { works, materials } = validationResult.missingNomenclature;
    if (works.length === 0 && materials.length === 0) {
      return true;
    }

    try {
      setUploading(true);

      const existingWorkKeys = new Set(workNamesMap.keys());
      const existingMaterialKeys = new Set(materialNamesMap.keys());

      const uniqueWorksToInsert = Array.from(
        new Map(
          works.map((work) => [
            buildNomenclatureLookupKey(work.name, work.unit),
            { name: work.name, unit: work.unit },
          ])
        ).entries()
      )
        .filter(([key]) => !existingWorkKeys.has(key))
        .map(([, value]) => value);

      const uniqueMaterialsToInsert = Array.from(
        new Map(
          materials.map((material) => [
            buildNomenclatureLookupKey(material.name, material.unit),
            { name: material.name, unit: material.unit },
          ])
        ).entries()
      )
        .filter(([key]) => !existingMaterialKeys.has(key))
        .map(([, value]) => value);

      if (uniqueWorksToInsert.length > 0) {
        const { error } = await supabase
          .from('work_names')
          .insert(uniqueWorksToInsert);

        if (error) {
          throw new Error(`РћС€РёР±РєР° РґРѕР±Р°РІР»РµРЅРёСЏ СЂР°Р±РѕС‚: ${error.message}`);
        }
      }

      if (uniqueMaterialsToInsert.length > 0) {
        const { error } = await supabase
          .from('material_names')
          .insert(uniqueMaterialsToInsert);

        if (error) {
          throw new Error(`РћС€РёР±РєР° РґРѕР±Р°РІР»РµРЅРёСЏ РјР°С‚РµСЂРёР°Р»РѕРІ: ${error.message}`);
        }
      }

      await loadNomenclature();

      const total = uniqueWorksToInsert.length + uniqueMaterialsToInsert.length;
      if (total > 0) {
        message.success(`Р”РѕР±Р°РІР»РµРЅРѕ РІ РЅРѕРјРµРЅРєР»Р°С‚СѓСЂСѓ: ${total} Р·Р°РїРёСЃРµР№. РўРµРїРµСЂСЊ РЅР°Р¶РјРёС‚Рµ В«Р—Р°РіСЂСѓР·РёС‚СЊВ».`);
      } else {
        message.info('РџРѕРґС…РѕРґСЏС‰РёРµ Р·Р°РїРёСЃРё СѓР¶Рµ РµСЃС‚СЊ РІ РЅРѕРјРµРЅРєР»Р°С‚СѓСЂРµ. РўРµРїРµСЂСЊ РЅР°Р¶РјРёС‚Рµ В«Р—Р°РіСЂСѓР·РёС‚СЊВ».');
      }

      return true;
    } catch (error) {
      message.error(getErrorMessage(error));
      return false;
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    setParsedData([]);
    setValidationResult(null);
    setUploadProgress(0);
  };

  return {
    // Данные
    parsedData,
    validationResult,
    uploading,
    uploadProgress,

    // Методы
    loadNomenclature,
    parseExcelFile,
    validateParsedData,
    processWorkBindings,
    insertBoqItems,
    addMissingToNomenclature,
    reset,
  };
};
