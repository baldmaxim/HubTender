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
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    if (!enabled) {
      setFontSize(baseFontSize);
      setScale(1);
      return;
    }
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const fit = () => {
      const available = outer.clientWidth;
      if (available <= 0) return;

      // 1) Наибольший размер сначала; шаг вниз по 1px с перемером —
      //    корректно учитывает постоянные отступы разделителей. Рендер чёткий.
      inner.style.transform = 'none';
      let nextSize = minFontSize;
      for (let size = baseFontSize; size >= minFontSize; size--) {
        inner.style.fontSize = `${size}px`;
        if (inner.scrollWidth <= available) {
          nextSize = size;
          break;
        }
      }
      inner.style.fontSize = `${nextSize}px`;

      // 2) Если даже на минимальном шрифте не влезло — дожимаем масштабом,
      //    чтобы гарантированно не обрезать (transform не влияет на scrollWidth).
      const overflow = inner.scrollWidth;
      const nextScale = overflow > available ? Math.max(0.1, available / overflow) : 1;
      inner.style.transform = nextScale < 1 ? `scale(${nextScale})` : 'none';

      setFontSize((prev) => (prev === nextSize ? prev : nextSize)); // no-op если стабильно
      setScale((prev) => (prev === nextScale ? prev : nextScale));
    };

    // Наблюдаем outer всегда (а не после успешного fit) — иначе при первом замере
    // с clientWidth === 0 наблюдатель не подключался бы и строка осталась бы на base.
    // RO следит за outer; записи в inner.style его не дёргают, setState защищён prev===next.
    const ro = new ResizeObserver(fit);
    ro.observe(outer);
    fit();
    return () => ro.disconnect();
  }, [enabled, baseFontSize, minFontSize, children]);

  if (!enabled) {
    return <div style={{ fontSize: baseFontSize, ...style }}>{children}</div>;
  }

  return (
    <div ref={outerRef} style={{ overflow: 'hidden', ...style }}>
      <div
        ref={innerRef}
        style={{
          display: 'inline-block',
          whiteSpace: 'nowrap',
          fontSize,
          transform: scale < 1 ? `scale(${scale})` : undefined,
          transformOrigin: 'right center',
        }}
      >
        {children}
      </div>
    </div>
  );
};
