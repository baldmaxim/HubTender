import * as XLSX from 'xlsx';
import { apiFetch } from '../lib/api/client';

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
   * Парсит Excel на клиенте и отправляет один атомарный запрос на Go BFF
   * (POST /api/v1/cost-import): cost_categories find-or-create +
   * detail_cost_categories bulk-insert в одной транзакции.
   *
   * NOTE: Yandex-схема хранит location как TEXT на detail_cost_categories
   * (без таблицы locations / location_id — это была старая Supabase-схема).
   * @param file - Excel файл для импорта
   * @param onProgress - Callback прогресса
   */
  async importFromExcel(
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<{ success: boolean; recordsAdded: number; error?: string }> {
    try {
      const data = await readExcelFile(file);

      if (!data || data.length === 0) {
        return { success: false, recordsAdded: 0, error: 'Файл не содержит данных для импорта' };
      }

      onProgress?.(20);

      const { categories, detailItems } = parseImportData(data);

      onProgress?.(50);

      const res = await apiFetch<{ records_added: number }>('/api/v1/cost-import', {
        method: 'POST',
        timeoutMs: 0,
        body: JSON.stringify({
          categories: Array.from(categories.values()),
          detail_items: detailItems.map((d) => ({
            order_num: d.orderNum,
            category_name: d.categoryName,
            category_unit: d.categoryUnit,
            cost_name: d.costName,
            cost_unit: d.costUnit,
            location: d.location,
          })),
        }),
      });

      onProgress?.(100);

      return { success: true, recordsAdded: res.records_added };
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
  const detailItems: ImportData[] = [];

  rows.forEach(row => {
    const [orderNum, categoryName, categoryUnit, costName, costUnit, location] = row;

    if (categoryName && categoryUnit) {
      const key = `${categoryName}_${categoryUnit}`;
      if (!uniqueCategories.has(key)) {
        uniqueCategories.set(key, {
          name: String(categoryName).trim(),
          unit: String(categoryUnit).trim()
        });
      }
    }

    if (orderNum && costName && costUnit) {
      detailItems.push({
        orderNum: Number(orderNum),
        categoryName: String(categoryName).trim(),
        categoryUnit: String(categoryUnit).trim(),
        costName: String(costName).trim(),
        costUnit: String(costUnit).trim(),
        location: location ? String(location).trim() : '',
      });
    }
  });

  return {
    categories: uniqueCategories,
    detailItems
  };
}
