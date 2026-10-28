import type { BoqItemType } from '../../../lib/types';
import type { IPositionItem } from '../types';

/** Порядок типов в сводке. */
export const BOQ_TYPE_ORDER: readonly BoqItemType[] = [
  'раб',
  'мат',
  'суб-раб',
  'суб-мат',
  'раб-комп.',
  'мат-комп.',
];

export const isBoqItemType = (t: string): t is BoqItemType =>
  (BOQ_TYPE_ORDER as readonly string[]).includes(t);

export const isMaterialItemType = (t: string): boolean =>
  t === 'мат' || t === 'суб-мат' || t === 'мат-комп.';

export const isWorkItemType = (t: string): boolean =>
  t === 'раб' || t === 'суб-раб' || t === 'раб-комп.';

/** «основн.» → «осн.», «вспомогат.» → «вспом.». */
export const shortMaterialType = (t: string | null): string | null => {
  if (!t) return null;
  return t.startsWith('осн') ? 'осн.' : t.startsWith('вспом') ? 'вспом.' : t;
};

/** Множество id работ, на которые могут ссылаться материалы этого списка. */
export const workIdSet = (items: IPositionItem[]): Set<string> =>
  new Set(items.filter((i) => isWorkItemType(i.boq_item_type)).map((i) => i.id));

/** Строка привязана к работе из этого же списка. */
export const isLinkedToWork = (item: IPositionItem, works: Set<string>): boolean =>
  item.parent_work_item_id !== null && works.has(item.parent_work_item_id);

/** Сводка: «раб 3 · мат 5 (осн. 4, вспом. 1) · суб-мат 2 (осн. 2)». Нулевые типы пропускаются. */
export const summarizeItems = (items: IPositionItem[]): string => {
  const counts = new Map<string, number>();
  const kindsByType = new Map<string, Map<string, number>>();
  for (const item of items) {
    const t = item.boq_item_type;
    counts.set(t, (counts.get(t) ?? 0) + 1);
    const kind = isMaterialItemType(t) ? shortMaterialType(item.material_type) : null;
    if (!kind) continue;
    const kinds = kindsByType.get(t) ?? new Map<string, number>();
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    kindsByType.set(t, kinds);
  }
  return BOQ_TYPE_ORDER.filter((t) => (counts.get(t) ?? 0) > 0)
    .map((t) => {
      const base = `${t} ${counts.get(t)}`;
      const kinds = kindsByType.get(t);
      if (!kinds) return base;
      return `${base} (${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')})`;
    })
    .join(' · ');
};
