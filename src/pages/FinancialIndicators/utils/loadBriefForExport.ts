// Данные выжимки для Excel. Выжимка — дополнение к листу: при любой ошибке
// загрузки файл выгружается без неё, а не срывается.
import { fetchCostBenchmarks } from '../../../lib/api/costBenchmarks';
import { fetchTenderBrief } from '../../../lib/api/tenderBriefs';
import { briefTotalPerSp, pickBriefFacts } from '../../../lib/quality/briefPolicy';
import type { BriefSheetInput } from './briefSheetBlock';

export async function loadBriefForExport(tenderId: string): Promise<BriefSheetInput | null> {
  try {
    const brief = await fetchTenderBrief(tenderId);
    const hasText = brief.summary_text.trim() !== '';
    if (!hasText && !brief.updated_at) return null; // выжимку по тендеру ещё не вели
    const report = await fetchCostBenchmarks(tenderId).catch(() => null);
    return {
      totalPerSp: briefTotalPerSp(report),
      facts: pickBriefFacts(report, brief.fact_category_ids),
      summaryText: brief.summary_text,
    };
  } catch {
    return null;
  }
}
