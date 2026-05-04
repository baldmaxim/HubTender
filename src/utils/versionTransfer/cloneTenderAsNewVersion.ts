import { supabase } from '../../lib/supabase';

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
  const { data, error } = await supabase.rpc('clone_tender_as_new_version', {
    p_source_tender_id: sourceTenderId,
  });

  if (error) {
    throw new Error(`Ошибка дублирования тендера: ${error.message}`);
  }

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
