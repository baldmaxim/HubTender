export interface SectionPosition {
  id: string;
  hierarchy_level?: number | null;
  is_additional?: boolean | null;
  parent_position_id?: string | null;
}

// ДОП следует за своей позицией: если родитель в наборе, ДОП тоже считается отобранной.
// Возвращает новый Set, входной не мутируется.
export function withParentAdditionals<T extends SectionPosition>(
  positions: T[],
  ids: ReadonlySet<string>
): Set<string> {
  const result = new Set<string>(ids);
  for (const pos of positions) {
    if (pos.is_additional && pos.parent_position_id && ids.has(pos.parent_position_id)) {
      result.add(pos.id);
    }
  }
  return result;
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

  return withParentAdditionals(positions, result);
}
