import { useCallback, useEffect, useState } from 'react';
import { readStorage, writeStorage } from '../utils/safeStorage';

export const MIN_COLUMN_WIDTH = 56;
const SAVE_DELAY_MS = 250;

export type ColumnWidths = Record<string, number>;

const load = (storageKey: string, defaults: ColumnWidths): ColumnWidths => {
  const raw = readStorage(storageKey);
  if (!raw) return defaults;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaults;
    const stored = parsed as Record<string, unknown>;
    const result: ColumnWidths = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const v = stored[key];
      if (typeof v === 'number' && Number.isFinite(v) && v >= MIN_COLUMN_WIDTH) result[key] = Math.round(v);
    }
    return result;
  } catch {
    return defaults;
  }
};

/** Ширины колонок с сохранением в localStorage (запись отложена — во время drag не пишем на каждый кадр). */
export const useColumnWidths = (storageKey: string, defaults: ColumnWidths) => {
  const [widths, setWidths] = useState<ColumnWidths>(() => load(storageKey, defaults));

  const setWidth = useCallback((key: string, width: number) => {
    const next = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
    setWidths((prev) => (prev[key] === next ? prev : { ...prev, [key]: next }));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => writeStorage(storageKey, JSON.stringify(widths)), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [storageKey, widths]);

  return { widths, setWidth };
};
