import { type FC } from 'react';
import { ACTION_LABELS, STATUS_LABELS } from '../constants';
import type { AutopriceStatus, IAutopriceEvent } from '../types';
import { formatDateTime } from '../utils/format';
import styles from '../AutopriceReview.module.css';

const statusText = (s: string | null | undefined): string =>
  s ? (STATUS_LABELS[s as AutopriceStatus] ?? s) : '';

export const EventsList: FC<{ events: IAutopriceEvent[] }> = ({ events }) => {
  if (events.length === 0) return null;
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>История</div>
      <ul className={styles.plainList}>
        {sorted.map((e, i) => (
          <li key={`${e.at}-${i}`} className={styles.event}>
            <span className={styles.muted}>
              {formatDateTime(e.at)}
              {e.user_name ? ` · ${e.user_name}` : ''}
            </span>
            <div>
              {ACTION_LABELS[e.action] ?? e.action}
              {e.from && e.to && e.from !== e.to ? ` (${statusText(e.from)} → ${statusText(e.to)})` : ''}
            </div>
            {e.comment && <div className={styles.eventComment}>{e.comment}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
};
