import { useState, type FC } from 'react';
import { Button, Popconfirm, Tooltip } from 'antd';
import type { AutopriceAction, IReviewRow } from '../types';
import { ReturnModal } from './ReturnModal';
import styles from '../AutopriceReview.module.css';

interface IPanelActionsProps {
  review: IReviewRow;
  busy: boolean;
  isApprover: boolean;
  onAction: (action: AutopriceAction, okText: string, comment?: string) => Promise<boolean>;
}

/** Кнопки перехода статуса. Подтверждение недоступно при строках без цены и без нужной роли. */
export const PanelActions: FC<IPanelActionsProps> = ({ review, busy, isApprover, onAction }) => {
  const [returning, setReturning] = useState(false);
  const closed = review.status === 'approved' || review.status === 'excluded';

  let approveHint: string | null = null;
  if (review.zero_price_count > 0) approveHint = `${review.zero_price_count} строк без цены`;
  else if (!isApprover) approveHint = 'Подтверждать могут ведущий инженер и администратор';

  const reopenHint = isApprover ? null : 'Переоткрывать могут ведущий инженер и администратор';

  return (
    <div className={styles.actions}>
      {closed ? (
        <Tooltip title={reopenHint}>
          <span>
            <Button
              className={styles.actionBtn}
              disabled={busy || !isApprover}
              onClick={() => void onAction('reopen', 'Позиция переоткрыта')}
            >
              Переоткрыть
            </Button>
          </span>
        </Tooltip>
      ) : (
        <>
          <Tooltip title={approveHint}>
            <span>
              <Button
                className={styles.actionBtn}
                type="primary"
                loading={busy}
                disabled={approveHint !== null}
                onClick={() => void onAction('approve', 'Позиция подтверждена')}
              >
                Подтвердить
              </Button>
            </span>
          </Tooltip>
          <Button className={styles.actionBtn} disabled={busy} onClick={() => setReturning(true)}>
            Вернуть
          </Button>
          {review.status !== 'needs_customer' && (
            <Button
              className={styles.actionBtn}
              disabled={busy}
              onClick={() => void onAction('needs_customer', 'Ждём ответа Заказчика')}
            >
              Ждём Заказчика
            </Button>
          )}
          <Popconfirm
            title="Исключить позицию из подтверждения?"
            okText="Исключить"
            cancelText="Отмена"
            onConfirm={() => void onAction('exclude', 'Позиция исключена')}
          >
            <Button className={styles.actionBtn} danger disabled={busy}>
              Исключить
            </Button>
          </Popconfirm>
        </>
      )}
      <ReturnModal
        open={returning}
        busy={busy}
        onCancel={() => setReturning(false)}
        onSubmit={(reason) => {
          void onAction('return', 'Позиция возвращена', reason).then((ok) => {
            if (ok) setReturning(false);
          });
        }}
      />
    </div>
  );
};
