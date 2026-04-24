import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

interface ImportData {
  orderNum: number;
  categoryName: string;
  categoryUnit: string;
  costName: string;
  costUnit: string;
  location: string;
}

export const costImportService = {
  /**
   * Обработка и импорт данных из Excel файла
   * @param file - Excel файл для импорта
   * @param onProgress - Callback для отслеживания прогресса
   * @returns Количество импортированных записей или ошибка
   */
  async importFromExcel(
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<{ success: boolean; recordsAdded: number; error?: string }> {
    try {
      // Читаем файл
      const data = await readExcelFile(file);

      if (!data || data.length === 0) {
        return { success: false, recordsAdded: 0, error: 'Файл не содержит данных для импорта' };
      }

      onProgress?.(10);

      // Парсим данные
      const { categories, locations, detailItems } = parseImportData(data);

      onProgress?.(30);

      // Импортируем локации
      const locationMap = await importLocations(locations);

      onProgress?.(50);

      // Импортируем категории
      const categoryMap = await importCategories(categories);

      onProgress?.(70);

      // Импортируем детальные категории
      const recordsAdded = await importDetailCategories(detailItems, categoryMap, locationMap);

      onProgress?.(100);

      return { success: true, recordsAdded };
    } catch (error) {
      console.error('Ошибка импорта:', error);
      return {
        success: false,
        recordsAdded: 0,
        error: error instanceof Error ? error.message : 'Неизвестная ошибка'
      };
    }
  }
};

/**
 * Чтение Excel файла
 */
async function readExcelFile(file: File): Promise<unknown[][] | null> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

        // Пропускаем заголовки и пустые строки
        const dataRows = jsonData.slice(1).filter(row => row && row.length >= 6);
        resolve(dataRows);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsBinaryString(file);
  });
}

/**
 * Парсинг импортируемых данных
 */
function parseImportData(rows: unknown[][]) {
  const uniqueCategories = new Map<string, { name: string; unit: string }>();
  const uniqueLocations = new Set<string>();
  const detailItems: ImportData[] = [];

  rows.forEach(row => {
    const [orderNum, categoryName, categoryUnit, costName, costUnit, location] = row;

    // Добавляем категорию
    if (categoryName && categoryUnit) {
      const key = `${categoryName}_${categoryUnit}`;
      if (!uniqueCategories.has(key)) {
        uniqueCategories.set(key, {
          name: String(categoryName).trim(),
          unit: String(categoryUnit).trim()
        });
      }
    }

    // Добавляем локацию
    if (location) {
      uniqueLocations.add(String(location).trim());
    }

    // Добавляем детальную запись
    if (orderNum && costName && costUnit) {
      detailItems.push({
        orderNum: Number(orderNum),
        categoryName: String(categoryName).trim(),
        categoryUnit: String(categoryUnit).trim(),
        costName: String(costName).trim(),
        costUnit: String(costUnit).trim(),
        location: String(location).trim(),
      });
    }
  });

  return {
    categories: uniqueCategories,
    locations: uniqueLocations,
    detailItems
  };
}

/**
 * Импорт локаций в базу данных
 */
async function importLocations(locations: Set<string>): Promise<Map<string, string>> {
  const locationMap = new Map<string, string>();

  console.log('Импорт локаций. Всего уникальных локаций:', locations.size);
  console.log('Локации для импорта:', Array.from(locations));

  for (const location of locations) {
    // Пропускаем пустые локации
    if (!location || location.trim() === '') {
      console.log('Пропускаем пустую локацию');
      continue;
    }

    try {
      // Проверяем существование локации
      const { data: existingLocation } = await supabase
        .from('locations')
        .select('id')
        .eq('location', location)
        .maybeSingle();

      if (existingLocation) {
        locationMap.set(location, existingLocation.id);
        console.log(`Локация "${location}" уже существует с ID: ${existingLocation.id}`);
      } else {
        // Создаем новую локацию
        const { data: newLocation, error } = await supabase
          .from('locations')
          .insert({ location })
          .select('id')
          .single();

        if (error) throw error;
        if (newLocation) {
          locationMap.set(location, newLocation.id);
          console.log(`Создана новая локация "${location}" с ID: ${newLocation.id}`);
        }
      }
    } catch (error) {
      console.error(`Ошибка при обработке локации "${location}":`, error);
    }
  }

  console.log('Импорт локаций завершен. Всего в маппинге:', locationMap.size);
  return locationMap;
}

