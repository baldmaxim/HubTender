import type { CSSProperties, FC } from 'react';
import dayjs from 'dayjs';
import type { IUsageBucket, IUsageCell, IUsageRow } from '../utils/buildUsageRows';
import styles from '../Usage.module.css';

interface IUsageHeatmapProps {
  buckets: IUsageBucket[];
  rows: IUsageRow[];
  maxCellViews: number;
  byWeek: boolean;
}

/** Интенсивность ячейки 0.2…1: корень, чтобы редкие просмотры не терялись рядом с пиками. */
const cellLevel = (views: number, max: number): number =>
  max > 0 ? Math.min(1, 0.2 + 0.8 * Math.sqrt(views / max)) : 0;

const formatLast = (value: string | null): string => (value ? dayjs(value).format('DD.MM.YYYY HH:mm') : '—');

const cellTitle = (bucket: IUsageBucket, cell: IUsageCell | null, byWeek: boolean): string => {
  if (!cell) return `${bucket.title}: просмотров нет`;
  const users = byWeek ? `пользователей (сумма по дням): ${cell.users}` : `пользователей: ${cell.users}`;
  return `${bucket.title}: просмотров ${cell.views}, ${users}`;
};

export const UsageHeatmap: FC<IUsageHeatmapProps> = ({ buckets, rows, maxCellViews, byWeek }) => (
  <div className={styles.scroll}>
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={`${styles.stickyCol} ${styles.headCell}`}>Страница</th>
          <th className={styles.headCell}>Раздел меню</th>
          <th className={`${styles.headCell} ${styles.num}`}>Просмотров</th>
          <th className={`${styles.headCell} ${styles.num}`}>Пользователей</th>
          <th className={styles.headCell}>Последний просмотр</th>
          {buckets.map((b) => (
            <th key={b.key} className={`${styles.headCell} ${styles.bucketHead}`} title={b.title}>
              {b.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const unused = row.views === 0;
          return (
            <tr key={row.page} className={unused ? styles.rowUnused : undefined}>
              <td className={styles.stickyCol}>
                <span className={styles.pageLabel}>{row.label}</span>
                <span className={styles.pagePath}>{row.page}</span>
              </td>
              <td>{row.group}</td>
              <td className={styles.num}>
                {unused ? <span className={styles.unusedTag}>не открывали</span> : row.views}
              </td>
              <td className={styles.num}>{row.users}</td>
              <td>{formatLast(row.lastViewedAt)}</td>
              {buckets.map((b, index) => {
                const cell = row.cells[index];
                // Интенсивность — динамическое значение, поэтому через inline-переменную.
                const style = cell
                  ? ({ '--usage-level': cellLevel(cell.views, maxCellViews) } as CSSProperties)
                  : undefined;
                return (
                  <td
                    key={b.key}
                    className={styles.cell}
                    style={style}
                    title={cellTitle(b, cell, byWeek)}
                    aria-label={cellTitle(b, cell, byWeek)}
                  />
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
