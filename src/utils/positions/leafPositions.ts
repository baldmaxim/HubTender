// Листовая позиция = та, в которую можно класть BOQ-items напрямую
// (нет дочерних позиций ниже по иерархии). Раздел/заголовок = нелистовая.
//
// Правила (исторически из Commerce — см. useCommerceData.ts до экстракции):
// - is_additional всегда лист (дополнительная не имеет детей)
// - последняя позиция всегда лист
// - текущая лист, если у следующей не-additional позиции hierarchy_level <= current

export interface LeafPositionInput {
  id: string;
  hierarchy_level?: number | null;
  is_additional?: boolean | null;
}

export function computeLeafPositionIds(positions: LeafPositionInput[]): Set<string> {
  const leafIds = new Set<string>();

  positions.forEach((position, index) => {
    if (position.is_additional) {
      leafIds.add(position.id);
      return;
    }

    if (index === positions.length - 1) {
      leafIds.add(position.id);
      return;
    }

    const currentLevel = position.hierarchy_level ?? 0;
    let nextIndex = index + 1;

    while (nextIndex < positions.length && positions[nextIndex].is_additional) {
      nextIndex++;
    }

    if (nextIndex >= positions.length || currentLevel >= (positions[nextIndex].hierarchy_level ?? 0)) {
      leafIds.add(position.id);
    }
  });

  return leafIds;
}
