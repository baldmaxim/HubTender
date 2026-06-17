import { useLayoutEffect, useRef, useState } from 'react';

interface AutoFitTextProps {
  children: React.ReactNode;
  /** Потолок размера шрифта (десктоп) */
  maxFontSize?: number;
  /** Пол размера шрифта (узкие экраны) */
  minFontSize?: number;
  align?: 'left' | 'right' | 'center';
  strong?: boolean;
  color?: string;
}

/**
 * Подбирает максимально крупный размер шрифта в диапазоне [minFontSize, maxFontSize],
 * при котором текст помещается в одну строку без переноса. Меряет реальную ширину
 * контейнера через ResizeObserver — решение device-agnostic.
 */
export function AutoFitText({
  children,
  maxFontSize = 14,
  minFontSize = 7,
  align = 'right',
  strong,
  color,
}: AutoFitTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;
    const fit = () => {
      let size = maxFontSize;
      text.style.fontSize = `${size}px`;
      while (size > minFontSize && text.scrollWidth > container.clientWidth) {
        size -= 0.5;
        text.style.fontSize = `${size}px`;
      }
      setFontSize(size);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => ro.disconnect();
  }, [children, maxFontSize, minFontSize]);

  return (
    <div ref={containerRef} style={{ width: '100%', overflow: 'hidden', textAlign: align }}>
      <span
        ref={textRef}
        style={{
          whiteSpace: 'nowrap',
          fontSize,
          display: 'inline-block',
          fontWeight: strong ? 600 : undefined,
          color,
        }}
      >
        {children}
      </span>
    </div>
  );
}
