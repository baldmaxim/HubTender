// Подготовка данных для нативных столбчатых графиков Excel (блок «График»).
// Чистая трансформация: из отображённых объектов + помесячного выполнения
// строит данные скрытого листа ChartData и метаданные блоков-графиков.

export interface GanttCompletionLookup {
  actual_amount: number;
  forecast_amount?: number | null;
}

export interface GanttChartInput {
  /** Отображённые объекты (порядок строк сетки). */
  projects: { id: string; name: string }[];
  /** Таймлайн месяцев. */
  months: { year: number; month: number; label: string }[];
  /** Поиск выполнения по объекту/месяцу. */
  getCompletion: (
    projectId: string,
    year: number,
    month: number,
  ) => GanttCompletionLookup | undefined;
}

export interface ChartBlock {
  title: string;
  /** 1-based номер строки с подписями (R) на листе ChartData. */
  startRow: number;
  monthCount: number;
  catLabels: string[];
  /** Факт по месяцам, null где значения нет (нет столбца). */
  faktPts: (number | null)[];
  /** План по месяцам, null где значения нет (нет столбца). */
  planPts: (number | null)[];
  catRef: string;
  faktRef: string;
  planRef: string;
  faktName: string;
  planName: string;
}

export interface GanttChartData {
  chartAoa: (string | number | null)[][];
  blocks: ChartBlock[];
}

const FAKT_NAME = 'Факт';
const PLAN_NAME = 'План';

/** 1-based номер колонки → буква(ы) Excel (2 → B, 27 → AA). */
function colLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

interface Point {
  label: string;
  fakt: number | null;
  plan: number | null;
}

export function buildGanttChartData(input: GanttChartInput): GanttChartData {
  const { projects, months, getCompletion } = input;
  const blocks: ChartBlock[] = [];
  const chartAoa: (string | number | null)[][] = [];

  const pushBlock = (title: string, points: Point[]): void => {
    if (points.length === 0) return;
    const R = 1 + blocks.length * 4; // labels=R, факт=R+1, план=R+2, разделитель=R+3
    const m = points.length;
    const last = colLetter(1 + m); // данные с колонки B (index 2)
    const catLabels = points.map((p) => p.label);
    const faktPts = points.map((p) => p.fakt);
    const planPts = points.map((p) => p.plan);

    blocks.push({
      title,
      startRow: R,
      monthCount: m,
      catLabels,
      faktPts,
      planPts,
      catRef: `ChartData!$B$${R}:$${last}$${R}`,
      faktRef: `ChartData!$B$${R + 1}:$${last}$${R + 1}`,
      planRef: `ChartData!$B$${R + 2}:$${last}$${R + 2}`,
      faktName: FAKT_NAME,
      planName: PLAN_NAME,
    });

    chartAoa.push([title, ...catLabels]);
    chartAoa.push([FAKT_NAME, ...faktPts]);
    chartAoa.push([PLAN_NAME, ...planPts]);
    chartAoa.push([]); // строка-разделитель
  };

  // График на объект (только месяцы, где есть факт и/или план).
  projects.forEach((project) => {
    const points: Point[] = [];
    months.forEach((mo) => {
      const c = getCompletion(project.id, mo.year, mo.month);
      const fakt = c && c.actual_amount > 0 ? c.actual_amount : null;
      const plan = c && c.forecast_amount && c.forecast_amount > 0 ? c.forecast_amount : null;
      if (fakt !== null || plan !== null) {
        points.push({ label: mo.label, fakt, plan });
      }
    });
    pushBlock(project.name, points);
  });

  // Итоговый график (сумма всех фактов и планов по месяцам).
  const summary: Point[] = [];
  months.forEach((mo) => {
    let sumF = 0;
    let sumP = 0;
    let anyF = false;
    let anyP = false;
    projects.forEach((project) => {
      const c = getCompletion(project.id, mo.year, mo.month);
      if (c && c.actual_amount > 0) {
        sumF += c.actual_amount;
        anyF = true;
      }
      if (c && c.forecast_amount && c.forecast_amount > 0) {
        sumP += c.forecast_amount;
        anyP = true;
      }
    });
    if (anyF || anyP) {
      summary.push({ label: mo.label, fakt: anyF ? sumF : null, plan: anyP ? sumP : null });
    }
  });
  pushBlock('ИТОГО (сумма по месяцам)', summary);

  return { chartAoa, blocks };
}
