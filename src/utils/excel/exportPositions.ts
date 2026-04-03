import * as XLSX from 'xlsx-js-style';
import { supabase } from '../../lib/supabase';
import type { ClientPosition, BoqItemFull, ExportRow } from './types';
import {
  isWorkType,
  isMaterialType,
  createPositionRow,
  createBoqItemRow,
} from './formatters';
import {
  getCellStyle,
  headerStyle,
  cellBorderStyle,
  columnWidths,
  numericColIndices,
  fourDecimalColIndices,
  nameColIndex,
} from './styles';

/**
 * Загружает все позиции заказчика для тендера с батчингом
 */
async function loadClientPositions(tenderId: string): Promise<ClientPosition[]> {
  let allPositions: ClientPosition[] = [];
  let from = 0;
  const batchSize = 1000;
  let hasMore = true;

  // Батчинг для обхода лимита Supabase 1000 rows
  while (hasMore) {
    const { data, error } = await supabase
      .from('client_positions')
      .select('*')
      .eq('tender_id', tenderId)
      .order('position_number', { ascending: true })
      .range(from, from + batchSize - 1);

    if (error) {
      throw new Error(`Ошибка загрузки позиций: ${error.message}`);
    }

    if (data && data.length > 0) {
      allPositions = [...allPositions, ...data];
      from += batchSize;
      hasMore = data.length === batchSize;
    } else {
      hasMore = false;
    }
  }

  return allPositions;
}

/**
 * Загружает ВСЕ BOQ items для всего тендера с батчингом
 */
async function loadAllBoqItemsForTender(tenderId: string): Promise<Map<string, BoqItemFull[]>> {
  let allItems: any[] = [];
  let from = 0;
  const batchSize = 1000;
  let hasMore = true;

  // Основной запрос с JOIN и двойной сортировкой для стабильности батчинга
  while (hasMore) {
    const { data, error } = await supabase
      .from('boq_items')
      .select(`
        *,
        material_names(name, unit),
        work_names(name, unit),
        parent_work:parent_work_item_id(work_names(name)),
        detail_cost_categories(name, cost_categories(name), location)
      `)
      .eq('tender_id', tenderId)
      .order('sort_number', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + batchSize - 1);

    if (error) {
      throw new Error(`Ошибка загрузки BOQ items: ${error.message}`);
    }

    if (data && data.length > 0) {
      allItems = [...allItems, ...data];
      from += batchSize;
      hasMore = data.length === batchSize;
    } else {
      hasMore = false;
    }
  }

  // Дедуплицировать по ID (LEFT JOIN может возвращать дубликаты)
  const uniqueItems = new Map<string, any>();

  allItems.forEach((item: any) => {
    if (!uniqueItems.has(item.id)) {
      uniqueItems.set(item.id, item);
    }
  });

  // Группировать по client_position_id
  const itemsByPosition = new Map<string, BoqItemFull[]>();

  uniqueItems.forEach((item: any) => {
    const positionId = item.client_position_id;
    if (!itemsByPosition.has(positionId)) {
      itemsByPosition.set(positionId, []);
    }
    itemsByPosition.get(positionId)!.push(item as BoqItemFull);
  });

  return itemsByPosition;
}

/**
 * Сортирует элементы по иерархии (как на UI)
 * НОВАЯ ЛОГИКА: всегда сортируем по sort_number, группируя материалы сразу после их родительских работ
 */
function sortItemsByHierarchy(items: BoqItemFull[], positionName?: string): BoqItemFull[] {
  // ЛОГИРОВАНИЕ: Порядок элементов ДО сортировки
  console.log(`\n=== ЭКСПОРТ: Сортировка для позиции "${positionName}" ===`);
  console.log(`Всего элементов: ${items.length}`);
  console.log('Первые 10 элементов ДО сортировки (по sort_number из БД):');
  items.slice(0, 10).forEach((item, idx) => {
    const name = (item as any).work_names?.name || (item as any).material_names?.name || 'N/A';
    console.log(`  ${idx}: [sort=${item.sort_number}] ${name} (${item.boq_item_type})`);
  });

  const result: BoqItemFull[] = [];
  const processedIds = new Set<string>();

  // Сортируем все элементы по sort_number
  const sortedItems = [...items].sort((a, b) => {
    const aSortNum = a.sort_number ?? 0;
    const bSortNum = b.sort_number ?? 0;
    return aSortNum - bSortNum;
  });

  // Проходим по отсортированным элементам
  sortedItems.forEach(item => {
    if (processedIds.has(item.id)) return;

    result.push(item);
    processedIds.add(item.id);

    // Если это работа с привязанными материалами, добавляем материалы сразу после работы
    if (isWorkType(item.boq_item_type)) {
      const linkedMaterials = items
        .filter(m => m.parent_work_item_id === item.id && !processedIds.has(m.id))
        .sort((a, b) => (a.sort_number ?? 0) - (b.sort_number ?? 0));

      linkedMaterials.forEach(mat => {
        result.push(mat);
        processedIds.add(mat.id);
      });
    }
  });

  // ЛОГИРОВАНИЕ: Порядок элементов ПОСЛЕ сортировки
  console.log('Первые 10 элементов ПОСЛЕ сортировки (финальный порядок для Excel):');
  result.slice(0, 10).forEach((item, idx) => {
    const name = (item as any).work_names?.name || (item as any).material_names?.name || 'N/A';
    console.log(`  ${idx}: [sort=${item.sort_number}] ${name} (${item.boq_item_type})`);
  });
  console.log('=== КОНЕЦ СОРТИРОВКИ ===\n');

  return result;
}

