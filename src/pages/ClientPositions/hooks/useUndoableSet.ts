import { useCallback, useRef, useState } from 'react';

/**
 * Управляет набором id (`Set<string>`) с историей шагов для отмены (Ctrl+Z).
 *
 * - `apply(updater)` — записать текущий набор в историю и применить изменение
 *   (использовать в toggle-обработчиках выбора строк). Один вызов = один шаг отмены,
 *   поэтому иерархический клик (раздел + потомки) откатывается целиком.
 * - `reset(next)` — задать новый baseline и очистить историю (вход в режим отбора,
 *   отмена/подтверждение режима, внешняя синхронизация). В историю НЕ попадает.
 * - `undo()` — вернуть предыдущий снимок; возвращает true, если шаг был отменён.
 * - `canUndo()` — есть ли что отменять.
 *
 * Глубина истории не ограничена: отменять можно все клики до состояния на входе
 * в режим. Снимок — ссылка на прежний `Set` (toggle создаёт новый Set, прежний
 * не мутируется), память ничтожна.
 */
export interface UndoableSet {
  value: Set<string>;
  apply: (updater: (prev: Set<string>) => Set<string>) => void;
  reset: (next?: Set<string>) => void;
  undo: () => boolean;
  canUndo: () => boolean;
}

export function useUndoableSet(): UndoableSet {
  const [value, setValue] = useState<Set<string>>(new Set());
  const history = useRef<Set<string>[]>([]);

  const apply = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    setValue((prev) => {
      history.current.push(prev);
      return updater(prev);
    });
  }, []);

  const reset = useCallback((next: Set<string> = new Set()) => {
    history.current = [];
    setValue(next);
  }, []);

  const undo = useCallback((): boolean => {
    if (history.current.length === 0) return false;
    const snapshot = history.current.pop()!;
    setValue(snapshot);
    return true;
  }, []);

  const canUndo = useCallback(() => history.current.length > 0, []);

  return { value, apply, reset, undo, canUndo };
}
