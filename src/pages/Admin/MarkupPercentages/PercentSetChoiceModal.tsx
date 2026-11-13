import React from 'react';
import { Button, Modal } from 'antd';
import { PERCENT_SET_LABELS, type PercentSet } from '../../../services/markupTactic/percentSets';
import styles from './MarkupPercentages.module.css';

interface IPercentSetChoiceModalProps {
  open: boolean;
  oldCount: number;
  newLabels: string[];
  onChoose: (set: PercentSet) => void;
}

/** Выбор списка базовых процентов при открытии страницы. Закрытие без выбора = старые. */
export const PercentSetChoiceModal: React.FC<IPercentSetChoiceModalProps> = ({
  open,
  oldCount,
  newLabels,
  onChoose,
}) => (
  <Modal
    title="Какие базовые проценты использовать?"
    open={open}
    onCancel={() => onChoose('old')}
    footer={null}
    centered
    width="min(520px, calc(100vw - 32px))"
  >
    <div className={styles.choiceList}>
      <Button className={styles.choiceButton} onClick={() => onChoose('old')}>
        <span className={styles.choiceTitle}>{PERCENT_SET_LABELS.old}</span>
        <span className={styles.choiceHint}>
          {`${oldCount} параметров, порядок расчёта «Базовая схема»`}
        </span>
      </Button>
      <Button type="primary" className={styles.choiceButton} onClick={() => onChoose('new')}>
        <span className={styles.choiceTitle}>{PERCENT_SET_LABELS.new}</span>
        <span className={styles.choiceHint}>
          {newLabels.length > 0 ? newLabels.join(', ') : '6 параметров'}
        </span>
      </Button>
    </div>
  </Modal>
);
