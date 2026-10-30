import { useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Popconfirm, Result } from 'antd';
import {
  analogErrorMessage,
  fetchNextAnalogPosition,
  revertAnalogApplication,
} from '../../../lib/api/analogs';
import type { IAnalogApplyResult } from '../../../lib/api/analogs.types';
import styles from '../AnalogPicker.module.css';

interface IDoneStepProps {
  positionId: string;
  result: IAnalogApplyResult;
  onClose: () => void;
  /** Перейти к следующей позиции без состава. */
  onNext: (positionId: string) => void;
  /** Применение отменено — вернуться к кандидатам. */
  onReverted: () => void;
}

/** Экран «Черновик сохранён»: проверить и подтвердить, следующая позиция, отмена применения. */
export const DoneStep: FC<IDoneStepProps> = ({ positionId, result, onClose, onNext, onReverted }) => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'next' | 'revert' | null>(null);
  const [noNext, setNoNext] = useState(false);
  const app = result.application;

  const handleReview = () => {
    onClose();
    navigate(
      `/autoprice-review?tenderId=${encodeURIComponent(app.tender_id)}&runId=${encodeURIComponent(result.run_id)}&positionId=${encodeURIComponent(positionId)}`,
    );
  };

  const handleNext = async () => {
    setBusy('next');
    try {
      const next = await fetchNextAnalogPosition(positionId);
      if (next) onNext(next.position_id);
      else setNoNext(true);
    } catch (e) {
      message.error(analogErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const handleRevert = async () => {
    setBusy('revert');
    try {
      await revertAnalogApplication(app.id);
      message.success('Применение аналога отменено');
      onReverted();
    } catch (e) {
      message.error(analogErrorMessage(e));
      setBusy(null);
    }
  };

  return (
    <>
      <div className={styles.scroll}>
        <Result
          status="success"
          title="Черновик сохранён"
          subTitle={`Создано строк: ${app.items_created}. Цены и состав проверьте и подтвердите в «Подтверждении авторасценки».${result.replayed ? ' (Повторный запрос — второй комплект строк не создавался.)' : ''}`}
        />
        <div className={styles.doneActions}>
          <Button className={styles.btn} type="primary" disabled={busy !== null} onClick={handleReview}>
            Проверить и подтвердить
          </Button>
          <Button className={styles.btn} loading={busy === 'next'} disabled={busy === 'revert'} onClick={() => void handleNext()}>
            Следующая позиция без состава
          </Button>
          <Popconfirm
            title="Отменить применение аналога?"
            description="Строки, созданные этим решением, будут удалены."
            okText="Отменить применение"
            cancelText="Нет"
            onConfirm={() => void handleRevert()}
          >
            <Button className={styles.btn} danger loading={busy === 'revert'} disabled={busy === 'next'}>
              Отменить применение
            </Button>
          </Popconfirm>
        </div>
        {noNext && <div className={styles.muted}>Позиций без состава дальше нет.</div>}
      </div>
      <div className={styles.footer}>
        <span className={styles.footerSpacer} />
        <Button className={styles.btn} onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </>
  );
};
