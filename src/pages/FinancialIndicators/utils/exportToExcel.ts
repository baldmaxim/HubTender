/**
 * Экспорт финансовых показателей в Excel — по образцу
 * «Финансовые показатели Образец.xlsx». Тонкая обёртка: строит лист
 * (buildFinancialSheet) и сохраняет файл.
 */

import { message } from 'antd';
import * as XLSX from 'xlsx-js-style';
import type { IndicatorRow } from '../hooks/useFinancialData';
import { buildFinancialSheet } from './buildFinancialSheet';

export function exportFinancialIndicatorsToExcel(
  data: IndicatorRow[],
  spTotal: number,
  customerTotal: number,
  tenderTitle: string,
  tenderVersion: number,
  /** Примечание о применённом снижении; строки таблицы уже содержат сниженные суммы. */
  discountNote?: string | null,
  /** Подзаголовок (объём строительства) в верхней строке — «Генподряд» и т.п. */
  volumeTitle?: string,
) {
  if (data.length === 0) {
    message.warning('Нет данных для экспорта');
    return;
  }

  const ws = buildFinancialSheet({ data, spTotal, customerTotal, tenderTitle, discountNote, volumeTitle });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Финансовые показатели');

  const fileName = `Финансовые показатели_${tenderTitle} (v${tenderVersion}).xlsx`;
  XLSX.writeFile(wb, fileName);

  message.success(`Данные экспортированы в файл ${fileName}`);
}
