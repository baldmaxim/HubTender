import { useRef } from 'react';
import type { TouchEvent } from 'react';

interface UseHorizontalSwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Минимальное горизонтальное смещение в px для срабатывания. */
  threshold?: number;
}

/**
 * Жест горизонтального свайпа для touch-устройств.
 * Срабатывает только если горизонталь доминирует над вертикалью (|dx| > |dy|)
 * и |dx| >= threshold — чтобы не перехватывать вертикальный скролл.
 */
export function useHorizontalSwipe({
  onSwipeLeft,
  onSwipeRight,
  threshold = 50,
}: UseHorizontalSwipeOptions) {
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    onTouchStart: (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        start.current = null;
        return;
      }
      start.current = { x: touch.clientX, y: touch.clientY };
    },
    onTouchEnd: (event: TouchEvent) => {
      const origin = start.current;
      start.current = null;
      if (!origin) {
        return;
      }

      const touch = event.changedTouches[0];
      if (!touch) {
        return;
      }

      const dx = touch.clientX - origin.x;
      const dy = touch.clientY - origin.y;

      if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) {
        return;
      }

      if (dx < 0) {
        onSwipeLeft?.();
      } else {
        onSwipeRight?.();
      }
    },
  };
}

export default useHorizontalSwipe;
