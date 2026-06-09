// Чистые функции для импорта тендеров из Excel: разбор дат, парсинг хронологии
// и слияние JSONB-массивов (хронология / тендерный пакет) с существующими.

import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import type { ChronologyItem, TenderPackageItem } from '../../../lib/supabase';

export type ImportRowAction = 'create' | 'update' | 'skip';

export interface ParsedTender {
  tender_number?: string;
  title: string;
  client_name: string;
  object_address?: string;
  construction_scope?: string;
  area?: number;
  submission_date?: string;
  chronology?: string;
  construction_start_date?: string;
  site_visit_date?: string;
  site_visit_photo_url?: string;
  has_tender_package?: string;
  invitation_date?: string;
  status?: string;
}

const DDMMYYYY_FORMATS = ['DD.MM.YYYY', 'D.M.YYYY', 'DD.MM.YY', 'D.M.YY'];

/** Строка/Excel-serial → ISO, либо null. */
export function parseExcelDate(value: unknown): string | null {
  if (!value && value !== 0) return null;

  if (typeof value === 'string') {
    const parsed = dayjs(value.trim(), ['DD.MM.YYYY', 'YYYY-MM-DD', ...DDMMYYYY_FORMATS], true);
    return parsed.isValid() ? parsed.toISOString() : null;
  }

  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) {
      return dayjs(`${date.y}-${date.m}-${date.d}`).toISOString();
    }
  }

  return null;
}

/** Строка вида "15.10.2025" → ISO, либо null. */
export function parseDdmmyyyy(value: string): string | null {
  const parsed = dayjs(value.trim(), DDMMYYYY_FORMATS, true);
  return parsed.isValid() ? parsed.toISOString() : null;
}

/**
 * Разобрать многострочный текст в отдельные сегменты «дата + текст».
 * Пример:
 *   "1) 15.10.2025 - Получили приглашение\n2) 16.10.2025 - Зарегистрировались"
 *   → [{ date: 15.10, text: "Получили приглашение" }, { date: 16.10, text: "Зарегистрировались" }]
 */
function parseDatedSegments(raw?: string | null): Array<{ date: string | null; text: string }> {
  if (!raw) return [];

  const text = String(raw).replace(/\r\n?/g, '\n').trim();
  if (!text) return [];

  const segments = text
    .split(/\n+/)
    // Доп. сплит: несколько событий в одной строке ("1) ... 2) ...").
    .flatMap((line) => line.split(/\s+(?=\d{1,3}[).]\s*\d{1,2}\.\d{1,2}\.\d{2,4})/g))
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.map((segment) => {
    // Срезать ведущий нумератор/маркер: "1)" "2." "-" "•".
    const withoutBullet = segment.replace(/^\s*(?:\d{1,3}[).]|[-–—•])\s*/, '').trim();
    // Выделить ведущую дату и текст после разделителя.
    const match = withoutBullet.match(/^(\d{1,2}\.\d{1,2}\.\d{2,4})\s*[-–—:]?\s*([\s\S]*)$/);

    if (match) {
      const iso = parseDdmmyyyy(match[1]);
      if (iso) {
        return { date: iso, text: match[2].trim() };
      }
    }

    return { date: null, text: withoutBullet };
  });
}

/** Многострочный текст хронологии → события { date, text, type }. */
export function parseChronologyText(raw?: string | null): ChronologyItem[] {
  return parseDatedSegments(raw).map((segment) => ({ ...segment, type: 'default' as const }));
}

/** Многострочный текст «Наличие тендерного пакета» → позиции { date, text, link }. */
export function parseTenderPackageText(raw?: string | null): TenderPackageItem[] {
  return parseDatedSegments(raw).map((segment) => ({ ...segment, link: null }));
}

const normalize = (value?: string | null) => (value || '').trim().toLocaleLowerCase('ru-RU');

const chronologyKey = (item: ChronologyItem) => `${item.date || ''}|${normalize(item.text)}`;

/** existing + новые события, которых ещё нет (ключ: дата + текст). */
export function mergeChronologyItems(
  existing: ChronologyItem[] | null | undefined,
  incoming: ChronologyItem[],
): ChronologyItem[] {
  const base = existing || [];
  const seen = new Set(base.map(chronologyKey));
  const result = [...base];

  incoming.forEach((item) => {
    const key = chronologyKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  });

  return result;
}

/** existing + новые позиции пакета, которых ещё нет (ключ: текст). */
export function mergeTenderPackageItems(
  existing: TenderPackageItem[] | null | undefined,
  incoming: TenderPackageItem[],
): TenderPackageItem[] {
  const base = existing || [];
  const seen = new Set(base.map((item) => normalize(item.text)));
  const result = [...base];

  incoming.forEach((item) => {
    const key = normalize(item.text);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  });

  return result;
}
