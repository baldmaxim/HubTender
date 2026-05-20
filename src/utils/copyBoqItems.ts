import { copyPositionItems } from '../lib/api/boq';

interface CopyResult {
  worksCount: number;
  materialsCount: number;
  totalCopied: number;
}

/**
 * Скопировать все BOQ items (работы и материалы) из source-позиции в target.
 * Серверный эндпоинт делает всё в одной транзакции с audit-логом и пересчётом
 * total_material/total_works у целевой позиции.
 */
export async function copyBoqItems(
  sourcePositionId: string,
  targetPositionId: string,
): Promise<CopyResult> {
  const res = await copyPositionItems(sourcePositionId, targetPositionId);
  return {
    worksCount: res.works_count,
    materialsCount: res.materials_count,
    totalCopied: res.total_copied,
  };
}
