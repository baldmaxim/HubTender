import type { FC } from 'react';
import { OBJECT_KIND_LABELS } from '../utils/objectKind';
import type { ObjectKind } from '../utils/objectKind';
import { STATUS_LABELS } from '../utils/status';
import { Glyph } from './Glyph';
import styles from './ObjectsMap.module.css';

interface IMapLegendProps {
  /** Типы, которые есть на карте (в порядке легенды). */
  kinds: readonly ObjectKind[];
}

/** Легенда карты: цвет — статус, значок внутри капли — тип объекта. */
export const MapLegend: FC<IMapLegendProps> = ({ kinds }) => (
  <div className={styles.legend}>
    <div className={styles.legendRow}>
      <span className={styles.legendItem}>
        <i className={`${styles.legendDot} ${styles.dotCurrent}`} />
        {STATUS_LABELS.current}
      </span>
      <span className={styles.legendItem}>
        <i className={`${styles.legendDot} ${styles.dotArchive}`} />
        Построенные
      </span>
    </div>
    {kinds.length > 0 && (
      <div className={styles.legendRow}>
        {kinds.map((kind) => (
          <span key={kind} className={styles.legendItem}>
            <Glyph name={kind} size={14} />
            {OBJECT_KIND_LABELS[kind]}
          </span>
        ))}
      </div>
    )}
  </div>
);
