import { useState } from 'react';
import * as XLSX from 'xlsx';
import { message } from 'antd';
import { supabase } from '../../../lib/supabase';
import {
  ParsedBoqItem,
  PositionUpdateData,
  ValidationResult,
  ClientPosition,
  isWork,
  isMaterial,
  normalizeString,
  buildNomenclatureLookupKey,
  normalizePositionNumber,
  parseExcelData,
  validateBoqData,
  processWorkBindings,
  calculateTotalAmount,
} from '../utils';
import { getErrorMessage } from '../../../utils/errors';

const PAGE_SIZE = 1000;

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

// ===========================
// ОСНОВНОЙ ХУК
// ===========================

export const useMassBoqImport = () => {
  const [parsedData, setParsedData] = useState<ParsedBoqItem[]>([]);
  const [positionUpdates, setPositionUpdates] = useState<Map<string, PositionUpdateData>>(new Map());
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileName, setFileName] = useState<string>('');

  // Справочники
  const [workNamesMap, setWorkNamesMap] = useState<Map<string, string>>(new Map());
  const [materialNamesMap, setMaterialNamesMap] = useState<Map<string, string>>(new Map());
  const [costCategoriesMap, setCostCategoriesMap] = useState<Map<string, string>>(new Map());
  const [clientPositionsMap, setClientPositionsMap] = useState<Map<string, ClientPosition>>(new Map());

  // Единицы измерения — для маппинга
  const [availableUnits, setAvailableUnits] = useState<{ code: string; name: string }[]>([]);
  const [unitMappings, setUnitMappings] = useState<Record<string, string>>({});

  // Существующие BOQ items по позициям (для предпросмотра)
  const [existingItemsByPosition, setExistingItemsByPosition] = useState<Map<string, { id: string; work_names?: { name?: string } | null; material_names?: { name?: string } | null; boq_item_type?: string | null; quantity?: number | null; total_amount?: number | null; client_position_id: string }[]>>(new Map());

  // Курсы валют
  const [currencyRates, setCurrencyRates] = useState({ usd: 1, eur: 1, cny: 1 });

  // ===========================
  // ЗАГРУЗКА СПРАВОЧНИКОВ
  // ===========================

  const loadNomenclature = async (tenderId: string) => {
    try {
      const [
        worksData,
        materialsData,
        costsData,
        positionsData,
        unitsResult,
      ] = await Promise.all([
        fetchAllPages<{ id: string; name: string; unit: string }>((from, to) => (
          supabase
            .from('work_names')
            .select('id, name, unit')
            .order('name')
            .range(from, to)
        )),
        fetchAllPages<{ id: string; name: string; unit: string }>((from, to) => (
          supabase
            .from('material_names')
            .select('id, name, unit')
            .order('name')
            .range(from, to)
        )),
        fetchAllPages<{ id: string; name: string; location: string; cost_categories: { name: string }[] | { name: string } | null }>((from, to) => (
          supabase
            .from('detail_cost_categories')
            .select(`
              id, name, location,
              cost_categories!inner(name)
            `)
            .order('name')
            .range(from, to)
        )),
        fetchAllPages<{ id: string; position_number: string; work_name: string | null }>((from, to) => (
          supabase
            .from('client_positions')
            .select('id, position_number, work_name')
            .eq('tender_id', tenderId)
            .order('position_number')
            .range(from, to)
        )),
        supabase
          .from('units')
          .select('code, name')
          .eq('is_active', true)
          .order('code'),
      ]);

      const worksMap = new Map<string, string>();
      worksData.forEach((w) => {
        worksMap.set(buildNomenclatureLookupKey(w.name, w.unit), w.id);
      });

      const materialsMap = new Map<string, string>();
      materialsData.forEach((m) => {
        materialsMap.set(buildNomenclatureLookupKey(m.name, m.unit), m.id);
      });

      const costsMap = new Map<string, string>();
      costsData.forEach((c) => {
        const cc = Array.isArray(c.cost_categories) ? c.cost_categories[0] : c.cost_categories;
        const costCategoryName = cc?.name || '';
        costsMap.set(
          `${normalizeString(costCategoryName)}|${normalizeString(c.name)}|${normalizeString(c.location)}`,
          c.id
        );
      });

      console.log('[MassBoqImport] Затраты ВИС в БД:',
        Array.from(costsMap.keys()).filter(k => k.toLowerCase().startsWith('вис')).slice(0, 30)
      );

      const positionsMap = new Map<string, ClientPosition>();
      positionsData.forEach((p) => {
        const normalizedNum = normalizePositionNumber(p.position_number);
        positionsMap.set(normalizedNum, {
          id: p.id,
          position_number: Number(p.position_number),
          work_name: p.work_name ?? '',
        });
      });

      console.log('[MassBoqImport] Первые 20 позиций в БД:',
        Array.from(positionsMap.entries()).slice(0, 20).map(([key, val]) =>
          `${key} (raw: ${val.position_number})`
        )
      );

      setWorkNamesMap(worksMap);
      setMaterialNamesMap(materialsMap);
      setCostCategoriesMap(costsMap);
      setClientPositionsMap(positionsMap);
      setAvailableUnits((unitsResult.data || []) as { code: string; name: string }[]);
      setUnitMappings({});

      console.log('[MassBoqImport] Загружено справочников:', {
        works: worksMap.size,
        materials: materialsMap.size,
        costs: costsMap.size,
        positions: positionsMap.size,
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
    setFileName(file.name);
    return new Promise((resolve) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1 });

          const rows = jsonData.slice(1);
          const { parsed, posUpdates } = parseExcelData(rows);

          setParsedData(parsed);
          setPositionUpdates(posUpdates);

          const positionOnlyCount = Array.from(posUpdates.values()).filter(
            p => p.itemsCount === 0 && (p.manualVolume !== undefined || p.manualNote !== undefined)
          ).length;

          const parts: string[] = [];
          if (parsed.length > 0) {
            parts.push(`${parsed.length} элементов BOQ`);
          }
          if (positionOnlyCount > 0) {
            parts.push(`${positionOnlyCount} позиций с данными ГП`);
          }
          message.success(`Файл обработан: ${parts.join(', ')} в ${posUpdates.size} позициях`);
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
  // ВАЛИДАЦИЯ (обёртка)
  // ===========================

  const validateParsedData = (data: ParsedBoqItem[]): ValidationResult => {
    const result = validateBoqData(data, positionUpdates, {
      clientPositionsMap,
      workNamesMap,
      materialNamesMap,
      costCategoriesMap,
    });
    setValidationResult(result);
    return result;
  };

  // ===========================
  // ЗАГРУЗКА КУРСОВ ВАЛЮТ
  // ===========================

  const loadCurrencyRates = async (tenderId: string): Promise<{ usd: number; eur: number; cny: number }> => {
    const { data: tender, error } = await supabase
      .from('tenders')
      .select('usd_rate, eur_rate, cny_rate')
      .eq('id', tenderId)
      .single();

    if (error || !tender) {
      throw new Error('Не удалось загрузить курсы валют');
    }

    const rates = {
      usd: tender.usd_rate || 1,
      eur: tender.eur_rate || 1,
      cny: tender.cny_rate || 1,
    };

    setCurrencyRates(rates);
    return rates;
  };

  // ===========================
  // ВСТАВКА В БД
  // ===========================

  const insertBoqItems = async (
    data: ParsedBoqItem[],
    tenderId: string,
    userId?: string,
  ): Promise<boolean> => {
    try {
      setUploading(true);
      setUploadProgress(5);

      const positionUpdatesPayload = Array.from(positionUpdates.values())
        .filter(posData =>
          posData.positionId &&
          (posData.manualVolume !== undefined || posData.manualNote !== undefined)
        )
        .map((posData) => {
          const payload: Record<string, unknown> = {
            position_id: posData.positionId,
            position_number: posData.positionNumber,
          };

          if (posData.manualVolume !== undefined) {
            payload.manual_volume = posData.manualVolume;
          }
          if (posData.manualNote !== undefined) {
            payload.manual_note = posData.manualNote;
          }

          return payload;
        });

      let rates = currencyRates;
      if (data.length > 0) {
        rates = await loadCurrencyRates(tenderId);
      }

      const itemsPayload = data
        .filter(item => item.matchedPositionId)
        .map((item) => {
          const payload: Record<string, unknown> = {
            row_index: item.rowIndex,
            client_position_id: item.matchedPositionId,
            boq_item_type: item.boq_item_type,
            unit_code: item.unit_code,
            quantity: item.quantity,
            total_amount: calculateTotalAmount(item, rates),
          };

          if (item.base_quantity !== undefined) {
            payload.base_quantity = item.base_quantity;
          }
          if (item.consumption_coefficient !== undefined) {
            payload.consumption_coefficient = item.consumption_coefficient;
          }
          if (item.conversion_coefficient !== undefined) {
            payload.conversion_coefficient = item.conversion_coefficient;
          }
          if (item.currency_type) {
            payload.currency_type = item.currency_type;
          }
          if (item.delivery_price_type) {
            payload.delivery_price_type = item.delivery_price_type;
          }
          if (item.delivery_amount !== undefined) {
            payload.delivery_amount = item.delivery_amount;
          }
          if (item.unit_rate !== undefined) {
            payload.unit_rate = item.unit_rate;
          }
          if (item.detail_cost_category_id) {
            payload.detail_cost_category_id = item.detail_cost_category_id;
          }
          if (item.quote_link) {
            payload.quote_link = item.quote_link;
          }
          if (item.description) {
            payload.description = item.description;
          }

          if (isWork(item.boq_item_type)) {
            payload.work_name_id = item.work_name_id;
            if (item.tempId) {
              payload.temp_id = item.tempId;
            }
          }

          if (isMaterial(item.boq_item_type)) {
            payload.material_type = item.material_type;
            payload.material_name_id = item.material_name_id;
            if (item.parent_work_item_id) {
              payload.parent_work_temp_id = item.parent_work_item_id;
            }
          }

          return payload;
        });

      setUploadProgress(15);

      const { data: rpcResult, error } = await supabase.rpc('bulk_import_client_position_boq', {
        p_user_id: userId || null,
        p_tender_id: tenderId,
        p_file_name: fileName || null,
        p_items: itemsPayload,
        p_position_updates: positionUpdatesPayload,
      });

      if (error) {
        throw error;
      }

      const rpcResultObj = rpcResult as Record<string, unknown> | null;
      const insertedItemsCount = Number(rpcResultObj?.inserted_items_count || 0);
      const updatedPositionsCount = Number(rpcResultObj?.updated_positions_count || 0);
      const importSessionId = (rpcResultObj?.import_session_id as string | null) || null;

      setUploadProgress(100);

      console.log('[MassBoqImport] Импорт завершён:', {
        boqItems: insertedItemsCount,
        positionUpdates: updatedPositionsCount,
        sessionId: importSessionId,
      });

      const msgParts: string[] = [];
      if (insertedItemsCount > 0) {
        msgParts.push(`${insertedItemsCount} элементов`);
      }
      if (updatedPositionsCount > 0) {
        msgParts.push(`обновлено ${updatedPositionsCount} позиций`);
      }
      message.success(`Импортировано: ${msgParts.join(', ')}`);
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
  // ЗАГРУЗКА СУЩЕСТВУЮЩИХ BOQ ITEMS (ПРЕДПРОСМОТР)
  // ===========================

  const loadExistingItems = async (positionIds: string[]) => {
    if (positionIds.length === 0) return;
    const { data } = await supabase
      .from('boq_items')
      .select('id, boq_item_type, quantity, total_amount, client_position_id, work_names(name), material_names(name)')
      .in('client_position_id', positionIds)
      .order('sort_number');

    const map = new Map<string, { id: string; work_names?: { name?: string } | null; material_names?: { name?: string } | null; boq_item_type?: string | null; quantity?: number | null; total_amount?: number | null; client_position_id: string }[]>();
    data?.forEach((item) => {
      if (!map.has(item.client_position_id)) map.set(item.client_position_id, []);
      map.get(item.client_position_id)!.push(item as unknown as { id: string; work_names?: { name?: string } | null; material_names?: { name?: string } | null; boq_item_type?: string | null; quantity?: number | null; total_amount?: number | null; client_position_id: string });
    });
    setExistingItemsByPosition(map);
  };

  // ===========================
  // ДОБАВЛЕНИЕ В НОМЕНКЛАТУРУ
  // ===========================

  const addMissingToNomenclature = async (tenderId: string): Promise<boolean> => {
    if (!validationResult) return false;
    const { works, materials } = validationResult.missingNomenclature;
    if (works.length === 0 && materials.length === 0) return true;

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
        if (error) throw new Error(`Ошибка добавления работ: ${error.message}`);
      }

      if (uniqueMaterialsToInsert.length > 0) {
        const { error } = await supabase
          .from('material_names')
          .insert(uniqueMaterialsToInsert);
        if (error) throw new Error(`Ошибка добавления материалов: ${error.message}`);
      }

      await loadNomenclature(tenderId);

      const total = uniqueWorksToInsert.length + uniqueMaterialsToInsert.length;
      if (total > 0) {
        message.success(`Добавлено в номенклатуру: ${total} записей. Теперь нажмите «Загрузить».`);
      } else {
        message.info('Подходящие записи уже есть в номенклатуре. Теперь нажмите «Загрузить».');
      }
      return true;
    } catch (error) {
      message.error(getErrorMessage(error));
      return false;
    } finally {
      setUploading(false);
    }
  };

  // ===========================
  // МАППИНГ ЕДИНИЦ ИЗМЕРЕНИЯ
  // ===========================

  // Единицы из Excel, отсутствующие в units таблице
  const getUnknownUnits = (): string[] => {
    if (!parsedData.length || !availableUnits.length) return [];
    const dbCodes = new Set(availableUnits.map(u => u.code));
    const unknown = new Set<string>();
    parsedData.forEach(item => {
      if (item.unit_code && !dbCodes.has(item.unit_code)) {
        unknown.add(item.unit_code);
      }
    });
    return Array.from(unknown).sort();
  };

  const setUnitMapping = (excelUnit: string, dbUnit: string) => {
    setUnitMappings(prev => ({ ...prev, [excelUnit]: dbUnit }));
  };

  // Применить маппинг — обновить unit_code во всех элементах parsedData
  const applyUnitMappings = (): boolean => {
    const unknowns = getUnknownUnits();
    if (unknowns.length === 0) return true;
    const unmapped = unknowns.filter(u => !unitMappings[u]);
    if (unmapped.length > 0) {
      message.warning(`Не все единицы сопоставлены: ${unmapped.join(', ')}`);
      return false;
    }
    setParsedData(prev => prev.map(item => ({
      ...item,
      unit_code: unitMappings[item.unit_code] || item.unit_code,
    })));
    return true;
  };

  // ===========================
  // ПУБЛИЧНЫЙ API
  // ===========================

  const reset = () => {
    setParsedData([]);
    setPositionUpdates(new Map());
    setValidationResult(null);
    setUploadProgress(0);
    setExistingItemsByPosition(new Map());
    setFileName('');
    setUnitMappings({});
  };

  const getPositionStats = () => {
    const stats = new Map<string, {
      positionNumber: string;
      positionName: string;
      matched: boolean;
      itemsCount: number;
      manualVolume?: number;
      manualNote?: string;
    }>();

    positionUpdates.forEach((data, posNum) => {
      const position = clientPositionsMap.get(posNum);
      stats.set(posNum, {
        positionNumber: posNum,
        positionName: position?.work_name || 'Не найдена',
        matched: !!position,
        itemsCount: data.itemsCount,
        manualVolume: data.manualVolume,
        manualNote: data.manualNote,
      });
    });

    return Array.from(stats.values());
  };

  return {
    // Данные
    parsedData,
    positionUpdates,
    validationResult,
    uploading,
    uploadProgress,
    clientPositionsMap,
    existingItemsByPosition,

    // Единицы измерения
    availableUnits,
    unitMappings,
    getUnknownUnits,
    setUnitMapping,
    applyUnitMappings,

    // Методы
    loadNomenclature,
    parseExcelFile,
    validateParsedData,
    processWorkBindings,
    insertBoqItems,
    addMissingToNomenclature,
    loadExistingItems,
    reset,
    getPositionStats,
  };
};
