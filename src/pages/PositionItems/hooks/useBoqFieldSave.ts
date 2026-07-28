import { useCallback, useEffect, useRef, useState } from 'react';
import { buildFieldPatch } from '../utils/boqFieldPatch';
import type { BoqItemFieldPatch } from '../utils/boqFieldPatch';
import { toPatchCtx } from '../components/mobile/sheetFieldTypes';
import type { FieldState, SheetCtx, SheetField } from '../components/mobile/sheetFieldTypes';
import { getErrorMessage } from '../../../utils/errors';

/** Сколько держится зелёная галка после успешного сохранения поля. */
const SAVED_BADGE_MS = 1500;

/** ETag-ретраи исчерпаны (boq.ts бросает англоязычный текст) → говорим по-русски. */
const mapError = (error: unknown): string => {
  const raw = getErrorMessage(error);
  if (raw.includes('modified concurrently')) {
    return 'Элемент изменён другим пользователем. Закройте окно и обновите страницу.';
  }
  return raw;
};

interface UseBoqFieldSaveProps {
  itemId: string | null;
  onFieldSave: (
    itemId: string,
    patch: BoqItemFieldPatch,
    opts: { recomputeWorkId?: string },
  ) => Promise<void>;
}

/**
 * Пофайловое редактирование в листе: ровно ОДИН активный редактор
 * (`editingKey`), поэтому две параллельные PATCH-гонки исключены конструктивно,
 * а не ретраями. Ошибку сохранения не глотаем — поле остаётся в режиме
 * редактирования с введённым значением, чтобы ввод не пропал.
 */
export const useBoqFieldSave = ({ itemId, onFieldSave }: UseBoqFieldSaveProps) => {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [justSavedKey, setJustSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSavedTimer = () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = null;
  };
  useEffect(() => clearSavedTimer, []);

  // Открыли другую запись — состояние редактора не переносим.
  useEffect(() => {
    setEditingKey(null);
    setSavingKey(null);
    setJustSavedKey(null);
    setError(null);
    clearSavedTimer();
  }, [itemId]);

  const start = useCallback((key: string) => {
    setEditingKey(key);
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    setEditingKey(null);
    setError(null);
  }, []);

  const commit = useCallback(
    async (field: SheetField, draft: unknown, ctx: SheetCtx) => {
      if (!field.editKey || !itemId) return;

      const built = buildFieldPatch(field.editKey, draft, toPatchCtx(ctx));
      if (!built.ok) {
        setError(built.error);
        return;
      }

      setSavingKey(field.key);
      setError(null);
      try {
        await onFieldSave(itemId, built.patch, { recomputeWorkId: built.recomputeWorkId });
        setEditingKey(null);
        setJustSavedKey(field.key);
        clearSavedTimer();
        savedTimer.current = setTimeout(() => setJustSavedKey(null), SAVED_BADGE_MS);
      } catch (e) {
        setError(mapError(e));
      } finally {
        setSavingKey(null);
      }
    },
    [itemId, onFieldSave],
  );

  const stateOf = useCallback(
    (key: string): FieldState => {
      if (savingKey === key) return 'saving';
      if (editingKey === key) return 'editing';
      if (justSavedKey === key) return 'saved';
      return 'idle';
    },
    [savingKey, editingKey, justSavedKey],
  );

  return { editingKey, savingKey, error, start, cancel, commit, stateOf };
};
