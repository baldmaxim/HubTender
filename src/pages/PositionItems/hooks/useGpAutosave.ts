import { useCallback, useEffect, useRef, useState } from 'react';

/** Пауза набора, после которой уходит PATCH. */
const AUTOSAVE_DEBOUNCE_MS = 700;

interface UseGpAutosaveProps {
  /** Серверные значения (useBoqItems перезаписывает их на каждом WS-событии). */
  gpVolume: number;
  setGpVolume: (v: number) => void;
  gpNote: string;
  setGpNote: (v: string) => void;
  onSaveGPData: (volume: number, note: string, opts?: { refetch?: boolean }) => Promise<void>;
}

export interface GpAutosave {
  volume: number;
  note: string;
  setVolume: (v: number) => void;
  setNote: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}

/**
 * Автосохранение Кол-ва ГП и Примечания ГП на телефоне.
 *
 * ВЫЗЫВАТЬ РОВНО ОДИН РАЗ (в PositionItems): в ландшафте PositionHeader остаётся
 * смонтированным под оверлеем, поэтому хук внутри GpInlineFields дал бы два
 * экземпляра — два debounce-таймера и два конкурирующих PATCH, причём скрытый
 * держал бы протухший драфт.
 *
 * Драфт локальный и уходит в PATCH напрямую: fetchPositionData по WS-событию
 * безусловно перезаписывает gpVolume/gpNote, и таймер, сработавший после такого
 * сброса, записал бы старое серверное значение поверх набранного.
 */
export const useGpAutosave = ({
  gpVolume,
  setGpVolume,
  gpNote,
  setGpNote,
  onSaveGPData,
}: UseGpAutosaveProps): GpAutosave => {
  const [volume, setVolumeState] = useState<number>(gpVolume);
  const [note, setNoteState] = useState<string>(gpNote);

  const dirtyRef = useRef(false);
  const focusedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  // Драфт в ref: flush из таймера/cleanup читает актуальное, а не замыкание.
  const draftRef = useRef({ volume: gpVolume, note: gpNote });

  // Ресинк с сервера — только когда пользователь не правит поле прямо сейчас.
  useEffect(() => {
    if (dirtyRef.current || focusedRef.current) return;
    setVolumeState(gpVolume);
    setNoteState(gpNote);
    draftRef.current = { volume: gpVolume, note: gpNote };
  }, [gpVolume, gpNote]);

  // Колбэк сохранения пересоздаётся на каждом рендере PositionItems — держим его
  // в ref, иначе flush менял бы identity и cleanup-эффект ниже срабатывал бы на
  // КАЖДОМ рендере, отправляя PATCH.
  const saveRef = useRef(onSaveGPData);
  saveRef.current = onSaveGPData;

  const flush = useCallback(async () => {
    if (!dirtyRef.current) return;
    if (savingRef.current) {
      // Пока летит предыдущий PATCH — запомним, что нужен ещё один.
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    dirtyRef.current = false;
    try {
      const { volume: v, note: n } = draftRef.current;
      // refetch: false — рефетч позиции на каждый debounce гонялся бы с набором.
      await saveRef.current(v, n, { refetch: false });
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        dirtyRef.current = true;
        void flush();
      }
    }
  }, []);

  const arm = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [flush]);

  // Уход со страницы/поворот — дописываем набранное, а не теряем. Deps пустые:
  // flush стабилен, иначе это был бы flush на каждый рендер.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void flush();
    },
    [flush],
  );

  const setVolume = useCallback(
    (v: number) => {
      dirtyRef.current = true;
      setVolumeState(v);
      draftRef.current = { ...draftRef.current, volume: v };
      // Родительский стейт держим живым: gpVolume нужен листу (отвязка материала).
      setGpVolume(v);
      arm();
    },
    [arm, setGpVolume],
  );

  const setNote = useCallback(
    (v: string) => {
      dirtyRef.current = true;
      setNoteState(v);
      draftRef.current = { ...draftRef.current, note: v };
      setGpNote(v);
      arm();
    },
    [arm, setGpNote],
  );

  const onFocus = useCallback(() => {
    focusedRef.current = true;
  }, []);

  const onBlur = useCallback(() => {
    focusedRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void flush();
  }, [flush]);

  return { volume, note, setVolume, setNote, onFocus, onBlur };
};
