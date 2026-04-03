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
  normalizePositionNumber,
  parseExcelData,
  validateBoqData,
  processWorkBindings,
  calculateTotalAmount,
} from '../utils';

// ===========================
// ОСНОВНОЙ ХУК
// ===========================

export const useMassBoqImport = () => {
  const [parsedData, setParsedData] = useState<ParsedBoqItem[]>([]);
  const [positionUpdates, setPositionUpdates] = useState<Map<string, PositionUpdateData>>(new Map());
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Справочники
  const [workNamesMap, setWorkNamesMap] = useState<Map<string, string>>(new Map());
  const [materialNamesMap, setMaterialNamesMap] = useState<Map<string, string>>(new Map());
  const [costCategoriesMap, setCostCategoriesMap] = useState<Map<string, string>>(new Map());
  const [clientPositionsMap, setClientPositionsMap] = useState<Map<string, ClientPosition>>(new Map());

  // Курсы валют
  const [currencyRates, setCurrencyRates] = useState({ usd: 1, eur: 1, cny: 1 });

  // ===========================
  // ЗАГРУЗКА СПРАВОЧНИКОВ
  // ===========================

  const loadNomenclature = async (tenderId: string) => {
    try {
      const [worksResult, materialsResult, costsResult, positionsResult] = await Promise.all([
        supabase.from('work_names').select('id, name, unit').order('name'),
        supabase.from('material_names').select('id, name, unit').order('name'),
        supabase.from('detail_cost_categories').select(`
          id, name, location,
          cost_categories!inner(name)
        `).order('name'),
        supabase.from('client_positions')
          .select('id, position_number, work_name')
          .eq('tender_id', tenderId)
          .order('position_number'),
      ]);

      if (worksResult.error) throw worksResult.error;
      if (materialsResult.error) throw materialsResult.error;
      if (costsResult.error) throw costsResult.error;
      if (positionsResult.error) throw positionsResult.error;

      const worksMap = new Map<string, string>();
      worksResult.data?.forEach((w: any) => {
        worksMap.set(`${normalizeString(w.name)}|${w.unit}`, w.id);
      });

      const materialsMap = new Map<string, string>();
      materialsResult.data?.forEach((m: any) => {
        materialsMap.set(`${normalizeString(m.name)}|${m.unit}`, m.id);
      });

      const costsMap = new Map<string, string>();
      costsResult.data?.forEach((c: any) => {
        const costCategoryName = c.cost_categories?.name || '';
        costsMap.set(
          `${normalizeString(costCategoryName)}|${normalizeString(c.name)}|${normalizeString(c.location)}`,
          c.id
        );
      });

      console.log('[MassBoqImport] Затраты ВИС в БД:',
        Array.from(costsMap.keys()).filter(k => k.toLowerCase().startsWith('вис')).slice(0, 30)
      );

      const positionsMap = new Map<string, ClientPosition>();
      positionsResult.data?.forEach((p: any) => {
        const normalizedNum = normalizePositionNumber(p.position_number);
        positionsMap.set(normalizedNum, {
          id: p.id,
          position_number: p.position_number,
          work_name: p.work_name,
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

  const insertBoqItems = async (data: ParsedBoqItem[], tenderId: string): Promise<boolean> => {
    try {
      setUploading(true);
      setUploadProgress(0);

      // Собираем position-only обновления (позиции без BOQ-элементов, но с данными ГП)
      const positionOnlyUpdates: Array<{ positionId: string; data: PositionUpdateData }> = [];
      positionUpdates.forEach((posData) => {
        if (posData.itemsCount > 0) return;
        if (posData.manualVolume === undefined && posData.manualNote === undefined) return;
        if (!posData.positionId) return;
        positionOnlyUpdates.push({ positionId: posData.positionId, data: posData });
      });

      // Группируем BOQ-элементы по позициям
      const byPosition = new Map<string, ParsedBoqItem[]>();
      data.forEach(item => {
        if (!item.matchedPositionId) return;
        if (!byPosition.has(item.matchedPositionId)) {
          byPosition.set(item.matchedPositionId, []);
        }
        byPosition.get(item.matchedPositionId)!.push(item);
      });

      const totalOperations = byPosition.size + positionOnlyUpdates.length;
      let processedOperations = 0;

      // Загружаем курсы валют только если есть BOQ-элементы
      let rates = currencyRates;
      if (data.length > 0) {
        rates = await loadCurrencyRates(tenderId);
      }

      // Обрабатываем позиции с BOQ-элементами
      for (const [positionId, items] of byPosition) {
        const { data: existingItems } = await supabase
          .from('boq_items')
          .select('sort_number')
          .eq('client_position_id', positionId)
          .order('sort_number', { ascending: false })
          .limit(1);

        const maxSortNumber = existingItems?.[0]?.sort_number ?? -1;
        const workIdMap = new Map<string, string>();

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const actualSortNumber = maxSortNumber + 1 + i;

          const parentId = item.parent_work_item_id
            ? workIdMap.get(item.parent_work_item_id) || null
            : null;

          const totalAmount = calculateTotalAmount(item, rates);

          const insertData: any = {
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

          if (isWork(item.boq_item_type)) {
            insertData.work_name_id = item.work_name_id;
          }

          if (isMaterial(item.boq_item_type)) {
            insertData.material_type = item.material_type;
            insertData.material_name_id = item.material_name_id;
            insertData.parent_work_item_id = parentId;
          }

          const { data: inserted, error } = await supabase
            .from('boq_items')
            .insert(insertData)
            .select('id')
            .single();

          if (error) {
            throw new Error(`Позиция ${positionId}, строка ${item.rowIndex}: ${error.message}`);
          }

          if (isWork(item.boq_item_type) && item.tempId && inserted) {
            workIdMap.set(item.tempId, inserted.id);
          }
        }

        // Обновляем данные позиции (manual_volume, manual_note)
        const posData = Array.from(positionUpdates.values()).find(
          p => clientPositionsMap.get(p.positionNumber)?.id === positionId
        );

        if (posData && (posData.manualVolume !== undefined || posData.manualNote !== undefined)) {
          const updateData: any = {};
          if (posData.manualVolume !== undefined) {
            updateData.manual_volume = posData.manualVolume;
          }
          if (posData.manualNote !== undefined) {
            updateData.manual_note = posData.manualNote;
          }

          await supabase
            .from('client_positions')
            .update(updateData)
            .eq('id', positionId);
        }

        processedOperations++;
        setUploadProgress(Math.round((processedOperations / totalOperations) * 100));
      }

      // Обрабатываем position-only обновления (позиции без BOQ, только данные ГП)
      for (const { positionId, data: posData } of positionOnlyUpdates) {
        const updateData: any = {};
        if (posData.manualVolume !== undefined) {
          updateData.manual_volume = posData.manualVolume;
        }
        if (posData.manualNote !== undefined) {
          updateData.manual_note = posData.manualNote;
        }

        const { error } = await supabase
          .from('client_positions')
          .update(updateData)
          .eq('id', positionId);

        if (error) {
          throw new Error(`Позиция ${posData.positionNumber} (данные ГП): ${error.message}`);
        }

        processedOperations++;
        setUploadProgress(Math.round((processedOperations / totalOperations) * 100));
      }

      console.log('[MassBoqImport] Импорт завершён:', {
        boqPositions: byPosition.size,
        boqItems: data.length,
        positionOnlyUpdates: positionOnlyUpdates.length,
      });

      const msgParts: string[] = [];
      if (data.length > 0) {
        msgParts.push(`${data.length} элементов в ${byPosition.size} позиций`);
      }
      if (positionOnlyUpdates.length > 0) {
        msgParts.push(`обновлено ${positionOnlyUpdates.length} позиций (данные ГП)`);
      }
      message.success(`Импортировано: ${msgParts.join(', ')}`);
      return true;
    } catch (error: any) {
      console.error('Ошибка импорта:', error);
      message.error('Ошибка при импорте: ' + error.message);
      return false;
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
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

      if (works.length > 0) {
        const { error } = await supabase
          .from('work_names')
          .insert(works.map(w => ({ name: w.name, unit: w.unit })));
        if (error) throw new Error(`Ошибка добавления работ: ${error.message}`);
      }

      if (materials.length > 0) {
        const { error } = await supabase
          .from('material_names')
          .insert(materials.map(m => ({ name: m.name, unit: m.unit })));
        if (error) throw new Error(`Ошибка добавления материалов: ${error.message}`);
      }

      await loadNomenclature(tenderId);

      const total = works.length + materials.length;
      message.success(`Добавлено в номенклатуру: ${total} записей`);
      return true;
    } catch (error: any) {
      message.error(error.message);
      return false;
    } finally {
      setUploading(false);
    }
  };

  // ===========================
  // ПУБЛИЧНЫЙ API
  // ===========================

  const reset = () => {
    setParsedData([]);
    setPositionUpdates(new Map());
    setValidationResult(null);
    setUploadProgress(0);
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

    // Методы
    loadNomenclature,
    parseExcelFile,
    validateParsedData,
    processWorkBindings,
    insertBoqItems,
    addMissingToNomenclature,
    reset,
    getPositionStats,
  };
};
