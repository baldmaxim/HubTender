import { useState } from 'react';
import * as XLSX from 'xlsx';
import { message } from 'antd';
import { listActiveUnitsFull } from '../../../../lib/api/costs';
import {
  fetchPositionsWithCosts,
  bulkInsertPositions,
  type BulkPositionInsert,
} from '../../../../lib/api/positions';

export interface ParsedRow {
  item_no: string;
  hierarchy_level: number;
  work_name: string;
  unit_code: string;
  volume: number;
  client_note: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  unknownUnits: string[];
}

export interface ExistingUnit {
  code: string;
  name: string;
  description?: string;
}

export interface UnitMapping {
  originalCode: string;
  mappedCode: string | null;
  action: 'map' | 'create' | 'skip';
}

export const useBoqUpload = () => {
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [existingUnits, setExistingUnits] = useState<ExistingUnit[]>([]);
  const [unitMappings, setUnitMappings] = useState<UnitMapping[]>([]);
  const [uploading, setUploading] = useState(false);

  // Загрузка существующих единиц измерения из БД
  const fetchExistingUnits = async () => {
    try {
      const data = await listActiveUnitsFull();
      setExistingUnits(
        data.map((u) => ({
          code: u.code,
          name: u.name,
          description: u.description ?? undefined,
        })),
      );
    } catch (error) {
      console.error('Ошибка при загрузке единиц:', error);
      message.error('Не удалось загрузить единицы измерения');
    }
  };

  // Проверка существования единицы измерения
  const isUnitExists = (unit: string): boolean => {
    return existingUnits.some(u => u.code === unit);
  };

  // Валидация распарсенных данных
  const validateData = (data: ParsedRow[]): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const unknownUnitsSet = new Set<string>();

    if (data.length === 0) {
      errors.push('Файл не содержит данных');
      return { isValid: false, errors, warnings, unknownUnits: [] };
    }

    data.forEach((row, index) => {
      const rowNum = index + 2;

      if (!row.work_name || row.work_name.trim() === '') {
        errors.push(`Строка ${rowNum}: отсутствует название работы`);
      }

      if (row.unit_code) {
        if (!isUnitExists(row.unit_code)) {
          unknownUnitsSet.add(row.unit_code);
          warnings.push(`Строка ${rowNum}: неизвестная единица измерения "${row.unit_code}"`);
        }
      }

      if (row.volume && (isNaN(row.volume) || row.volume < 0)) {
        errors.push(`Строка ${rowNum}: некорректный объем "${row.volume}"`);
      }

      if (row.hierarchy_level && (isNaN(row.hierarchy_level) || row.hierarchy_level < 0)) {
        errors.push(`Строка ${rowNum}: некорректный уровень иерархии "${row.hierarchy_level}"`);
      }
    });

    const unknownUnits = Array.from(unknownUnitsSet);

    if (unknownUnits.length > 0) {
      setUnitMappings(unknownUnits.map(code => ({
        originalCode: code,
        mappedCode: null,
        action: 'map'
      })));
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      unknownUnits
    };
  };

  // Парсинг Excel файла
  const parseExcelFile = (file: File) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });

        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1 });

        const rows = jsonData.slice(1);

        const parsed: ParsedRow[] = rows
          .filter((row: unknown) => Array.isArray(row) && row.length > 0 && row.some(cell => cell !== undefined && cell !== ''))
          .map((row: unknown) => {
            const cells = row as unknown[];
            return {
              item_no: cells[0] ? String(cells[0]).trim() : '',
              hierarchy_level: cells[1] ? Number(cells[1]) : 0,
              work_name: cells[2] ? String(cells[2]).trim() : '',
              unit_code: cells[3] ? String(cells[3]).trim() : '',
              volume: cells[4] ? Number(cells[4]) : 0,
              client_note: cells[5] ? String(cells[5]).trim() : '',
            };
          });

        setParsedData(parsed);

        const validation = validateData(parsed);
        setValidationResult(validation);

        if (validation.isValid && validation.unknownUnits.length === 0) {
          message.success(`Файл успешно обработан: ${parsed.length} позиций`);
        } else if (validation.unknownUnits.length > 0) {
          message.warning(`Файл обработан, но найдены неизвестные единицы измерения. Настройте маппинг.`);
        } else {
          message.error('Обнаружены ошибки в данных');
        }
      } catch (error) {
        console.error('Ошибка парсинга Excel:', error);
        message.error('Ошибка при чтении файла');
        setValidationResult({
          isValid: false,
          errors: ['Не удалось прочитать файл. Проверьте формат.'],
          warnings: [],
          unknownUnits: []
        });
      }
    };

    reader.readAsBinaryString(file);
    return false;
  };

  // Обновление маппинга единицы измерения
  const handleMappingChange = (originalCode: string, value: string, action: 'map' | 'create') => {
    setUnitMappings(prev => prev.map(m =>
      m.originalCode === originalCode
        ? { ...m, mappedCode: value, action }
        : m
    ));
  };

  // Получение финального кода единицы измерения с учетом маппинга
  const getFinalUnitCode = (originalCode: string) => {
    if (!originalCode) return undefined;

    if (isUnitExists(originalCode)) {
      return originalCode;
    }

    const mapping = unitMappings.find(m => m.originalCode === originalCode);
    return mapping?.mappedCode || undefined;
  };

  // Проверка готовности к загрузке
  const isReadyForUpload = (): boolean => {
    if (!validationResult?.isValid || parsedData.length === 0) {
      return false;
    }

    if (validationResult.unknownUnits.length > 0) {
      return unitMappings.every(m => m.mappedCode !== null);
    }

    return true;
  };

  // Сохранение данных в БД
  const uploadData = async (tenderId: string) => {
    if (!isReadyForUpload()) {
      message.error('Необходимо настроить маппинг для всех неизвестных единиц');
      return false;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // Максимальный position_number среди существующих строк тендера.
      const existing = await fetchPositionsWithCosts(tenderId);
      const maxNum = existing.reduce<number>(
        (m, p) => (typeof p.position_number === 'number' && p.position_number > m ? p.position_number : m),
        0,
      );
      const startNumber = existing.length > 0 ? Math.floor(maxNum) + 1 : 1;

      const positions: BulkPositionInsert[] = parsedData.map((row, index) => {
        const finalUnitCode = getFinalUnitCode(row.unit_code);
        return {
          tender_id: tenderId,
          position_number: startNumber + index,
          work_name: row.work_name,
          unit_code: finalUnitCode || null,
          volume: row.volume || null,
          client_note: row.client_note || null,
          item_no: row.item_no || null,
          hierarchy_level: row.hierarchy_level || 0,
          is_additional: false,
        };
      });

      // Go: один атомарный bulk-insert (батчинг убран; схема-defaults на стороне БД).
      setUploadProgress(50);
      const inserted = await bulkInsertPositions(tenderId, positions);
      setUploadProgress(100);

      message.success(`Успешно загружено ${inserted} позиций`);
      return true;
    } catch (error) {
      console.error('Ошибка загрузки:', error);
      const errorMessage = error instanceof Error ? error.message : 'Ошибка при загрузке данных';
      message.error(errorMessage);
      return false;
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // Очистка состояния
  const reset = () => {
    setParsedData([]);
    setValidationResult(null);
    setUploadProgress(0);
    setUnitMappings([]);
  };

  return {
    parsedData,
    validationResult,
    uploadProgress,
    existingUnits,
    unitMappings,
    uploading,
    fetchExistingUnits,
    parseExcelFile,
    handleMappingChange,
    isReadyForUpload,
    uploadData,
    reset,
    isUnitExists,
  };
};
