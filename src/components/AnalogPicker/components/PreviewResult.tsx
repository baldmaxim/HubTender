import type { FC } from 'react';
import { Alert } from 'antd';
import type { IAnalogPreview } from '../../../lib/api/analogs.types';
import { blockedReasonText, formatNumber } from '../utils/analogFormat';
import { ItemsGrid } from './ItemsGrid';
import styles from '../AnalogPicker.module.css';

const MODE_TEXT: Record<string, string> = {
  volume_ratio: 'пропорционально объёму',
  factor: 'свой коэффициент',
  none: 'без масштабирования',
};

/** Результат предпросмотра: источник, объёмы, способ и k, предупреждения, итоги и строки — всё с сервера. */
export const PreviewResult: FC<{ preview: IAnalogPreview }> = ({ preview }) => {
  const { source, scale, totals, warnings, items } = preview;
  return (
    <div className={styles.stack}>
      <div className={styles.sectionTitle}>Предпросмотр — ничего ещё не сохранено</div>
      <div className={styles.muted}>
        Источник: тендер № {source.tender_number ?? '—'}{source.version ? ` v${source.version}` : ''} · {source.work_name}
      </div>
      <div className={styles.chips}>
        <span>Объём аналога: <b>{scale.source_volume === null ? '—' : formatNumber(scale.source_volume, 3)} {source.unit_code ?? ''}</b></span>
        <span>Объём моей позиции: <b>{scale.target_volume === null ? '—' : formatNumber(scale.target_volume, 3)}</b></span>
        <span>Способ: <b>{MODE_TEXT[scale.mode] ?? scale.mode}</b>, k = <b>{formatNumber(scale.factor, 6)}</b></span>
      </div>

      {preview.blocked_reason && <Alert type="error" showIcon message={blockedReasonText(preview.blocked_reason)} />}
      {warnings.map((w, i) => (
        <Alert key={`${w.code}-${i}`} type="warning" showIcon message={w.message} />
      ))}

      <div className={styles.totals}>
        <span>Работ: {totals.works_count}</span>
        <span>Материалов: {totals.materials_count}</span>
        <span>Связей восстановлено: {totals.parent_links_restored}</span>
        <span>Материалы: {formatNumber(totals.total_material, 2)} ₽</span>
        <span>Работы: {formatNumber(totals.total_works, 2)} ₽</span>
      </div>

      <ItemsGrid rows={items} showTotal emptyText="Источник не дал ни одной строки." />
    </div>
  );
};
