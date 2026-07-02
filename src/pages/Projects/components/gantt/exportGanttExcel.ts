import dayjs from 'dayjs';
import * as XLSX from 'xlsx-js-style';
import type { ProjectFull, ProjectCompletion } from '../../../../lib/supabase/types';
import { buildGanttChartData, exportGanttCompletionWithCharts } from '../../../../utils/excel';
import type { MonthData } from './ganttUtils';

/**
 * Excel-экспорт выполнения объектов (только видимые проекты): грид
 * План/Факт по месяцам + нативные диаграммы. Перенесено из handleExport
 * без изменений логики; message.success/error остаются в компоненте.
 */
export const exportGanttCompletion = ({
  visibleProjects,
  months,
  getCompletion,
}: {
  visibleProjects: ProjectFull[];
  months: MonthData[];
  getCompletion: (projectId: string, year: number, month: number) => ProjectCompletion | undefined;
}): void => {
  // Header: Объект | Тип | <месяцы> | ИТОГО
  const headers = ['Объект', 'Тип', ...months.map((m) => m.label), 'ИТОГО'];

  // Две строки на объект (План сверху, Факт снизу) + метаданные для стилей.
  const rows: (string | number)[][] = [];
  const rowMeta: { kind: 'plan' | 'fact'; isItogo: boolean }[] = [];

  visibleProjects.forEach((project) => {
    const planCells: (string | number)[] = [];
    const factCells: (string | number)[] = [];
    let planTotal = 0;
    let factTotal = 0;

    months.forEach((month) => {
      const completion = getCompletion(project.id, month.year, month.month);
      const plan =
        completion && completion.forecast_amount && completion.forecast_amount > 0
          ? completion.forecast_amount
          : '';
      const fact = completion && completion.actual_amount > 0 ? completion.actual_amount : '';
      if (typeof plan === 'number') planTotal += plan;
      if (typeof fact === 'number') factTotal += fact;
      planCells.push(plan);
      factCells.push(fact);
    });

    rows.push([project.name, 'План', ...planCells, planTotal || '']);
    rowMeta.push({ kind: 'plan', isItogo: false });
    rows.push(['', 'Факт', ...factCells, factTotal || '']);
    rowMeta.push({ kind: 'fact', isItogo: false });
  });

  // ИТОГО двумя строками: суммы плана и факта по месяцам (по всем объектам).
  const planSums = months.map(() => 0);
  const factSums = months.map(() => 0);
  visibleProjects.forEach((project) => {
    months.forEach((month, mi) => {
      const completion = getCompletion(project.id, month.year, month.month);
      if (completion && completion.forecast_amount && completion.forecast_amount > 0) {
        planSums[mi] += completion.forecast_amount;
      }
      if (completion && completion.actual_amount > 0) {
        factSums[mi] += completion.actual_amount;
      }
    });
  });
  const grandPlan = planSums.reduce((a, b) => a + b, 0);
  const grandFact = factSums.reduce((a, b) => a + b, 0);
  rows.push(['ИТОГО', 'План', ...planSums.map((v) => v || ''), grandPlan || '']);
  rowMeta.push({ kind: 'plan', isItogo: true });
  rows.push(['', 'Факт', ...factSums.map((v) => v || ''), grandFact || '']);
  rowMeta.push({ kind: 'fact', isItogo: true });

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Объединяем имя объекта (колонка 0) по двум его строкам + ИТОГО по двум строкам.
  const merges = visibleProjects.map((_, p) => ({
    s: { r: 1 + p * 2, c: 0 },
    e: { r: 1 + p * 2 + 1, c: 0 },
  }));
  const itogoTop = 1 + visibleProjects.length * 2;
  merges.push({ s: { r: itogoTop, c: 0 }, e: { r: itogoTop + 1, c: 0 } });
  ws['!merges'] = merges;

  // Set column widths: Объект | Тип | месяцы | ИТОГО
  ws['!cols'] = [{ wch: 30 }, { wch: 8 }, ...months.map(() => ({ wch: 12 })), { wch: 15 }];

  // Style header row
  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '1890FF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: '000000' } },
      left: { style: 'thin', color: { rgb: '000000' } },
      right: { style: 'thin', color: { rgb: '000000' } },
    },
  };

  // Apply header style
  for (let i = 0; i < headers.length; i++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
    if (!ws[cellRef]) continue;
    ws[cellRef].s = headerStyle;
  }

  // Style for project names (first column)
  const nameStyle = {
    alignment: { horizontal: 'left', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: 'D9D9D9' } },
      bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
      left: { style: 'thin', color: { rgb: 'D9D9D9' } },
      right: { style: 'thin', color: { rgb: 'D9D9D9' } },
    },
  };

  // Style for numbers
  const numberStyle = {
    numFmt: '#,##0',
    alignment: { horizontal: 'right', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: 'D9D9D9' } },
      bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
      left: { style: 'thin', color: { rgb: 'D9D9D9' } },
      right: { style: 'thin', color: { rgb: 'D9D9D9' } },
    },
  };

  // Style for empty cells
  const emptyStyle = {
    alignment: { horizontal: 'right', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: 'D9D9D9' } },
      bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
      left: { style: 'thin', color: { rgb: 'D9D9D9' } },
      right: { style: 'thin', color: { rgb: 'D9D9D9' } },
    },
  };

  // Style for "Тип" column (План/Факт label)
  const typeStyle = {
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      top: { style: 'thin', color: { rgb: 'D9D9D9' } },
      bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
      left: { style: 'thin', color: { rgb: 'D9D9D9' } },
      right: { style: 'thin', color: { rgb: 'D9D9D9' } },
    },
  };

  // Style for plan numbers (yellow background)
  const planStyle = {
    numFmt: '#,##0',
    alignment: { horizontal: 'right', vertical: 'center' },
    fill: { fgColor: { rgb: 'FFE699' } }, // Yellow background
    border: {
      top: { style: 'thin', color: { rgb: 'D9D9D9' } },
      bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
      left: { style: 'thin', color: { rgb: 'D9D9D9' } },
      right: { style: 'thin', color: { rgb: 'D9D9D9' } },
    },
  };

  // Style for ИТОГО row
  const totalRowStyle = {
    numFmt: '#,##0',
    font: { bold: true },
    fill: { fgColor: { rgb: 'F0F0F0' } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: {
      top: { style: 'medium', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
      left: { style: 'thin', color: { rgb: 'D9D9D9' } },
      right: { style: 'thin', color: { rgb: 'D9D9D9' } },
    },
  };

  const totalNameStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: 'F0F0F0' } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: {
      top: { style: 'medium', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
      left: { style: 'thin', color: { rgb: 'D9D9D9' } },
      right: { style: 'thin', color: { rgb: 'D9D9D9' } },
    },
  };

  // ИТОГО — колонка «Тип»
  const totalTypeStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: 'F0F0F0' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      top: { style: 'medium', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
      left: { style: 'thin', color: { rgb: 'D9D9D9' } },
      right: { style: 'thin', color: { rgb: 'D9D9D9' } },
    },
  };

  // ИТОГО — строка «План» (жёлтая заливка)
  const totalPlanStyle = {
    numFmt: '#,##0',
    font: { bold: true },
    fill: { fgColor: { rgb: 'FFE699' } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: {
      top: { style: 'medium', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
      left: { style: 'thin', color: { rgb: 'D9D9D9' } },
      right: { style: 'thin', color: { rgb: 'D9D9D9' } },
    },
  };

  // Apply styles per row metadata (План — жёлтый, Факт — обычный).
  for (let r = 1; r <= rows.length; r++) {
    const meta = rowMeta[r - 1];

    for (let c = 0; c < headers.length; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      if (!ws[cellRef]) continue;

      if (c === 0) {
        // Объект
        ws[cellRef].s = meta.isItogo ? totalNameStyle : nameStyle;
      } else if (c === 1) {
        // Тип (План/Факт)
        ws[cellRef].s = meta.isItogo ? totalTypeStyle : typeStyle;
      } else {
        // Месяцы и колонка ИТОГО
        const cellValue = ws[cellRef].v;
        const isEmpty = cellValue === '' || cellValue === null || cellValue === undefined;
        if (meta.isItogo) {
          ws[cellRef].s = isEmpty || meta.kind === 'fact' ? totalRowStyle : totalPlanStyle;
        } else {
          ws[cellRef].s = isEmpty ? emptyStyle : meta.kind === 'plan' ? planStyle : numberStyle;
        }
      }
    }
  }

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Выполнение объектов');

  // Build native column charts (orange = факт, blue = план) under the money grid.
  const { chartAoa, blocks } = buildGanttChartData({
    projects: visibleProjects.map((p) => ({ id: p.id, name: p.name })),
    months: months.map((m) => ({ year: m.year, month: m.month, label: m.label })),
    getCompletion: (pid, year, month) => getCompletion(pid, year, month),
  });

  exportGanttCompletionWithCharts(wb, {
    blocks,
    chartAoa,
    mainSheetName: 'Выполнение объектов',
    fileName: `Выполнение_объектов_${dayjs().format('YYYY-MM-DD')}.xlsx`,
    gridRows: visibleProjects.length * 2 + 3, // header + 2 строки/объект + 2 строки ИТОГО
  });
};
