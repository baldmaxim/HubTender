import { useState } from 'react';
import * as XLSX from 'xlsx';
import { message } from 'antd';
import { useAuth } from '../../../contexts/AuthContext';
import { insertBoqItemWithAudit } from '../../../lib/api/boq';
import {
  listWorkNames,
  listMaterialNames,
  createWorkName,
  createMaterialName,
} from '../../../lib/api/nomenclatures';
import { listDetailCostCategoriesWithCategory } from '../../../lib/api/costs';
import { getTenderById } from '../../../lib/api/fi';
import { listBoqItemsFullByPosition } from '../../../lib/api/positions';
import { getErrorMessage } from '../../../utils/errors';
import {
  isWork,
  isMaterial,
  normalizeString,
  buildNomenclatureLookupKey,
  calculateTotalAmount,
  type ImportCurrencyRates,
} from '../../../utils/boq/importShared';
import { buildMissingNomenclatureInserts } from '../../../utils/boq/nomenclatureImport';
import type { ParsedBoqItem, ValidationResult, CostCategoryRecord } from '../utils/boqImportTypes';
import { parseBoqExcelRows, processWorkBindings as processWorkBindingsUtil } from '../utils/boqImportParser';
import { validateBoqData } from '../utils/boqImportValidation';

// Типы/парсер/валидация вынесены в ../utils/boqImport* (лимит ≤600 строк),
// общие с mass-импортом хелперы — в src/utils/boq/importShared.ts.

// ===========================
// ОСНОВНОЙ ХУК
// ===========================

export const useBoqItemsImport = () => {
  const { user } = useAuth();
  const [parsedData, setParsedData] = useState<ParsedBoqItem[]>([]);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  // Явный статус результата импорта — чтобы не выводить «успех» из uploadProgress.
  const [importStatus, setImportStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [importError, setImportError] = useState<string | null>(null);

  // Справочники
  const [workNamesMap, setWorkNamesMap] = useState<Map<string, string>>(new Map());
  const [materialNamesMap, setMaterialNamesMap] = useState<Map<string, string>>(new Map());
  const [costCategoriesMap, setCostCategoriesMap] = useState<Map<string, string>>(new Map());

  // ===========================
  // ЗАГРУЗКА СПРАВОЧНИКОВ
  // ===========================

  const loadNomenclature = async () => {
    try {
      {
      const [allWorks, allMaterials, allCostsRaw] = await Promise.all([
        listWorkNames(),
        listMaterialNames(),
        listDetailCostCategoriesWithCategory(),
      ]);
      // cost_categories!inner — оставляем только dcc с привязанной категорией.
      const allCosts = (allCostsRaw as unknown as CostCategoryRecord[])
        .filter((c) => c.cost_categories != null);

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

          const parsed = parseBoqExcelRows(rows);

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
  // ВАЛИДАЦИЯ (тонкая обёртка над чистой validateBoqData)
  // ===========================

  const validateParsedData = (data: ParsedBoqItem[]): ValidationResult => {
    const result = validateBoqData(data, { workNamesMap, materialNamesMap, costCategoriesMap });
    setValidationResult(result);
    return result;
  };

  // ===========================
  // ОБРАБОТКА ПРИВЯЗОК (вынесена в ../utils/boqImportParser)
  // ===========================

  const processWorkBindings = processWorkBindingsUtil;

  // ===========================
  // ЗАГРУЗКА КУРСОВ ВАЛЮТ
  // ===========================

  const loadCurrencyRates = async (tenderId: string): Promise<ImportCurrencyRates> => {
    try {
      const tender = await getTenderById(tenderId);
      if (!tender) {
        console.error('[BoqImport] Тендер не найден:', tenderId);
        throw new Error('Тендер не найден');
      }

      const rates = {
        usd: tender.usd_rate || 1,
        eur: tender.eur_rate || 1,
        cny: tender.cny_rate || 1,
      };

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
    let currentRow: number | null = null;
    try {
      setUploading(true);
      setUploadProgress(0);
      setImportStatus('running');
      setImportError(null);

      // Загружаем курсы валют из tender
      const rates = await loadCurrencyRates(tenderId);

      // Получаем максимальный sort_number из существующих записей.
      // Go: одна выборка boq_items позиции; max считаем на клиенте.
      const existingItems = await listBoqItemsFullByPosition(positionId);
      const maxSortNumber = existingItems.reduce<number>((m, it) => {
        const sn = (it as { sort_number?: number | null }).sort_number;
        return typeof sn === 'number' && sn > m ? sn : m;
      }, -1);
      console.log('[BoqImport] Максимальный sort_number:', maxSortNumber);

      const totalItems = data.length;
      let processedItems = 0;

      // Map для хранения tempId -> realId (для привязки материалов к работам)
      const workIdMap = new Map<string, string>();

      // Вставляем элементы в том же порядке, что и в файле
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        currentRow = item.rowIndex;
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
      setImportStatus('success');
      return true;
    } catch (error) {
      const detail = getErrorMessage(error);
      const withRow = currentRow != null ? `Строка ${currentRow}: ${detail}` : detail;
      console.error('Ошибка импорта:', error);
      setImportError(withRow);
      setImportStatus('error');
      message.error('Ошибка при импорте: ' + detail);
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

      const uniqueWorksToInsert = buildMissingNomenclatureInserts(works, existingWorkKeys);
      const uniqueMaterialsToInsert = buildMissingNomenclatureInserts(materials, existingMaterialKeys);

      if (uniqueWorksToInsert.length > 0) {
        await Promise.all(
          uniqueWorksToInsert.map((wkr) => createWorkName({ name: wkr.name, unit: wkr.unit })),
        );
      }

      if (uniqueMaterialsToInsert.length > 0) {
        await Promise.all(
          uniqueMaterialsToInsert.map((m) => createMaterialName({ name: m.name, unit: m.unit })),
        );
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
    setImportStatus('idle');
    setImportError(null);
  };

  return {
    // Данные
    parsedData,
    validationResult,
    uploading,
    uploadProgress,
    importStatus,
    importError,

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
