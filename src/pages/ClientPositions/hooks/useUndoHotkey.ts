import { useEffect, useRef } from 'react';

/**
 * Глобальный Ctrl/Cmd+Z, вызывающий переданный диспетчер отмены.
 * Диспетчер держим в ref, чтобы слушатель keydown вешался один раз и был стабильным,
 * но всегда вызывал свежую версию колбэка. Если диспетчер вернул true — отменяем
 * нативный undo (preventDefault). В полях ввода (INPUT/TEXTAREA/contentEditable)
 * не перехватываем, чтобы не ломать текстовый undo.
 */
export function useUndoHotkey(dispatch: () => boolean): void {
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // e.code (физическая клавиша) — устойчиво к раскладке (RU/EN), в отличие от e.key.
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.code !== 'KeyZ') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (dispatchRef.current()) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