/**
 * Вычисляет листовые позиции (ТА ЖЕ логика что в useClientPositions)
 * Возвращает Set с ID позиций (не индексами!)
 */
function computeLeafPositions(positions: ClientPosition[]): Set<string> {
  const leafIds = new Set<string>();

  positions.forEach((position, index) => {
    // Последняя позиция всегда листовая
    if (index === positions.length - 1) {
      leafIds.add(position.id);
      return;
    }

    const currentLevel = position.hierarchy_level || 0;
    let nextIndex = index + 1;

    // Пропускаем ДОП работы при определении листового узла
    while (nextIndex < positions.length && positions[nextIndex].is_additional) {
      nextIndex++;
    }

    if (nextIndex >= positions.length) {
      leafIds.add(position.id);
      return;
    }

    const nextLevel = positions[nextIndex].hierarchy_level || 0;
    // Если текущий уровень >= следующего → листовая
    if (currentLevel >= nextLevel) {
      leafIds.add(position.id);
    }
  });

  return leafIds;
}

/**
 * Собирает все строки для экспорта в правильном порядке
 */
function collectExportRows(
  positions: ClientPosition[],
  boqItemsByPosition: Map<string, BoqItemFull[]>
): ExportRow[] {
  const rows: ExportRow[] = [];

  // Вычислить листовые позиции ТОЙ ЖЕ логикой что на странице /positions (для ВСЕХ позиций)
  const leafIds = computeLeafPositions(positions);

  // Разделить на обычные и ДОП работы
  const normalPositions = positions.filter(p => !p.is_additional);
  const additionalPositions = positions.filter(p => p.is_additional);

  // Обработать обычные позиции
  normalPositions.forEach((position, index) => {
    // Проверить является ли позиция листовой (по ID, не по индексу!)
    const isLeaf = leafIds.has(position.id);

    // Получить BOQ items для позиции
    const boqItems = boqItemsByPosition.get(position.id) || [];
    const hasBOQItems = boqItems.length > 0;

    // Рассчитать итоговую сумму для строки позиции:
    // - Если есть BOQ items → сумма из них
    // - Если нет BOQ items И это ЛИСТОВАЯ позиция → null (красная подсветка в Excel)
    // - Если нет BOQ items И это РАЗДЕЛ → агрегированные поля position
    const finalTotal = hasBOQItems
      ? boqItems.reduce((sum, item) => sum + (item.total_amount || 0), 0)
      : isLeaf
        ? null  // Листовая позиция без BOQ items → null для красной подсветки
        : (position.total_material || 0) + (position.total_works || 0);  // Раздел → агрегированная сумма

    // Добавить строку позиции
    rows.push(createPositionRow(position, isLeaf, finalTotal));

    // Если у позиции есть BOQ items, добавить их
    if (hasBOQItems) {
      // Сортировать по иерархии (как на UI)
      const sortedItems = sortItemsByHierarchy(boqItems, position.work_name);

      // Выводить в порядке иерархии
      sortedItems.forEach(item => {
        rows.push(createBoqItemRow(item, position));
      });
    }

    // ДОП работы для этой позиции (обрабатываем для ВСЕХ позиций, не только листовых)
    const childAdditional = additionalPositions.filter(
      ap => ap.parent_position_id === position.id
    );

    for (const dopWork of childAdditional) {
      // Рассчитать реальную сумму из BOQ items для ДОП работы
      const dopBoqItems = boqItemsByPosition.get(dopWork.id) || [];
      const dopActualTotal = dopBoqItems.length > 0
        ? dopBoqItems.reduce((sum, item) => sum + (item.total_amount || 0), 0)
        : null;

      // Добавить строку ДОП работы с реальной суммой
      rows.push(createPositionRow(dopWork, true, dopActualTotal));

      // Сортировать по иерархии (как на UI)
      const sortedDopItems = sortItemsByHierarchy(dopBoqItems, `ДОП ${dopWork.position_number}: ${dopWork.work_name}`);

      // Выводить в порядке иерархии
      sortedDopItems.forEach(item => {
        rows.push(createBoqItemRow(item, dopWork));
      });
    }
  });

  return rows;
}

/**
 * Создает рабочий лист Excel с данными и стилями
 */
