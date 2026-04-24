import { useState } from 'react';
import * as XLSX from 'xlsx';
import { message } from 'antd';
import { supabase } from '../../../../lib/supabase';

export interface ParsedNomenclatureRow {
  name: string;
  normalizedName: string;
  unit_code: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  unknownUnits: string[];
  duplicates: DuplicateGroup[];
}

export interface DuplicateGroup {
  normalizedName: string;
  occurrences: Array<{
    rowIndex: number;
    originalName: string;
    unit_code: string;
  }>;
}

export interface ExistingUnit {
  code: string;
  name: string;
  description?: string;
}

export interface UnitMapping {
  originalCode: string;
  mappedCode: string | null;
  action: 'map' | 'create';
}

export const useNomenclatureUpload = () => {
  const [parsedData, setParsedData] = useState<ParsedNomenclatureRow[]>([]);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [existingUnits, setExistingUnits] = useState<ExistingUnit[]>([]);
  const [unitMappings, setUnitMappings] = useState<UnitMapping[]>([]);
  const [uploading, setUploading] = useState(false);
  const [existingRecords, setExistingRecords] = useState<Map<string, { name: string; unit: string }>>(new Map());

  // Очистка имени для сохранения в БД (убираем все лишние пробелы)
  const cleanName = (name: string): string => {
    return name
      .replace(/\s+/g, ' ')  // Схлопнуть все whitespace символы (пробелы, табы, и т.д.) в один пробел
      .trim()                // Убрать пробелы с краев
      .replace(/[.,;:!?]+$/, ''); // Убрать trailing пунктуацию
  };

  // Унификация наименования для сравнения дубликатов
  const normalizeName = (name: string): string => {
    return cleanName(name).toLowerCase();
  };

  // Загрузка существующих единиц измерения из БД
  const fetchExistingUnits = async () => {
    try {
      const { data, error } = await supabase
        .from('units')
        .select('code, name, description')
        .eq('is_active', true)
        .order('sort_order');

      if (error) {
        console.error('Ошибка загрузки единиц измерения:', error);
        message.error('Не удалось загрузить единицы измерения');
      } else if (data) {
        setExistingUnits(data);
      }
    } catch (error) {
      console.error('Ошибка при загрузке единиц:', error);
    }
  };

  // Загрузка существующих материалов/работ из БД
  const fetchExistingRecords = async (mode: 'materials' | 'works') => {
    try {
      const tableName = mode === 'materials' ? 'material_names' : 'work_names';

      // Загружаем все записи батчами
      let allRecords: Array<{ name: string; unit: string }> = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from(tableName)
          .select('name, unit')
          .range(from, from + batchSize - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          allRecords = [...allRecords, ...data];
          from += batchSize;
          hasMore = data.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      // Создаем Map с ключом: normalized_name + unit
      const recordsMap = new Map<string, { name: string; unit: string }>();
      allRecords.forEach(record => {
        const key = `${normalizeName(record.name)}|${record.unit}`;
        recordsMap.set(key, record);
      });

      setExistingRecords(recordsMap);
    } catch (error) {
      console.error('Ошибка загрузки существующих записей:', error);
      message.error('Не удалось загрузить существующие записи');
    }
  };

  // Проверка существования единицы измерения
  const isUnitExists = (unit: string): boolean => {
    return existingUnits.some(u => u.code === unit);
  };

  // Валидация распарсенных данных
  const validateData = (data: ParsedNomenclatureRow[]): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const unknownUnitsSet = new Set<string>();
    const duplicatesMap = new Map<string, DuplicateGroup>();

    if (data.length === 0) {
      errors.push('Файл не содержит данных');
      return { isValid: false, errors, warnings, unknownUnits: [], duplicates: [] };
    }

    data.forEach((row, index) => {
      const rowNum = index + 2;

      // 1. Проверка на пустое имя
      if (!row.name || row.name.trim() === '') {
        errors.push(`Строка ${rowNum}: отсутствует наименование`);
      }

      // 2. Проверка единицы измерения
      if (row.unit_code) {
        if (!isUnitExists(row.unit_code)) {
          unknownUnitsSet.add(row.unit_code);
          warnings.push(`Строка ${rowNum}: неизвестная единица измерения "${row.unit_code}"`);
        }
      }

      // 3. Сбор дубликатов по normalizedName
      if (!duplicatesMap.has(row.normalizedName)) {
        duplicatesMap.set(row.normalizedName, {
          normalizedName: row.normalizedName,
          occurrences: []
        });
      }
      duplicatesMap.get(row.normalizedName)!.occurrences.push({
        rowIndex: index,
        originalName: row.name,
        unit_code: row.unit_code
      });
    });

    // Фильтруем только реальные дубликаты (где occurrences > 1)
    const duplicates = Array.from(duplicatesMap.values())
      .filter(group => group.occurrences.length > 1);

    const unknownUnits = Array.from(unknownUnitsSet);

    if (unknownUnits.length > 0) {
      setUnitMappings(unknownUnits.map(code => ({
        originalCode: code,
        mappedCode: null,
        action: 'map' as const
      })));
    }

    if (duplicates.length > 0) {
      warnings.push(`Найдено ${duplicates.length} групп дубликатов. Будет загружена только первая запись из каждой группы.`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      unknownUnits,
      duplicates
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

        const parsed: ParsedNomenclatureRow[] = rows
          .filter((row: unknown) => Array.isArray(row) && row.length > 0 && row.some(cell => cell !== undefined && cell !== ''))
          .map((row: unknown) => {
            const cells = row as unknown[];
            const rawName = cells[0] ? String(cells[0]) : '';
            const name = cleanName(rawName);
            return {
              name,
              normalizedName: normalizeName(name),
              unit_code: cells[1] ? String(cells[1]).trim() : '',
            };
          });

        setParsedData(parsed);

        const validation = validateData(parsed);
        setValidationResult(validation);

        if (validation.isValid && validation.unknownUnits.length === 0 && validation.duplicates.length === 0) {
          message.success(`Файл успешно обработан: ${parsed.length} позиций`);
        } else if (validation.unknownUnits.length > 0 || validation.duplicates.length > 0) {
          message.warning(`Файл обработан, но требует настройки маппинга или найдены дубликаты.`);
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
          unknownUnits: [],
          duplicates: []
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

    if (mapping?.action === 'create') {
      return mapping.originalCode;
    }

    return mapping?.mappedCode || undefined;
  };

  // Получение уникальных записей (первое вхождение), исключая дубли с БД
  const getUniqueRecords = (data: ParsedNomenclatureRow[]): ParsedNomenclatureRow[] => {
    const seen = new Set<string>();
    return data.filter(row => {
      // Проверка дублей внутри файла (по normalizedName)
      if (seen.has(row.normalizedName)) {
        return false;
      }
      seen.add(row.normalizedName);

      // Проверка дублей с существующими записями в БД (по normalizedName + unit)
      const dbKey = `${row.normalizedName}|${row.unit_code}`;
      if (existingRecords.has(dbKey)) {
        console.log(`[Duplicate] Пропуск записи "${row.name}" [${row.unit_code}] - уже существует в БД`);
        return false;
      }

      return true;
    });
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
  const uploadData = async (mode: 'materials' | 'works') => {
    if (!isReadyForUpload()) {
      message.error('Необходимо настроить маппинг для всех неизвестных единиц');
      return false;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // 0. Обновить список существующих записей перед загрузкой
      await fetchExistingRecords(mode);

      // 1. Создать новые единицы измерения (если action='create')
      const unitsToCreate = unitMappings.filter(m => m.action === 'create');

      for (const unitMapping of unitsToCreate) {
        const { error } = await supabase
          .from('units')
          .insert({
            code: unitMapping.originalCode,
            name: unitMapping.originalCode,
            category: 'custom',
            sort_order: 999,
            is_active: true
          });

        if (error && error.code !== '23505') {
          throw new Error(`Ошибка создания единицы измерения: ${error.message}`);
        }
      }

      // 2. Получить уникальные записи
      const uniqueRecords = getUniqueRecords(parsedData);

      // 3. Применить маппинг единиц
      const recordsWithMappedUnits = uniqueRecords.map(row => ({
        name: row.name,
        unit_code: getFinalUnitCode(row.unit_code)
      }));

      // 4. Вставка в БД
      const tableName = mode === 'materials' ? 'material_names' : 'work_names';

      const batchSize = 100;
      const totalBatches = Math.ceil(recordsWithMappedUnits.length / batchSize);

      for (let i = 0; i < totalBatches; i++) {
        const batch = recordsWithMappedUnits.slice(i * batchSize, (i + 1) * batchSize);

        const { error } = await supabase
          .from(tableName)
          .insert(batch.map(r => ({
            name: r.name,
            ...(r.unit_code ? { unit: r.unit_code } : {})
          })));

        if (error) {
          console.error('Ошибка вставки данных:', error);
          throw new Error(`Ошибка при сохранении данных: ${error.message}`);
        }

        setUploadProgress(Math.round(((i + 1) / totalBatches) * 100));
      }

      message.success(`Успешно загружено ${recordsWithMappedUnits.length} уникальных записей`);
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
    fetchExistingRecords,
    parseExcelFile,
    handleMappingChange,
    isReadyForUpload,
    uploadData,
    reset,
    isUnitExists,
  };
};
