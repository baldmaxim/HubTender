import {
  ParsedBoqItem,
  PositionUpdateData,
  normalizePositionNumber,
  normalizeMaterialType,
  normalizeDeliveryPriceType,
  normalizeString,
  parseNumber,
  parseBoolean,
} from './massBoqImportUtils';

export interface ParseExcelResult {
  parsed: ParsedBoqItem[];
  posUpdates: Map<string, PositionUpdateData>;
}

export const parseExcelData = (rows: unknown[]): ParseExcelResult => {
  const parsed: ParsedBoqItem[] = [];
  const posUpdates = new Map<string, PositionUpdateData>();

  // Допустимые типы BOQ элементов
  const validBoqTypes = ['раб', 'суб-раб', 'раб-комп.', 'мат', 'суб-мат', 'мат-комп.'];

  // Текущий номер позиции (наследуется от родительской строки)
  let currentPositionNumber = '';

  const hasStandaloneMaterialPayload = (cells: unknown[]): boolean => {
    return Boolean(
      cells[2] || // затрата
      cells[6] || // наименование
      cells[7] || // ед. изм.
      cells[11] || // количество
      cells[15] // цена за единицу
    );
  };

  rows.forEach((row: unknown, index: number) => {
    if (!Array.isArray(row)) return;

    const hasData = row.some(cell => cell !== undefined && cell !== null && cell !== '');
    if (!hasData) return;

    const cells = row as any[];
    const rowNum = index + 2;

    // Номер позиции из колонки 1 (вторая колонка в Excel)
    const rowPositionNumber = normalizePositionNumber(cells[1]);

    // Тип элемента BOQ из колонки 4.
    // Независимый материал выводим только для дочерней BOQ-строки без номера позиции.
    // Иначе строка-заголовок позиции с названием и количеством ошибочно попадёт в BOQ.
    const rawBoqType = cells[4] ? String(cells[4]).trim() : '';
    const inferredAsStandaloneMaterial =
      !rowPositionNumber &&
      !rawBoqType &&
      !parseBoolean(cells[3]) &&
      hasStandaloneMaterialPayload(cells);
    const boqType = inferredAsStandaloneMaterial ? 'мат' : rawBoqType;
    const isValidBoqType = validBoqTypes.includes(boqType);

    // Если есть номер позиции - это строка заголовка позиции
    // Запоминаем номер позиции для последующих строк BOQ
    if (rowPositionNumber) {
      currentPositionNumber = rowPositionNumber;

      // Создаем/обновляем данные позиции
      const existing = posUpdates.get(currentPositionNumber) || {
        positionNumber: currentPositionNumber,
        itemsCount: 0,
      };

      // Количество ГП из колонки 12 (индекс 11, соответствует экспорту col 10 + сдвиг bindToWork)
      const manualVolume = parseNumber(cells[11]);
      if (manualVolume !== undefined) {
        existing.manualVolume = manualVolume;
      }

      // Примечание ГП из колонки 20 (индекс 19, соответствует экспорту col 18 + сдвиг bindToWork)
      const manualNote = cells[19] ? String(cells[19]).trim() : undefined;
      if (manualNote) {
        existing.manualNote = manualNote;
      }

      if (manualVolume !== undefined || manualNote) {
        console.log(`[MassBoqImport] Позиция ${currentPositionNumber}: manualVolume=${manualVolume}, manualNote="${manualNote}"`);
      }

      posUpdates.set(currentPositionNumber, existing);

      // Если это строка-заголовок без типа BOQ - пропускаем её как элемент BOQ
      if (!isValidBoqType) {
        return;
      }
    }

    // Пропускаем строки без валидного типа BOQ
    if (!isValidBoqType) {
      return;
    }

    // Используем унаследованный номер позиции
    const effectivePositionNumber = rowPositionNumber || currentPositionNumber;

    if (!effectivePositionNumber) {
      console.warn(`[MassBoqImport] Строка ${rowNum}: пропущена - нет номера позиции`);
      return;
    }

    // Парсинг элемента BOQ
    const item: ParsedBoqItem = {
      rowIndex: rowNum,
      positionNumber: effectivePositionNumber,

      boq_item_type: boqType as any,
      material_type: normalizeMaterialType(cells[5]),
      nameText: cells[6] ? normalizeString(String(cells[6])) : '',
      unit_code: cells[7] ? String(cells[7]).trim() : '',

      bindToWork: parseBoolean(cells[3]),

      conversion_coefficient: parseNumber(cells[9]),
      consumption_coefficient: parseNumber(cells[10]),
      base_quantity: parseNumber(cells[11]),
      quantity: parseNumber(cells[11]),

      currency_type: cells[12] ? String(cells[12]).trim() as any : 'RUB',
      delivery_price_type: normalizeDeliveryPriceType(cells[13]),
      delivery_amount: parseNumber(cells[14]),
      unit_rate: parseNumber(cells[15]),

      costCategoryText: cells[2] ? String(cells[2]).trim() : '',

      quote_link: cells[17] ? String(cells[17]).trim() : undefined,
      description: cells[19] ? String(cells[19]).trim() : undefined,

      sort_number: index,
    };

    parsed.push(item);

    // Обновляем счетчик элементов для позиции
    const existing = posUpdates.get(effectivePositionNumber) || {
      positionNumber: effectivePositionNumber,
      itemsCount: 0,
    };
    existing.itemsCount++;
    posUpdates.set(effectivePositionNumber, existing);
  });

  // Логирование для отладки
  console.log('=== ПАРСИНГ EXCEL (МАССОВЫЙ) ЗАВЕРШЁН ===');
  console.log(`Всего элементов BOQ: ${parsed.length}`);
  console.log(`Уникальных позиций: ${posUpdates.size}`);

  const positionOnlyCount = Array.from(posUpdates.values()).filter(
    p => p.itemsCount === 0 && (p.manualVolume !== undefined || p.manualNote !== undefined)
  ).length;
  if (positionOnlyCount > 0) {
    console.log(`Позиций только с данными ГП (без BOQ): ${positionOnlyCount}`);
  }

  // Логирование первых 5 строк — полный дамп ячеек для диагностики
  console.log('[MassBoqImport] Первые 5 строк (все ячейки):');
  rows.slice(0, 5).forEach((row: any, idx: number) => {
    const cells = row as any[];
    const dump = cells.map((c: any, i: number) => `[${i}]=${c}`).join(', ');
    console.log(`  Строка ${idx + 2}: ${dump}`);
  });

  // Группировка по позициям для отладки
  const byPosition = new Map<string, number>();
  parsed.forEach(item => {
    const count = byPosition.get(item.positionNumber) || 0;
    byPosition.set(item.positionNumber, count + 1);
  });
  console.log('Элементов по позициям:', Object.fromEntries(byPosition));

  return { parsed, posUpdates };
};
