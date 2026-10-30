import type { FC } from 'react';
import { Button, Tag, Tooltip } from 'antd';
import type { IAnalogHit } from '../../../lib/api/analogs.types';
import { buildPositionTabPath } from '../../../lib/cache/workspaceTabsStorage';
import { formatNumber, similarityPercent } from '../utils/analogFormat';
import styles from '../AnalogPicker.module.css';

interface ICandidateCardProps {
  hit: IAnalogHit;
  targetUnit: string | null;
  onViewItems: (hit: IAnalogHit) => void;
  onChoose: (hit: IAnalogHit) => void;
}

const approvalTag = (approved: boolean | null) => {
  if (approved === true) return <Tag color="green">согласован</Tag>;
  if (approved === false) return <Tag color="orange">не согласован</Tag>;
  return <Tag>нет данных</Tag>;
};

/** Карточка кандидата-аналога. Ничего не выбирает само — только кнопки. */
export const CandidateCard: FC<ICandidateCardProps> = ({ hit, targetUnit, onViewItems, onChoose }) => {
  const tender = [
    hit.tender_number ? `Тендер № ${hit.tender_number}${hit.tender_version ? ` v${hit.tender_version}` : ''}` : null,
    hit.object_name ?? hit.tender_title,
    hit.client_name,
  ].filter((x): x is string => !!x);
  return (
    <div className={styles.card}>
      <div className={styles.title}>{hit.work_name}</div>
      <div className={styles.muted}>{tender.join(' · ') || 'Тендер не указан'}</div>
      <div className={styles.chips}>
        <span>Ед.: <b>{hit.unit_code ?? '—'}</b></span>
        <span>Объём: <b>{hit.volume === null ? '—' : formatNumber(hit.volume, 3)}</b></span>
        <span>Строк состава: <b>{hit.items_count}</b></span>
        {approvalTag(hit.financial_approved)}
        <Tooltip title="Похожесть формулировок названия, а не вероятность того, что состав подходит">
          <Tag>сходство названия {similarityPercent(hit.score)}%</Tag>
        </Tooltip>
      </div>
      {hit.unit_compatibility === 'conflict' && (
        <div className={styles.muted}>
          Единицы не совпадают: у аналога «{hit.unit_code ?? '—'}», у вас «{targetUnit ?? '—'}» — масштаб придётся задать вручную.
        </div>
      )}
      {hit.significant_token_conflict && (
        <div className={styles.muted}>Другие ключевые параметры в названии (марка, размер, класс и т.п.) — сверьте состав.</div>
      )}
      <div className={styles.cardActions}>
        <Button className={styles.btn} onClick={() => onViewItems(hit)}>Посмотреть состав</Button>
        <Button className={styles.btn} type="primary" onClick={() => onChoose(hit)}>Выбрать для предпросмотра</Button>
        <a
          className={styles.link}
          href={buildPositionTabPath(hit.position_id, hit.tender_id)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Открыть позицию-источник
        </a>
      </div>
    </div>
  );
};
