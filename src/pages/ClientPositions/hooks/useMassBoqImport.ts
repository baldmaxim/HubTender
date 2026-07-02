import { useState } from 'react';
import * as XLSX from 'xlsx';
import { message } from 'antd';
import { apiFetch } from '../../../lib/api/client';
import { createWorkName, createMaterialName } from '../../../lib/api/nomenclatures';
import {
  ParsedBoqItem,
  PositionUpdateData,
  ValidationResult,
  parseExcelData,
  validateBoqData,
  processWorkBindings,
} from '../utils';
import {
  buildPositionUpdatesPayload,
  buildBoqItemsPayload,
  analyzeImportMismatch,
} from '../utils/massBoqImportPayload';
import { buildMissingNomenclatureInserts } from '../../../utils/boq/nomenclatureImport';
import { useMassBoqImportRefs } from './useMassBoqImportRefs';
import { getErrorMessage } from '../../../utils/errors';

// Справочники вынесены в useMassBoqImportRefs, payload-билдеры — в
// utils/massBoqImportPayload (лимит ≤600 строк на файл).

// ===========================
// ОСНОВНОЙ ХУК
// ===========================

export const useMassBoqImport = () => {
  const [parsedData, setParsedData] = useState<ParsedBoqItem[]>([]);
  const [positionUpdates, setPositionUpdates] = useState<Map<string, PositionUpdateData>>(new Map());
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  // Явный статус результата импорта — чтобы не выводить «успех» из uploadProgress.
  const [importStatus, setImportStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [importError, setImportError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [unitMappings, setUnitMappings] = useState<Record<string, string>>({});

  const {
    workNamesMap,
    materialNamesMap,
    costCategoriesMap,
    clientPositionsMap,
    leafPositionIds,
    availableUnits,
    existingItemsByPosition,
    currencyRates,
    loadNomenclature: loadNomenclatureRefs,
    loadCurrencyRates,
    loadExistingItems,
    resetRefs,
  } = useMassBoqImportRefs();

  // ===========================
  // ЗАГРУЗКА СПРАВОЧНИКОВ
  // ===========================

  const loadNomenclature = async (tenderId: string) => {
    const ok = await loadNomenclatureRefs(tenderId);
    if (ok) {
      setUnitMappings({});
    }
    return ok;
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
      leafPositionIds,
    });
    setValidationResult(result);
    return result;
  };

  // ===========================
  // ВСТАВКА В БД
  // ===========================

  const insertBoqItems = async (
    data: ParsedBoqItem[],
    tenderId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    userId?: string,
  ): Promise<boolean> => {
    try {
      setUploading(true);
      setUploadProgress(5);
      setImportStatus('running');
      setImportError(null);

      const positionUpdatesPayload = buildPositionUpdatesPayload(positionUpdates);

      let rates = currencyRates;
      if (data.length > 0) {
        rates = await loadCurrencyRates(tenderId);
      }

      const itemsPayload = buildBoqItemsPayload(data, rates);

      setUploadProgress(15);

      let insertedItemsCount = 0;
      let updatedPositionsCount = 0;
      let importSessionId: string | null = null;

      {
        // Go BFF: один pgx.Tx, audit в той же транзакции, user_id из JWT
        // (не из body). Bulk-импорт может быть объёмным → timeoutMs:0
        // (отключаем дефолтный 10s-таймаут apiFetch).
        const goResp = await apiFetch<{
          import_session_id: string | null;
          inserted_items_count: number;
          updated_positions_count: number;
        }>('/api/v1/imports/boq', {
          method: 'POST',
          timeoutMs: 0,
          body: JSON.stringify({
            tender_id: tenderId,
            file_name: fileName || '',
            items: itemsPayload,
            position_updates: positionUpdatesPayload,
          }),
        });
        insertedItemsCount = goResp.inserted_items_count;
        updatedPositionsCount = goResp.updated_positions_count;
        importSessionId = goResp.import_session_id;
      }

      setUploadProgress(100);

      const analysis = analyzeImportMismatch(
        insertedItemsCount,
        updatedPositionsCount,
        itemsPayload.length,
        positionUpdatesPayload.length,
        data,
      );

      console.log('[MassBoqImport] Импорт завершён:', {
        boqItems: insertedItemsCount,
        expectedItems: analysis.expectedItems,
        positionUpdates: updatedPositionsCount,
        expectedPositions: analysis.expectedPositions,
        droppedItems: analysis.droppedItems,
        sessionId: importSessionId,
      });

      if (analysis.mismatch) {
        console.error('[MassBoqImport] Расхождение количеств при импорте:', {
          insertedItemsCount, expectedItems: analysis.expectedItems,
          updatedPositionsCount, expectedPositions: analysis.expectedPositions,
          droppedItems: analysis.droppedItems, droppedRows: analysis.droppedRows,
        });
        message.error(analysis.mismatchMsg, 10);
        // Частичная загрузка трактуется как ошибка: модалка не закрывается,
        // показываем расхождение, пользователь проверяет позиции.
        setImportError(analysis.mismatchMsg);
        setImportStatus('error');
        return false;
      }

      const msgParts: string[] = [];
      if (insertedItemsCount > 0) {
        msgParts.push(`${insertedItemsCount} элементов`);
      }
      if (updatedPositionsCount > 0) {
        msgParts.push(`обновлено ${updatedPositionsCount} позиций`);
      }
      message.success(`Импортировано: ${msgParts.join(', ')}`);
      setImportStatus('success');
      return true;
    } catch (error) {
      // Расшифровываем структурно: apiFetch кладёт причину (RFC 7807 detail)
      // в error.message, а статус и тело — в error.status / error.body.
      const e = error as { status?: number; body?: { detail?: string; title?: string } };
      const detail = getErrorMessage(error);
      console.error('Ошибка импорта:', {
        status: e?.status,
        message: detail,
        body: e?.body,
      });
      message.error('Ошибка импорта: ' + detail, 8);
      setImportError(detail);
      setImportStatus('error');
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
    setImportStatus('idle');
    setImportError(null);
    resetRefs();
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
    importStatus,
    importError,
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
