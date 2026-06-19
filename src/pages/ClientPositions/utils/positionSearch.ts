import type { ClientPosition } from '../../../lib/supabase';

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
    const workName = normalizePositionSearchValue(position.work_name);
    const itemNo = normalizePositionNumberSearchValue(position.item_no);
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
