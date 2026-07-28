import type { ClientPosition } from '../../../lib/types';

export function normalizePositionSearchValue(value: string | number | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/[.,/\\()[\]_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function normalizePositionNumberSearchValue(value: string | number | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/\s+/g, '');
}

// Кэш нормализованных полей по идентичности объекта позиции: фильтр зовётся на каждый
// (deferred) ввод, а нормализация — locale-aware lowercase + regex-replace на каждое из
// двух полей × все позиции — его самая дорогая часть. Объекты позиций иммутабельны
// (правки приходят новыми объектами при рефетче/локальном апдейте), поэтому WeakMap не
// требует инвалидации и умирает вместе с данными.
const normalizedCache = new WeakMap<ClientPosition, { workName: string; itemNo: string }>();

function getNormalized(position: ClientPosition): { workName: string; itemNo: string } {
  let cached = normalizedCache.get(position);
  if (!cached) {
    cached = {
      workName: normalizePositionSearchValue(position.work_name),
      itemNo: normalizePositionNumberSearchValue(position.item_no),
    };
    normalizedCache.set(position, cached);
  }
  return cached;
}

export function filterPositionsBySearch(
  positions: ClientPosition[],
  query: string
): ClientPosition[] {
  const hasTrailingSpace = /\s$/.test(query);
  const normalizedQuery = normalizePositionSearchValue(query);
  const normalizedItemQuery = normalizePositionNumberSearchValue(query);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const exactItemNoMode = hasTrailingSpace && normalizedItemQuery.length > 0 && /\d/.test(normalizedItemQuery);

  if (!normalizedQuery) {
    return positions;
  }

  return positions.filter((position) => {
    const { workName, itemNo } = getNormalized(position);
    const workNameMatches =
      workName.includes(normalizedQuery) ||
      queryTokens.every((token) => workName.includes(token));
    const itemNoMatches = exactItemNoMode
      ? itemNo === normalizedItemQuery
      : normalizedItemQuery.length > 0 && itemNo.includes(normalizedItemQuery);

    return (
      workNameMatches ||
      itemNoMatches
    );
  });
}
