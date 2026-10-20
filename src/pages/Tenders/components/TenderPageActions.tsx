import type { FC } from 'react';
import { DeleteOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';

interface ITenderPageActionsProps {
  showAddForm: boolean;
  /** Идёт выбор тендеров для удаления — кнопка «Удалить тендер» нажата. */
  selecting: boolean;
  onToggleSelect: () => void;
  onToggleAddForm: () => void;
  onImport: () => void;
}

/** Кнопки шапки «Перечня тендеров» — в стиле кнопок страницы (.tm-btn). */
export const TenderPageActions: FC<ITenderPageActionsProps> = ({
  showAddForm,
  selecting,
  onToggleSelect,
  onToggleAddForm,
  onImport,
}) => (
  <div className="tm-page-actions">
    <button
      type="button"
      className={selecting ? 'tm-btn tm-btn--lg tm-btn--danger' : 'tm-btn tm-btn--lg tm-btn--delete'}
      aria-pressed={selecting}
      onClick={onToggleSelect}
    >
      <DeleteOutlined aria-hidden />
      Удалить тендер
    </button>
    <button type="button" className="tm-btn tm-btn--lg tm-btn--accent" aria-expanded={showAddForm} onClick={onToggleAddForm}>
      <PlusOutlined aria-hidden />
      {showAddForm ? 'Скрыть форму' : 'Добавить тендер'}
    </button>
    <button type="button" className="tm-btn tm-btn--lg" onClick={onImport}>
      <UploadOutlined aria-hidden />
      Импорт из Excel
    </button>
  </div>
);
