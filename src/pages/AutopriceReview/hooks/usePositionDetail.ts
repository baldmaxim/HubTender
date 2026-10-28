import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from 'antd';
import {
  autopriceErrorMessage,
  fetchAutopricePosition,
  patchAutopriceReview,
  postAutopriceAction,
} from '../../../lib/api/autoprice';
import type { AutopriceAction, IPositionDetail, IReviewPatch } from '../types';

/** Детали позиции выбранного прогона: загрузка, сохранение ревью, действия. */
export const usePositionDetail = (
  sessionId: string | null,
  positionId: string | null,
  onChanged: () => void,
) => {
  const { message } = App.useApp();
  const [detail, setDetail] = useState<IPositionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);

  const load = useCallback(async () => {
    if (!sessionId || !positionId) {
      setDetail(null);
      return;
    }
    const id = ++req.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAutopricePosition(sessionId, positionId);
      if (id === req.current) setDetail(res);
    } catch (e) {
      if (id === req.current) {
        setDetail(null);
        setError(autopriceErrorMessage(e));
      }
    } finally {
      if (id === req.current) setLoading(false);
    }
  }, [sessionId, positionId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Выполняет мутацию, обновляет карточку и список; ошибка бэкенда показывается как есть. */
  const run = useCallback(
    async (fn: () => Promise<unknown>, okText: string): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        message.success(okText);
        await load();
        onChanged();
        return true;
      } catch (e) {
        message.error(autopriceErrorMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, onChanged, message],
  );

  const save = useCallback(
    (patch: IReviewPatch) =>
      sessionId && positionId
        ? run(() => patchAutopriceReview(sessionId, positionId, patch), 'Сохранено')
        : Promise.resolve(false),
    [sessionId, positionId, run],
  );

  const act = useCallback(
    (action: AutopriceAction, okText: string, comment?: string) =>
      sessionId && positionId
        ? run(() => postAutopriceAction(sessionId, positionId, action, comment), okText)
        : Promise.resolve(false),
    [sessionId, positionId, run],
  );

  return { detail, loading, busy, error, save, act };
};
