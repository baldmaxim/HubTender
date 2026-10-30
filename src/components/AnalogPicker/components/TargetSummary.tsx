import type { FC } from 'react';
import { Tag } from 'antd';
import type { IAnalogTarget } from '../../../lib/api/analogs.types';
import { TARGET_STATE_TEXT, formatNumber, summarizeRows } from '../utils/analogFormat';
import styles from '../AnalogPicker.module.css';

interface ITargetSummaryProps {
  target: IAnalogTarget;
  /** Свёрнутый вид без примечания и состава (шаги после выбора). */
  compact?: boolean;
}

const STATE_COLORS: Record<IAnalogTarget['state'], string> = {
  empty: 'green',
  draft_only: 'blue',
  has_foreign_rows: 'red',
  locked: 'red',
};

/** Сводка цели: название полностью, ед., действующий объём, примечание, состояние и состав. */
export const TargetSummary: FC<ITargetSummaryProps> = ({ target, compact = false }) => {
  const note = [target.client_note, target.manual_note].filter((x): x is string => !!x && x.trim() !== '');
  const label = target.item_no ? `№ ${target.position_number ?? '—'} (${target.item_no})` : `№ ${target.position_number ?? '—'}`;
  return (
    <div className={styles.target}>
      <div className={styles.muted}>Моя позиция {label}</div>
      <div className={styles.targetName}>{target.work_name}</div>
      <div className={styles.chips}>
        <span>Ед.: <b>{target.unit_code ?? '—'}</b></span>
        <span>Объём: <b>{target.volume === null ? '—' : formatNumber(target.volume, 3)}</b></span>
        <Tag color={STATE_COLORS[target.state]}>{TARGET_STATE_TEXT[target.state]}</Tag>
      </div>
      {!compact && note.length > 0 && <div className={styles.muted}>Примечание: {note.join(' · ')}</div>}
      {!compact && target.items.length > 0 && (
        <div className={styles.muted}>Состав сейчас: {target.items.length} стр. ({summarizeRows(target.items)})</div>
      )}
    </div>
  );
};
