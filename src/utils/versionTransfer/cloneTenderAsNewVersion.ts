import { apiFetch } from '../../lib/api/client';

export interface CloneTenderResult {
  tenderId: string;
  version: number;
  positionsCopied: number;
  positionParentLinksRestored: number;
  boqItemsCopied: number;
  parentLinksRestored: number;
  costVolumesCopied: number;
  insuranceRowsCopied: number;
  subcontractExclusionsCopied: number;
  pricingDistributionCopied: number;
  markupPercentageCopied: number;
  documentsCopied: number;
  notesCopied: number;
  groupsCopied: number;
}

export async function cloneTenderAsNewVersion(sourceTenderId: string): Promise<CloneTenderResult> {
  let envelope: { data: Partial<CloneTenderResult> };
  try {
    envelope = await apiFetch<{ data: Partial<CloneTenderResult> }>(
      `/api/v1/tenders/${encodeURIComponent(sourceTenderId)}/versions/clone`,
      {
        method: 'POST',
        // Дублирование тендера — тяжёлая операция (копирование позиций/BOQ/
        // затрат/наценок/доков); отключаем дефолтный 10s-таймаут apiFetch.
        timeoutMs: 0,
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Ошибка дублирования тендера: ${msg}`);
  }

  const data = envelope?.data;
  if (!data || typeof data !== 'object') {
    throw new Error('Сервер не вернул результат дублирования тендера');
  }

  const result = data as Partial<CloneTenderResult>;

  if (!result.tenderId || typeof result.version !== 'number') {
    throw new Error('Сервер вернул неполный результат дублирования тендера');
  }

  return {
    tenderId: result.tenderId,
    version: result.version,
    positionsCopied: result.positionsCopied ?? 0,
    positionParentLinksRestored: result.positionParentLinksRestored ?? 0,
    boqItemsCopied: result.boqItemsCopied ?? 0,
    parentLinksRestored: result.parentLinksRestored ?? 0,
    costVolumesCopied: result.costVolumesCopied ?? 0,
    insuranceRowsCopied: result.insuranceRowsCopied ?? 0,
    subcontractExclusionsCopied: result.subcontractExclusionsCopied ?? 0,
    pricingDistributionCopied: result.pricingDistributionCopied ?? 0,
    markupPercentageCopied: result.markupPercentageCopied ?? 0,
    documentsCopied: result.documentsCopied ?? 0,
    notesCopied: result.notesCopied ?? 0,
    groupsCopied: result.groupsCopied ?? 0,
  };
}
