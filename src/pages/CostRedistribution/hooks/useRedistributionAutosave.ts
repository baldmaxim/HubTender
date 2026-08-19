// Автосохранение правил перераспределения (rules-only команда на сервер).
//
// Зачем отдельный хук: это единственное место, которое само, без действия
// пользователя, выпускает save. Каждый save бампает financial_input_revision и
// снимает финансовое согласование тендера, поэтому условия «когда сохранять»
// собраны здесь целиком, а не размазаны по странице.
//
// - Debounce: даём пользователю ~800 мс «замереть» перед записью.
// - Mutex (isSavingRef): если save уже в полёте — ставим pendingSaveRef и после
//   завершения бампаем nonce, чтобы эффект перезапустил таймер со свежим
//   состоянием. Без этого rapid-fire правки давали бы гонку delete+insert и
//   риск «частичных» записей в cost_redistribution_results.

import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { RedistributionSnapshotStatus } from '../../../lib/api/redistributions';

const AUTOSAVE_DEBOUNCE_MS = 800;

export interface RedistributionAutosaveParams {
  /** Тендер и тактика выбраны. */
  enabled: boolean;
  /**
   * Количество загруженных BOQ-элементов. Пока их нет — сохранять нечего и
   * небезопасно (fxMissing тоже оставляет список пустым).
   *
   * КРИТИЧНО, что это значение — зависимость эффекта. При requires_recalculation
   * гидрация обнуляет локальные category-результаты, а BOQ грузится дольше
   * снимка: раньше эффект отрабатывал до прихода BOQ, выходил по этой проверке
   * и больше не перезапускался. Автопересчёт после правки «Процентов наценок» /
   * «Конструктора наценок» не происходил вовсе — он оживал только когда
   * пользователь вручную удалял и заново вводил правило «Между строками».
   */
  boqItemsCount: number;
  /** status последнего ответа сервера. */
  snapshotStatus?: RedistributionSnapshotStatus;
  /** Слепок ровно того набора правил, который уходит в save. */
  currentRulesSignature: string;
  /** Слепок правил, уже подтверждённых сервером (load / успешный save). */
  serverKnownRulesRef: MutableRefObject<string | null>;
  /** Сама rules-only команда сохранения. */
  save: () => Promise<void>;
}

export function useRedistributionAutosave({
  enabled,
  boqItemsCount,
  snapshotStatus,
  currentRulesSignature,
  serverKnownRulesRef,
  save,
}: RedistributionAutosaveParams): void {
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const [nonce, setNonce] = useState(0);

  // save читаем через ref: его идентичность меняется на каждую правку, но это
  // уже отражено в currentRulesSignature — в deps он не нужен.
  const saveRef = useRef(save);
  saveRef.current = save;
  const statusRef = useRef(snapshotStatus);
  statusRef.current = snapshotStatus;

  useEffect(() => {
    if (!enabled) return;
    if (boqItemsCount === 0) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      // Здоровый снимок + неизменные правила = сохранять нечего. Проверка
      // сделана в момент срабатывания таймера, а не при постановке: иначе она
      // зависела бы от порядка эффектов относительно гидрации, которая и
      // выставляет serverKnownRulesRef. Для requires_recalculation /
      // not_configured пересохранение НЕ подавляем: сервер не отдаёт годного
      // prepared, поэтому первый автосейв после загрузки — это и есть тот
      // «выполните пересчёт», о котором говорит алерт.
      if (
        statusRef.current === 'calculated' &&
        currentRulesSignature === serverKnownRulesRef.current
      ) {
        return;
      }
      if (isSavingRef.current) {
        pendingSaveRef.current = true;
        return;
      }
      isSavingRef.current = true;
      try {
        await saveRef.current();
      } finally {
        isSavingRef.current = false;
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          setNonce((n) => n + 1);
        }
      }
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    enabled,
    boqItemsCount,
    snapshotStatus,
    currentRulesSignature,
    serverKnownRulesRef,
    nonce,
  ]);
}
