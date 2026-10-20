import type { FC } from 'react';
import { DeleteOutlined } from '@ant-design/icons';
import { pluralize } from '../../../../utils/pluralize';

interface ITenderSelectionBarProps {
  count: number;
  onCancel: () => void;
  onDelete: () => void;
}

/** Панель внизу экрана, пока выбираются тендеры: видна при любой прокрутке списка и доски. */
export const TenderSelectionBar: FC<ITenderSelectionBarProps> = ({ count, onCancel, onDelete }) => (
  <div className="tm-select-dock">
    <div className="tm-select-bar" role="toolbar" aria-label="Удаление тендеров">
      <span className="tm-select-bar__text" aria-live="polite">
        {count > 0
          ? `Выбрано: ${count} ${pluralize(count, 'тендер', 'тендера', 'тендеров')}`
          : 'Отметьте тендеры, которые нужно удалить'}
      </span>
      <button type="button" className="tm-btn" onClick={onCancel}>
        Отмена
      </button>
      <button type="button" className="tm-btn tm-btn--danger" onClick={onDelete} disabled={count === 0}>
        <DeleteOutlined aria-hidden />
        Удалить
      </button>
    </div>
  </div>
);
