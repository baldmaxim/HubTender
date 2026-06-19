import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Подбирает масштаб, при котором натуральный размер контента (innerRef) целиком
 * вписывается в доступную область (outerRef): scale = min(availW/natW, availH/natH, 1).
 * Меряет через ResizeObserver — device-agnostic, как AutoFitText.
 *
 * Важно: transform на innerRef не меняет его собственный scrollWidth/scrollHeight,
 * поэтому замер натурального размера стабилен и не образует Resize-петлю
 * (внешний узел держит overflow:hidden и фиксированный inset).
 */
export function useFitScale() {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

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
      const next = Math.min(availW / natW, availH / natH, 1);
      setScale(next > 0 ? next : 1);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  return { outerRef, innerRef, scale };
}
