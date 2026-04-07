/**
 * Утилита для экспорта результатов перераспределения в Excel
 */

import * as XLSX from 'xlsx-js-style';
import type { ClientPosition } from '../hooks';
import type { RedistributionResult } from './calculateDistribution';
import type { ResultRow } from '../components/Results/ResultsTableColumns';

interface BoqItemFull {
  id: string;
  client_position_id: string;
  detail_cost_category_id: string | null;
  boq_item_type: string;
  total_commercial_work_cost: number;
  total_commercial_material_cost: number;
}

interface ExportData {
  clientPositions: ClientPosition[];
  redistributionResults: RedistributionResult[];
  boqItemsMap: Map<string, BoqItemFull>;
  tenderTitle: string;
  insuranceTotal?: number;
}

/**
 * Экспорт результатов перераспределения в Excel
 */
export function exportRedistributionToExcel(data: ExportData): void {
  const { clientPositions, redistributionResults, boqItemsMap, tenderTitle, insuranceTotal = 0 } = data;

  // Формируем Map результатов для быстрого доступа
  const resultsMap = new Map<string, RedistributionResult>();
  for (const result of redistributionResults) {
    resultsMap.set(result.boq_item_id, result);
  }

  // Заголовок
  const header = [
    'Номер раздела',
    'Наименование',
    'Кол-во заказчика',
    'Кол-во ГП',
    'Ед. изм.',
    'Цена за ед. мат-ал в КП',
    'Цена за ед. раб',
    'Итого материалы',
    'Итого работы',
    'Примечание ГП',
  ];

  // Разделяем позиции на обычные и ДОП
  const regularPositions = clientPositions.filter((p) => !p.is_additional);
  const additionalPositions = clientPositions.filter((p) => p.is_additional);

  // Функция определения конечности позиции по hierarchy_level
  const isLeafPosition = (index: number, positions: ClientPosition[]): boolean => {
    if (index === positions.length - 1) {
      return true;
    }

    const currentLevel = positions[index].hierarchy_level || 0;
    const nextLevel = positions[index + 1]?.hierarchy_level || 0;

    return currentLevel >= nextLevel;
  };

  // Функция для создания ResultRow для последующего округления
  const createResultRow = (position: ClientPosition, index: number, positions: ClientPosition[]): ResultRow => {
    // Получить все BOQ элементы для этой позиции
    const positionBoqItems = Array.from(boqItemsMap.entries()).filter(
      ([_, item]) => item.client_position_id === position.id
    );

    // Суммируем материалы и работы
    let totalMaterials = 0;
    let totalWorksBefore = 0;
    let totalWorksAfter = 0;
    let totalRedistribution = 0;

    for (const [boqItemId, boqItem] of positionBoqItems) {
      // Материалы - учитываем стоимость материалов
      const materialCost = boqItem.total_commercial_material_cost || 0;
      if (materialCost > 0) {
        totalMaterials += materialCost;
      }

      // Работы - учитываем стоимость работ из ВСЕХ элементов, которые имеют work_cost > 0
      // BOQ элемент может иметь ОДНОВРЕМЕННО и material_cost и work_cost
      const workCost = boqItem.total_commercial_work_cost || 0;
      if (workCost > 0) {
        const result = resultsMap.get(boqItemId);
        if (result) {
          // Работа участвовала в перераспределении
          totalWorksBefore += result.original_work_cost;
          totalWorksAfter += result.final_work_cost;
          totalRedistribution += result.added_amount - result.deducted_amount;
        } else {
          // Работа НЕ участвовала в перераспределении - берем оригинальную стоимость
          totalWorksBefore += workCost;
          totalWorksAfter += workCost;
        }
      }
    }

    // Рассчитываем цену за единицу
    const quantity = position.manual_volume || position.volume || 1;
    const materialUnitPrice = totalMaterials / quantity;
    const workUnitPriceBefore = totalWorksBefore / quantity;
    const workUnitPriceAfter = totalWorksAfter / quantity;

    // Определяем конечность позиции по hierarchy_level
    const isLeaf = isLeafPosition(index, positions);

    return {
      key: position.id,
      position_id: position.id,
      position_number: position.position_number,
      section_number: position.section_number,
      position_name: position.position_name,
      item_no: position.item_no,
      work_name: position.work_name,
      client_volume: position.volume,
      manual_volume: position.manual_volume,
      unit_code: position.unit_code,
      quantity,
      material_unit_price: materialUnitPrice,
      work_unit_price_before: workUnitPriceBefore,
      work_unit_price_after: workUnitPriceAfter,
      total_materials: totalMaterials,
      total_works_before: totalWorksBefore,
      total_works_after: totalWorksAfter,
      redistribution_amount: totalRedistribution,
      manual_note: position.manual_note,
      isLeaf,
      is_additional: position.is_additional,
    };
  };

  // Создаем ResultRow объекты для округления
  const regularResultRows = regularPositions.map((pos, idx) => createResultRow(pos, idx, regularPositions));
  const additionalResultRows = additionalPositions.map((pos, idx) => createResultRow(pos, idx, additionalPositions));
  const allResultRows = [...regularResultRows, ...additionalResultRows];
  const totalWorksAfterBase = allResultRows.reduce((sum, row) => sum + (row.total_works_after || 0), 0);

  // Функция для создания строки данных из ResultRow
  const createRow = (resultRow: ResultRow) => {
    const insuranceShare = totalWorksAfterBase > 0
      ? insuranceTotal * ((resultRow.total_works_after || 0) / totalWorksAfterBase)
      : 0;
    const materialUnitPrice = Math.round((resultRow.material_unit_price || 0) * 100) / 100;
    const workUnitPriceAfter = Math.round((((resultRow.total_works_after || 0) + insuranceShare) / resultRow.quantity) * 100) / 100;
    const totalMaterials = resultRow.total_materials;
    const totalWorksAfter = (resultRow.total_works_after || 0) + insuranceShare;

    // Формируем наименование
    let fullName = '';
    if (resultRow.is_additional) {
      // Для ДОП строк добавляем префикс
      fullName = `  [ДОП] ${resultRow.work_name}`;
    } else {
      const sectionPrefix = resultRow.section_number ? `[${resultRow.section_number}] ` : '';
      fullName = `${sectionPrefix}${resultRow.work_name}`;
    }

    // Определяем нулевую стоимость
    const totalCost = totalMaterials + totalWorksAfter;
    const isZeroCost = resultRow.isLeaf && totalCost === 0;

    return {
      data: [
        resultRow.item_no || '',
        fullName,
        resultRow.client_volume ?? '',
        resultRow.manual_volume ?? '',
        resultRow.unit_code,
        materialUnitPrice,
        workUnitPriceAfter,
        totalMaterials,
        totalWorksAfter,
        resultRow.manual_note || '',
      ],
      isLeaf: resultRow.isLeaf,
      isZeroCost,
      isSectionItemNo: /^\d+\.?$/.test((resultRow.item_no || '').trim()),
    };
  };

  // Формируем строки данных
  const rows = allResultRows.map(resultRow => createRow(resultRow));

  // Рассчитываем итоги
  const totals = [
    '',
    'ИТОГО:',
    '',
    '',
    '',
    '',
    '',
    rows.reduce((sum, row) => sum + (row.data[7] as number), 0),
    rows.reduce((sum, row) => sum + (row.data[8] as number), 0),
    '',
  ];

  // Объединяем все данные
  const sheetData = [
    header,
    ...rows.map(row => row.data),
    totals,
  ];

  // Создаем worksheet
  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Стили для заголовка таблицы
  const headerStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: 'E0E0E0' } },
    alignment: {
      horizontal: 'center',
      vertical: 'center',
      wrapText: true,
    },
    border: {
      top: { style: 'thin', color: { rgb: 'D3D3D3' } },
      bottom: { style: 'thin', color: { rgb: 'D3D3D3' } },
      left: { style: 'thin', color: { rgb: 'D3D3D3' } },
      right: { style: 'thin', color: { rgb: 'D3D3D3' } },
    },
  };

  // Стили для строки итогов
  const totalStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: 'E7E6E6' } },
    alignment: {
      horizontal: 'center',
      vertical: 'center',
      wrapText: true,
    },
    border: {
      top: { style: 'medium', color: { rgb: '000000' } },
      bottom: { style: 'medium', color: { rgb: '000000' } },
      left: { style: 'thin', color: { rgb: 'D3D3D3' } },
      right: { style: 'thin', color: { rgb: 'D3D3D3' } },
    },
  };

  // Стиль границ для ячеек данных
  const cellBorderStyle = {
    top: { style: 'thin', color: { rgb: 'D3D3D3' } },
    bottom: { style: 'thin', color: { rgb: 'D3D3D3' } },
    left: { style: 'thin', color: { rgb: 'D3D3D3' } },
    right: { style: 'thin', color: { rgb: 'D3D3D3' } },
  };

  // Индексы числовых колонок (для числового формата)
  const numericColIndices = [5, 6, 7, 8]; // Цена за ед мат-ал, Цена за ед раб, Итого материалы, Итого работы
  const nameColIndex = 1; // Колонка "Наименование"

  // Применяем стили к заголовку (строка 0)
  for (let col = 0; col < header.length; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
    if (!ws[cellAddress]) continue;
    ws[cellAddress].s = headerStyle;
  }

  // Применяем стили к строке итогов
  const totalRowIndex = 1 + rows.length;
  for (let col = 0; col < totals.length; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: totalRowIndex, c: col });
    if (!ws[cellAddress]) continue;
    ws[cellAddress].s = totalStyle;

    // Применяем числовой формат к числовым колонкам в итогах
    if (numericColIndices.includes(col)) {
      ws[cellAddress].z = '# ##0.00';
      if (ws[cellAddress].v !== '' && ws[cellAddress].v !== null && ws[cellAddress].v !== undefined) {
        if (typeof ws[cellAddress].v === 'number') {
          ws[cellAddress].t = 'n';
        } else if (typeof ws[cellAddress].v === 'string') {
          const numValue = parseFloat(ws[cellAddress].v);
          if (!isNaN(numValue)) {
            ws[cellAddress].t = 'n';
            ws[cellAddress].v = numValue;
          }
        }
      }
    }
  }

  // Применяем стили к ячейкам данных
  for (let row = 1; row < 1 + rows.length; row++) {
    const rowData = rows[row - 1]; // Получаем метаданные строки
    const isZeroCostRow = rowData.isZeroCost;

    for (let col = 0; col < header.length; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      if (!ws[cellAddress]) ws[cellAddress] = { t: 's', v: '' };

      const isNumeric = numericColIndices.includes(col);

      // Базовый стиль с границами
      const baseStyle: any = {
        border: cellBorderStyle,
        alignment: {
          wrapText: true,
          vertical: 'center',
          horizontal: col === nameColIndex ? 'left' : 'center',
        },
      };

      // Добавляем бледно-красный фон для листовых строк с нулевой стоимостью
      if (isZeroCostRow) {
        baseStyle.fill = { fgColor: { rgb: 'FFCCCC' } };
      }

      if (col === 0 && rowData.isSectionItemNo) {
        baseStyle.fill = { fgColor: { rgb: 'D6E4FF' } };
        baseStyle.font = { bold: true };
      }

      ws[cellAddress].s = baseStyle;

      // Установить числовой формат для числовых колонок
      if (isNumeric) {
        ws[cellAddress].z = '# ##0.00';

        // Если ячейка не пустая, убедиться что это число
        if (ws[cellAddress].v !== '' && ws[cellAddress].v !== null && ws[cellAddress].v !== undefined) {
          if (typeof ws[cellAddress].v === 'number') {
            ws[cellAddress].t = 'n';
          } else if (typeof ws[cellAddress].v === 'string') {
            const numValue = parseFloat(ws[cellAddress].v);
            if (!isNaN(numValue)) {
              ws[cellAddress].t = 'n';
              ws[cellAddress].v = numValue;
            }
          }
        }
      }
    }
  }

  // Устанавливаем ширину колонок
  ws['!cols'] = [
    { wch: 15 }, // Номер раздела
    { wch: 40 }, // Наименование
    { wch: 15 }, // Кол-во заказчика
    { wch: 12 }, // Кол-во ГП
    { wch: 10 }, // Ед. изм.
    { wch: 20 }, // Цена за ед. мат-ал
    { wch: 18 }, // Цена за ед. раб (После)
    { wch: 18 }, // Итого материалы
    { wch: 18 }, // Итого работы (После)
    { wch: 30 }, // Примечание ГП
  ];

  // Установить высоту строки заголовка (для переноса текста)
  ws['!rows'] = [{ hpt: 40 }];

  // Заморозить первую строку (заголовки)
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  // Создаем workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Результаты');

  // Генерируем имя файла
  const fileName = `Форма КП_${tenderTitle}.xlsx`;

  // Экспортируем
  XLSX.writeFile(wb, fileName);
}
