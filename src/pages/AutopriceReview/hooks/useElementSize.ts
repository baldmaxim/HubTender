import { useEffect, useRef, useState } from 'react';

export interface IElementSize {
  width: number;
  height: number;
}

/** Размер элемента через ResizeObserver (для высоты/ширины виртуальной таблицы). */
export const useElementSize = <T extends HTMLElement>() => {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<IElementSize>({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const apply = () => {
      const next = { width: Math.round(el.clientWidth), height: Math.round(el.clientHeight) };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
};