function createWorksheet(rows: ExportRow[]) {
  // Заголовки колонок
  const headers = [
    'Номер позиции',
    '№ п/п',
    'Затрата на строительство',
    'Привязка материала к работе',
    'Тип элемента',
    'Тип материала',
    'Наименование',
    'Ед. изм.',
    'Количество заказчика',
    'Коэфф. перевода',
    'Коэфф. расхода',
    'Количество ГП',
    'Валюта',
    'Тип доставки',
    'Стоимость доставки',
    'Цена за единицу',
    'Итоговая сумма',
    'Ссылка на КП',
    'Примечание заказчика',
    'Примечание ГП',
  ];

  // Создать массив данных (числа записываем как числа, НЕ как строки!)
  const data = rows.map(row => [
    row.itemNo,
    row.positionNumber,
    row.costCategory,
    row.materialLinkedToWork,
    row.elementType,
    row.materialType,
    row.name,
    row.unit,
    row.clientVolume !== null ? row.clientVolume : '',
    row.conversionCoeff !== null ? row.conversionCoeff : '',
    row.consumptionCoeff !== null ? row.consumptionCoeff : '',
    row.gpVolume !== null ? row.gpVolume : '',
    row.currency,
    row.deliveryType,
    row.deliveryCost !== null ? row.deliveryCost : '',
    row.unitPrice !== null ? row.unitPrice : '',
    row.totalAmount !== null ? row.totalAmount : '',
    row.quoteLink,
    row.clientNote,
    row.gpNote,
  ]);

  // Создать рабочий лист
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Применить стили к заголовкам
  for (let col = 0; col < headers.length; col++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
    if (!ws[cellRef]) ws[cellRef] = { t: 's', v: headers[col] };
    ws[cellRef].s = headerStyle;
  }

  // Применить стили к ячейкам данных
  rows.forEach((row, rowIndex) => {
    const style = getCellStyle(row);

    for (let col = 0; col < headers.length; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: rowIndex + 1, c: col });
      if (!ws[cellRef]) ws[cellRef] = { t: 's', v: '' };

      const isNumeric = numericColIndices.includes(col);

      // Колонка 5 (Наименование) - выравнивание по левому краю с переносом
      // Остальные колонки - выравнивание по центру
      if (col === nameColIndex) {
        // Наименование - по левому краю, по вертикали по центру
        ws[cellRef].s = {
          ...style,
          border: cellBorderStyle,
          alignment: {
            wrapText: true,
            vertical: 'center',
            horizontal: 'left'
          },
        };
      } else {
        // Все остальные колонки - по центру
        ws[cellRef].s = {
          ...style,
          border: cellBorderStyle,
          alignment: {
            wrapText: true,
            vertical: 'center',
            horizontal: 'center'
          },
        };
      }

      // Установить числовой формат для ВСЕХ числовых колонок (даже пустых)
      if (isNumeric) {
        // Колонки 7,8,9,10 (количества и коэффициенты) - 4 знака после запятой БЕЗ разделителя тысяч
        // Колонки 13,14,15 (стоимости и суммы) - 2 знака после запятой С разделителем тысяч
        ws[cellRef].z = fourDecimalColIndices.includes(col) ? '0.0000' : '# ##0.00';

        // Если ячейка не пустая, убедиться что это число
        if (ws[cellRef].v !== '' && ws[cellRef].v !== null && ws[cellRef].v !== undefined) {
          // Если это уже число - просто установить тип
          if (typeof ws[cellRef].v === 'number') {
            ws[cellRef].t = 'n';
          }
          // Если это строка - попробовать преобразовать
          else if (typeof ws[cellRef].v === 'string') {
            const numValue = parseFloat(ws[cellRef].v);
            if (!isNaN(numValue)) {
              ws[cellRef].t = 'n';
              ws[cellRef].v = numValue;
            }
          }
        }
      }
    }
  });

  // Установить ширину колонок
  ws['!cols'] = columnWidths;

  // Установить высоту строки заголовка (увеличена для переноса текста)
  ws['!rows'] = [{ hpt: 40 }];

  // Заморозить первую строку (заголовки)
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  return ws;
}

/**
 * Главная функция экспорта позиций заказчика в Excel
 */
export async function exportPositionsToExcel(
  tenderId: string,
  tenderTitle: string,
  tenderVersion: number
): Promise<void> {
  try {
    // Загрузить все позиции и все BOQ items ОДНИМ запросом каждый
    const [positions, boqItemsByPosition] = await Promise.all([
      loadClientPositions(tenderId),
      loadAllBoqItemsForTender(tenderId)
    ]);

    if (positions.length === 0) {
      throw new Error('Нет позиций для экспорта');
    }

    // Собрать все строки для экспорта (БЕЗ дополнительных запросов к БД)
    const rows = collectExportRows(positions, boqItemsByPosition);

    // Создать рабочий лист
    const worksheet = createWorksheet(rows);

    // Создать рабочую книгу
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Позиции заказчика');

    // Сформировать имя файла
    const fileName = `Расчет ПЗ_${tenderTitle}_Версия ${tenderVersion}.xlsx`;

    // Экспортировать файл
    XLSX.writeFile(workbook, fileName);
  } catch (error: any) {
    console.error('Ошибка экспорта в Excel:', error);
    throw error;
  }
}
