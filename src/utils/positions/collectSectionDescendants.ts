export interface SectionPosition {
  id: string;
  hierarchy_level?: number | null;
  is_additional?: boolean | null;
  parent_position_id?: string | null;
}

export function collectSectionDescendants<T extends SectionPosition>(
  positions: T[],
  sectionPositionId: string
): Set<string> {
  const result = new Set<string>();
  const clickedIndex = positions.findIndex((p) => p.id === sectionPositionId);
  if (clickedIndex === -1) {
    return result;
  }

  const clickedPosition = positions[clickedIndex];
  const clickedLevel = clickedPosition.hierarchy_level || 0;

  result.add(sectionPositionId);

  for (let i = clickedIndex + 1; i < positions.length; i += 1) {
    const pos = positions[i];
    if (pos.is_additional) {
      continue;
    }
    const posLevel = pos.hierarchy_level || 0;
    if (posLevel <= clickedLevel) {
      break;
    }
    result.add(pos.id);
  }

  for (const pos of positions) {
    if (pos.is_additional && pos.parent_position_id && result.has(pos.parent_position_id)) {
      result.add(pos.id);
    }
  }

  return result;
}
