import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Подбирает масштаб, при котором натуральный размер контента (innerRef) вписывается
 * в доступную область (outerRef). По умолчанию (axis='both') — целиком:
 * scale = min(availW/natW, availH/natH, 1). При axis='width' — только по ширине:
 * scale = min(availW/natW, 1) (высоту игнорируем, контент скроллится по вертикали).
 * Меряет через ResizeObserver — device-agnostic, как AutoFitText.
 *
 * Важно: transform на innerRef не меняет его собственный scrollWidth/scrollHeight,
 * поэтому замер натурального размера стабилен и не образует Resize-петлю
 * (внешний узел держит overflow:hidden и фиксированный inset).
 *
 * Возвращает также натуральные размеры (natW/natH) — нужны вызывающему, чтобы
 * задать размер scaled-обёртки и получить корректную протяжённость скролла.
 */
export function useFitScale(axis: 'both' | 'width' = 'both') {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [nat, setNat] = useState({ natW: 0, natH: 0 });

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const fit = () => {
      const natW = inner.scrollWidth;
      const natH = inner.scrollHeight;
      const availW = outer.clientWidth;
      const availH = outer.clientHeight;
      if (!natW || !natH || !availW || !availH) return;
      const next =
        axis === 'width'
          ? Math.min(availW / natW, 1)
          : Math.min(availW / natW, availH / natH, 1);
      setScale(next > 0 ? next : 1);
      setNat((prev) => (prev.natW === natW && prev.natH === natH ? prev : { natW, natH }));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(outer);
    ro.observe(inner);
    // Поворот экрана иногда «доносит» финальную раскладку на кадр позже, чем
    // срабатывает ResizeObserver, — пересчитываем масштаб ещё и по событиям окна.
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
    };
  }, [axis]);

  return { outerRef, innerRef, scale, natW: nat.natW, natH: nat.natH };
}
