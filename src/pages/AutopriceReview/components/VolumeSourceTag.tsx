import type { FC, MouseEvent } from 'react';
import { Tooltip } from 'antd';
import type { IVolumeSource } from '../types';
import { volumeSourceParts } from '../utils/volumeFormat';
import styles from './VolumeSourceTag.module.css';

interface IVolumeSourceTagProps {
  source: IVolumeSource | null | undefined;
}

const stop = (e: MouseEvent) => e.stopPropagation();

/** Ярлык источника объёма: «Объём от ИИ» (с подсказкой) или «Объём условный». Для ВОР Заказчика не рисуется. */
export const VolumeSourceTag: FC<IVolumeSourceTagProps> = ({ source }) => {
  if (!source) return null;
  if (source.kind === 'conditional') {
    return (
      <span className={`${styles.tag} ${styles.conditional}`} onClick={stop}>
        Объём условный
      </span>
    );
  }
  if (source.kind !== 'ai_model') return null;
  const parts = volumeSourceParts(source);
  const title = (
    <div className={styles.tipLines}>
      {parts.map((p, i) => (
        <div key={i}>{p}</div>
      ))}
    </div>
  );
  return (
    <Tooltip title={parts.length > 0 ? title : undefined} trigger={['hover', 'click']}>
      {/* Клик по ярлыку в строке списка не должен открывать панель позиции. */}
      <span className={`${styles.tag} ${styles.ai}`} onClick={stop}>
        Объём от ИИ
      </span>
    </Tooltip>
  );
};
