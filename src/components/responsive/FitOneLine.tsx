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
      // Измеряем естественную ширину при базовом шрифте, затем масштабируем.
      inner.style.fontSize = `${baseFontSize}px`;
      const available = outer.clientWidth;
      const needed = inner.scrollWidth;
      let next = baseFontSize;
      if (needed > available && needed > 0) {
        next = Math.max(minFontSize, Math.floor((baseFontSize * available) / needed));
      }
      inner.style.fontSize = `${next}px`;
      setFontSize(next);
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(outer);
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
