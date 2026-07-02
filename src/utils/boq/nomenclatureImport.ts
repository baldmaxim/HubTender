import { buildNomenclatureLookupKey } from './importShared';

// Кандидат на добавление в номенклатуру (структурный тип — без привязки к
// page-типам одиночного/массового импорта).
export interface NomenclatureInsertCandidate {
  name: string;
  unit: string;
}

/**
 * Дедуплицирует список отсутствующих в номенклатуре записей (по ключу
 * name|unit) и отфильтровывает те, что уже есть в справочнике.
 * Общий хелпер одиночного и массового BOQ-импорта.
 */
export const buildMissingNomenclatureInserts = (
  groups: NomenclatureInsertCandidate[],
  existingKeys: Set<string>,
): NomenclatureInsertCandidate[] => {
  return Array.from(
    new Map(
      groups.map((group) => [
        buildNomenclatureLookupKey(group.name, group.unit),
        { name: group.name, unit: group.unit },
      ])
    ).entries()
  )
    .filter(([key]) => !existingKeys.has(key))
    .map(([, value]) => value);
};