/**
 * Импорт категорий затрат в базу данных
 */
async function importCategories(
  categories: Map<string, { name: string; unit: string }>
): Promise<Map<string, string>> {
  const categoryMap = new Map<string, string>();

  console.log('Импорт категорий. Всего уникальных категорий:', categories.size);
  console.log('Категории для импорта:', Array.from(categories.entries()));

  for (const [key, category] of categories) {
    try {
      // Проверяем существование категории
      const { data: existingCategory } = await supabase
        .from('cost_categories')
        .select('id')
        .eq('name', category.name)
        .eq('unit', category.unit)
        .maybeSingle();

      if (existingCategory) {
        categoryMap.set(key, existingCategory.id);
        console.log(`Категория "${category.name}" (${category.unit}) уже существует с ID: ${existingCategory.id}`);
      } else {
        // Создаем новую категорию
        const { data: newCategory, error } = await supabase
          .from('cost_categories')
          .insert({
            name: category.name,
            unit: category.unit,
          })
          .select('id')
          .single();

        if (error) throw error;
        if (newCategory) {
          categoryMap.set(key, newCategory.id);
          console.log(`Создана новая категория "${category.name}" (${category.unit}) с ID: ${newCategory.id}`);
        }
      }
    } catch (error) {
      console.error(`Ошибка при обработке категории "${category.name}":`, error);
    }
  }

  console.log('Импорт категорий завершен. Всего в маппинге:', categoryMap.size);
  return categoryMap;
}

/**
 * Импорт детальных категорий затрат
 */
async function importDetailCategories(
  detailItems: ImportData[],
  categoryMap: Map<string, string>,
  locationMap: Map<string, string>
): Promise<number> {
  const detailsToInsert = [];
  let skippedCount = 0;

  console.log('Начинаем импорт детальных категорий. Всего элементов:', detailItems.length);
  console.log('Доступные категории:', Array.from(categoryMap.entries()));
  console.log('Доступные локации:', Array.from(locationMap.entries()));

  for (const item of detailItems) {
    const categoryKey = `${item.categoryName}_${item.categoryUnit}`;
    const categoryId = categoryMap.get(categoryKey);
    const locationId = item.location ? locationMap.get(item.location) : null;

    console.log(`Обработка элемента: ${item.costName}`, {
      categoryKey,
      categoryId,
      location: item.location,
      locationId
    });

    // Категория обязательна, локация - опциональна
    if (categoryId) {
      try {
        // Проверяем существование записи
        // Для проверки уникальности используем только category_id и name
        const { data: existing } = await supabase
          .from('detail_cost_categories')
          .select('id')
          .eq('cost_category_id', categoryId)
          .eq('name', item.costName)
          .maybeSingle();

        if (!existing) {
          const newDetail = {
            cost_category_id: categoryId,
            location_id: locationId, // может быть null
            name: item.costName,
            unit: item.costUnit,
            order_num: item.orderNum,
          };
          detailsToInsert.push(newDetail);
          console.log('Добавляем новую запись:', newDetail);
        } else {
          console.log('Запись уже существует, пропускаем:', item.costName);
        }
      } catch (error) {
        console.error('Ошибка при проверке существующей записи:', error);
      }
    } else {
      skippedCount++;
      console.warn(`Пропущена запись "${item.costName}" - категория не найдена (${categoryKey})`);
    }
  }

  console.log(`Готово к вставке: ${detailsToInsert.length} записей, пропущено: ${skippedCount}`);

  // Вставляем все новые записи одним запросом
  if (detailsToInsert.length > 0) {
    const { data, error } = await supabase
      .from('detail_cost_categories')
      .insert(detailsToInsert)
      .select();

    if (error) {
      console.error('Ошибка при вставке детальных категорий:', error);
      throw error;
    }

    console.log('Успешно вставлено записей:', data?.length || 0);
  }

  return detailsToInsert.length;
}