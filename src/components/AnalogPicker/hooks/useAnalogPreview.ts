import { useCallback, useRef, useState } from 'react';
import { analogErrorCode, analogErrorMessage, applyAnalog, previewAnalog } from '../../../lib/api/analogs';
import type {
  AnalogScaleMode,
  IAnalogApplyResult,
  IAnalogHit,
  IAnalogPreview,
  IAnalogRequest,
  IAnalogTarget,
} from '../../../lib/api/analogs.types';
import { buildScale, canVolumeRatio, newIdempotencyKey } from '../utils/analogFormat';

export interface IAnalogNotice {
  type: 'error' | 'warning';
  text: string;
  /** Показать кнопку «Открыть состав позиции». */
  openItems?: boolean;
}

interface IPreviewState {
  data: IAnalogPreview;
  /** Ключ идемпотентности: один на предпросмотр. */
  key: string;
}

const NOTICE_BY_CODE: Record<string, Omit<IAnalogNotice, 'type'> & { type?: IAnalogNotice['type'] }> = {
  ANALOG_STALE: { type: 'warning', text: 'Источник или позиция изменились — обновите предпросмотр.' },
  ANALOG_TARGET_HAS_ROWS: {
    text: 'В позиции уже есть строки, не относящиеся к аналогу. Аналог применяется только к позиции без состава — откройте состав и очистите его, если он не нужен.',
    openItems: true,
  },
  ANALOG_TARGET_LOCKED: {
    text: 'Позиция подтверждена — сначала «Переоткрыть» в «Подтверждении авторасценки».',
  },
};

/**
 * Масштаб, цены, предпросмотр и применение выбранного аналога. Любая смена параметров сбрасывает предпросмотр.
 * Состояние живёт, пока смонтирован шаг: другой аналог — другой экземпляр (key).
 */
export const useAnalogPreview = (positionId: string, target: IAnalogTarget, hit: IAnalogHit) => {
  const [mode, setModeState] = useState<AnalogScaleMode | null>(() =>
    canVolumeRatio(target, hit) ? 'volume_ratio' : null,
  );
  const [factor, setFactorState] = useState<number | null>(null);
  const [copyPrices, setCopyPricesState] = useState(false);
  const [preview, setPreview] = useState<IPreviewState | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<IAnalogNotice | null>(null);
  const reqId = useRef(0);
  const applyingRef = useRef(false);

  const reset = useCallback(() => {
    reqId.current += 1; // ответ запроса, ушедшего до смены параметров, отбрасываем
    setPreview(null);
    setNotice(null);
    setLoading(false);
  }, []);

  const setMode = useCallback((m: AnalogScaleMode) => { setModeState(m); reset(); }, [reset]);
  const setFactor = useCallback((f: number | null) => { setFactorState(f); reset(); }, [reset]);
  const setCopyPrices = useCallback((v: boolean) => { setCopyPricesState(v); reset(); }, [reset]);

  const factorValid = factor !== null && Number.isFinite(factor) && factor > 0;
  const ready = mode !== null && (mode !== 'factor' || factorValid);

  const buildRequest = useCallback((): IAnalogRequest | null => {
    if (mode === null || (mode === 'factor' && !factorValid)) return null;
    return { source_position_id: hit.position_id, scale: buildScale(mode, factor), copy_prices: copyPrices };
  }, [mode, factor, factorValid, hit.position_id, copyPrices]);

  const runPreview = useCallback(async () => {
    const request = buildRequest();
    if (!request) return;
    const id = ++reqId.current;
    setLoading(true);
    setNotice(null);
    try {
      const data = await previewAnalog(positionId, request);
      if (id === reqId.current) setPreview({ data, key: newIdempotencyKey() });
    } catch (e) {
      if (id !== reqId.current) return;
      setPreview(null);
      setNotice({ type: 'error', text: analogErrorMessage(e) });
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [buildRequest, positionId]);

  /** Применяет аналог; null — не получилось (причина в notice). */
  const runApply = useCallback(async (): Promise<IAnalogApplyResult | null> => {
    const request = buildRequest();
    if (!request || !preview || !preview.data.can_apply || applyingRef.current) return null;
    applyingRef.current = true;
    setApplying(true);
    setNotice(null);
    try {
      return await applyAnalog(positionId, {
        ...request,
        preview_token: preview.data.preview_token,
        idempotency_key: preview.key,
      });
    } catch (e) {
      const code = analogErrorCode(e);
      const known = code ? NOTICE_BY_CODE[code] : undefined;
      if (code === 'ANALOG_STALE') setPreview(null);
      setNotice(known ? { type: known.type ?? 'error', text: known.text, openItems: known.openItems } : { type: 'error', text: analogErrorMessage(e) });
      return null;
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }, [buildRequest, preview, positionId]);

  return {
    mode,
    factor,
    copyPrices,
    setMode,
    setFactor,
    setCopyPrices,
    ready,
    preview: preview?.data ?? null,
    loading,
    applying,
    notice,
    runPreview,
    runApply,
  };
};
