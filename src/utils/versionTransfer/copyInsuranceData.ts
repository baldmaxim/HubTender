/**
 * Копирование данных страхования от судимостей при создании новой версии тендера
 */

import { supabase } from '../../lib/supabase';

/**
 * Копирует запись tender_insurance из исходного тендера в новый.
 * Если у исходного тендера нет данных страхования — ничего не делает.
 */
export async function copyInsuranceData(
  sourceTenderId: string,
  newTenderId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('tender_insurance')
    .select(
      'judicial_pct, total_pct, apt_price_m2, apt_area, ' +
      'parking_price_m2, parking_area, storage_price_m2, storage_area'
    )
    .eq('tender_id', sourceTenderId)
    .maybeSingle();

  if (error || !data) return;

  const row = data as any;

  await supabase
    .from('tender_insurance')
    .upsert(
      {
        tender_id: newTenderId,
        judicial_pct: row.judicial_pct,
        total_pct: row.total_pct,
        apt_price_m2: row.apt_price_m2,
        apt_area: row.apt_area,
        parking_price_m2: row.parking_price_m2,
        parking_area: row.parking_area,
        storage_price_m2: row.storage_price_m2,
        storage_area: row.storage_area,
      },
      { onConflict: 'tender_id' }
    );
}
