import type { CSSProperties, FC } from 'react';
import { Modal } from 'antd';
import { DeleteOutlined, LoadingOutlined } from '@ant-design/icons';
import type { TenderRegistryWithRelations } from '../../../../lib/types';
import { pluralize } from '../../../../utils/pluralize';
import { getTenderControlVars, type TenderMonitorPalette } from '../../utils/tenderMonitorTheme';

interface ITenderDeleteConfirmProps {
  open: boolean;
  tenders: TenderRegistryWithRelations[];
  deleting: boolean;
  palette: TenderMonitorPalette;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Подтверждение удаления в стиле окна тендера: список удаляемого и что остаётся. */
export const TenderDeleteConfirm: FC<ITenderDeleteConfirmProps> = ({
  open,
  tenders,
  deleting,
  palette,
  onCancel,
  onConfirm,
}) => {
  const count = tenders.length;
  const title =
    count === 1
      ? 'Удалить тендер из перечня?'
      : `Удалить из перечня ${count} ${pluralize(count, 'тендер', 'тендера', 'тендеров')}?`;

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      maskClosable={!deleting}
      keyboard={!deleting}
      footer={null}
      closeIcon={null}
      width={520}
      centered
      styles={{
        content: {
          background: palette.cardBg,
          border: `1px solid ${palette.dangerBorder}`,
          borderRadius: 14,
          padding: 0,
          overflow: 'hidden',
        },
        body: { padding: 0 },
        mask: { backdropFilter: 'blur(4px)' },
      }}
    >
      <div className="tm-delete" style={getTenderControlVars(palette) as CSSProperties}>
        <div className="tm-delete__title">{title}</div>
        <ul className="tm-delete__list">
          {tenders.map((tender) => (
            <li key={tender.id} className="tm-delete__item">
              <div className="tm-delete__name">{tender.title}</div>
              <div className="tm-delete__meta">
                {[tender.client_name, tender.tender_number ? `№${tender.tender_number}` : null].filter(Boolean).join(' · ')}
              </div>
            </li>
          ))}
        </ul>
        <p className="tm-delete__note">
          Удалятся строки перечня с хронологией и тендерным пакетом. Расчёты тендеров — позиции заказчика, ВОР и КП —
          останутся. Отменить удаление нельзя.
        </p>
        <div className="tm-delete__actions">
          <button type="button" className="tm-btn" onClick={onCancel} disabled={deleting}>
            Отмена
          </button>
          <button
            type="button"
            className="tm-btn tm-btn--danger"
            onClick={onConfirm}
            disabled={deleting || count === 0}
            aria-busy={deleting || undefined}
          >
            {deleting ? <LoadingOutlined aria-hidden /> : <DeleteOutlined aria-hidden />}
            Удалить
          </button>
        </div>
      </div>
    </Modal>
  );
};
