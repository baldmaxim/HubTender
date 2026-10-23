import type { FC } from 'react';
import { formatAreaTotal } from '../utils/format';
import type { IObjectsStats } from '../utils/stats';
import styles from '../Objects.module.css';

interface IObjectsKpiProps {
  stats: IObjectsStats;
}

interface IKpiTile {
  key: string;
  label: string;
  value: string;
  dotClass?: string;
}

/** Компактные показатели по текущему фильтру и поиску. */
export const ObjectsKpi: FC<IObjectsKpiProps> = ({ stats }) => {
  const tiles: IKpiTile[] = [
    { key: 'total', label: 'Всего', value: stats.total.toLocaleString('ru-RU') },
    {
      key: 'current',
      label: 'В работе',
      value: stats.current.toLocaleString('ru-RU'),
      dotClass: styles.kpiDotCurrent,
    },
    {
      key: 'archive',
      label: 'Построено',
      value: stats.archive.toLocaleString('ru-RU'),
      dotClass: styles.kpiDotArchive,
    },
    { key: 'area', label: 'Общая площадь', value: formatAreaTotal(stats.area) },
  ];

  return (
    <div className={styles.kpi}>
      {tiles.map((t) => (
        <div key={t.key} className={`${styles.kpiTile} ${t.key === 'area' ? styles.kpiTileArea : ''}`}>
          <span className={styles.kpiLabel}>
            {t.dotClass && <i className={`${styles.kpiDot} ${t.dotClass}`} />}
            {t.label}
          </span>
          <span className={styles.kpiValue}>{t.value}</span>
        </div>
      ))}
    </div>
  );
};
