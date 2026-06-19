import * as XLSX from 'xlsx-js-style';
import type { BoqItemData } from '../types';

/**
 * Экспорт БСМ в Excel со стилями. Возвращает false, если экспортировать нечего
 * (вызывающий показывает предупреждение), true — если файл записан.
 */
export function exportBsmToExcel(filteredItems: BoqItemData[], selectedTenderTitle: string | null): boolean {
  if (filteredItems.length === 0) {
    return false;
  }

  const headers = [
    '№',
    'Тип',
    'Затрата',
    'Наименование',
    'Количество',
    'Ед.изм.',
    'Цена за ед., ₽',
    'Сумма, ₽',
    'Кол-во позиций',
    'Ссылка на КП',
  ];

  const data = filteredItems.map((item, index) => [
    index + 1,
    item.boq_item_type,
    item.expense_label || '—',
    item.name,
    item.total_quantity,
    item.unit_code,
    item.price_per_unit,
    item.total_amount,
    item.usage_count,
    item.quote_link || '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  const headerStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: 'E0E0E0' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: 'D3D3D3' } },
      bottom: { style: 'thin', color: { rgb: 'D3D3D3' } },
      left: { style: 'thin', color: { rgb: 'D3D3D3' } },
      right: { style: 'thin', color: { rgb: 'D3D3D3' } },
    },
  };

  for (let col = 0; col < headers.length; col++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
    if (!ws[cellRef]) ws[cellRef] = { t: 's', v: headers[col] };
    ws[cellRef].s = headerStyle;
  }

  const numericFormats: Record<number, string> = { 4: '0.00', 6: '# ##0.00', 7: '# ##0', 8: '0' };

  filteredItems.forEach((_item, rowIndex) => {
    for (let col = 0; col < headers.length; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: rowIndex + 1, c: col });
      if (!ws[cellRef]) ws[cellRef] = { t: 's', v: '' };

      ws[cellRef].s = {
        border: {
          top: { style: 'thin', color: { rgb: 'D3D3D3' } },
          bottom: { style: 'thin', color: { rgb: 'D3D3D3' } },
          left: { style: 'thin', color: { rgb: 'D3D3D3' } },
          right: { style: 'thin', color: { rgb: 'D3D3D3' } },
        },
        alignment: {
          wrapText: true,
          vertical: 'center',
          horizontal: col === 3 ? 'left' : 'center', // Наименование(3) — слева, остальные по центру
        },
      };

      const fmt = numericFormats[col];
      if (fmt) {
        ws[cellRef].z = fmt;
        const v = ws[cellRef].v;
        if (v !== '' && v !== null && v !== undefined) {
          if (typeof v === 'number') {
            ws[cellRef].t = 'n';
          } else if (typeof v === 'string') {
            const numValue = parseFloat(v);
            if (!isNaN(numValue)) {
              ws[cellRef].t = 'n';
              ws[cellRef].v = numValue;
            }
          }
        }
      }
    }
  });

  ws['!cols'] = [
    { wch: 5 },   // №
    { wch: 12 },  // Тип
    { wch: 35 },  // Затрата
    { wch: 40 },  // Наименование
    { wch: 12 },  // Количество
    { wch: 10 },  // Ед.изм.
    { wch: 15 },  // Цена за ед., ₽
    { wch: 15 },  // Сумма, ₽
    { wch: 14 },  // Кол-во позиций
    { wch: 30 },  // Ссылка на КП
  ];
  ws['!rows'] = [{ hpt: 30 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, ws, 'БСМ');

  const fileName = `БСМ_${selectedTenderTitle || 'тендер'}_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(workbook, fileName);
  return true;
}
