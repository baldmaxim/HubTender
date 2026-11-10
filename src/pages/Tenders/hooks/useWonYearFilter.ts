import { useCallback, useState } from 'react';

export type TWonYearFilter = 'all' | 'current_year';

const WON_FILTER_STORAGE_KEY = 'tenderHub_tendersWonFilter';

const readWonFilter = (): TWonYearFilter => {
  try {
    return localStorage.getItem(WON_FILTER_STORAGE_KEY) === 'current_year' ? 'current_year' : 'all';
  } catch {
    return 'all';
  }
};

/** Фильтр «Выиграли: Все | текущий год»; выбор хранится в localStorage. */
export const useWonYearFilter = (): [TWonYearFilter, (value: TWonYearFilter) => void] => {
  const [filter, setFilterState] = useState<TWonYearFilter>(readWonFilter);

  const setFilter = useCallback((value: TWonYearFilter) => {
    try {
      localStorage.setItem(WON_FILTER_STORAGE_KEY, value);
    } catch {
      // приватный режим — выбор живёт до перезагрузки
    }
    setFilterState(value);
  }, []);

  return [filter, setFilter];
};
