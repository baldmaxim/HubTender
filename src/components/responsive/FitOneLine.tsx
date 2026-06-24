import React, { useLayoutEffect, useRef, useState } from 'react';

interface FitOneLineProps {
  /** Включать авто-подгонку шрифта (например, только на телефоне в портрете). */
  enabled?: boolean;
  /** Базовый размер шрифта в px (исходный, к которому стремимся). */
  baseFontSize?: number;
  /** Минимально допустимый размер шрифта в px. */
  minFontSize?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * Ужимает содержимое в одну строку, авто-уменьшая размер шрифта, пока оно не влезет
 * по ширине контейнера. При enabled=false ведёт себя как обычный div с baseFontSize
 * (перенос строк как раньше). Используется в шапке «Позиции Заказчика» на телефоне.
 */
export const FitOneLine: React.FC<FitOneLineProps> = ({
  enabled = true,
  baseFontSize = 14,
  minFontSize = 9,
  style,
  children,
}) => {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(baseFontSize);

  useLayoutEffect(() => {
    if (!enabled) {
      setFontSize(baseFontSize);
      return;
    }
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const fit = () => {
      const available = outer.clientWidth;
      if (available <= 0) return;

      // На время наших правок fontSize отключаем наблюдатель,
      // чтобы собственные записи не зациклили fit().
      ro.disconnect();

      // Наибольший размер сначала; шаг вниз по 1px с перемером —
      // корректно учитывает постоянные отступы разделителей.
      let next = minFontSize;
      for (let size = baseFontSize; size >= minFontSize; size--) {
        inner.style.fontSize = `${size}px`;
        if (inner.scrollWidth <= available) {
          next = size;
          break;
        }
      }

      inner.style.fontSize = `${next}px`;
      setFontSize((prev) => (prev === next ? prev : next)); // no-op если стабильно

      ro.observe(outer);
    };

    const ro = new ResizeObserver(fit);
    fit();
    return () => ro.disconnect();
  }, [enabled, baseFontSize, minFontSize, children]);

  if (!enabled) {
    return <div style={{ fontSize: baseFontSize, ...style }}>{children}</div>;
  }

  return (
    <div ref={outerRef} style={{ overflow: 'hidden', ...style }}>
      <div ref={innerRef} style={{ display: 'inline-block', whiteSpace: 'nowrap', fontSize }}>
        {children}
      </div>
    </div>
  );
};
