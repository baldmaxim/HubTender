import { createContext, useContext, type KeyboardEvent } from 'react';

// Режим выбора тендеров для удаления: строки списка, карточки и карточки канбана
// читают его из контекста, чтобы не протаскивать проп через таблицу и доску.

export interface ITenderSelection {
  active: boolean;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
}

const INACTIVE: ITenderSelection = {
  active: false,
  isSelected: () => false,
  toggle: () => undefined,
};

export const TenderSelectionContext = createContext<ITenderSelection>(INACTIVE);

export const useTenderSelection = (): ITenderSelection => useContext(TenderSelectionContext);

/** Элемент в режиме выбора — флажок: клик, Пробел или Enter отмечают тендер. */
export function getSelectableProps(selection: ITenderSelection, id: string) {
  return {
    role: 'checkbox' as const,
    'aria-checked': selection.isSelected(id),
    tabIndex: 0,
    onClick: () => selection.toggle(id),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        selection.toggle(id);
      }
    },
  };
}

export const selectableClassName = (selected: boolean): string =>
  selected ? 'tm-select-item tm-select-item--selected' : 'tm-select-item';
