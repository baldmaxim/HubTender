import React, { useRef, useState } from 'react';
import { Tooltip } from 'antd';

interface IClampedTextProps {
  /** Полный текст для тултипа */
  title: React.ReactNode;
  /** Сколько строк показывать до троеточия */
  rows: number;
  isDark: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * Текст, обрезанный троеточием после `rows` строк, — длинный текст не раздувает высоту строки.
 * Полный текст — тултипом при наведении и только если текст действительно обрезан
 * (замер в момент наведения, а не на каждом рендере строк виртуальной таблицы).
 */
export const ClampedText: React.FC<IClampedTextProps> = ({ title, rows, isDark, style, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const handleOpenChange = (next: boolean) => {
    const el = ref.current;
    setOpen(next && !!el && el.scrollHeight > el.clientHeight);
  };

  return (
    <Tooltip
      title={title}
      open={open}
      onOpenChange={handleOpenChange}
      color={isDark ? '#1f2937' : '#ffffff'}
      styles={{ root: { maxWidth: 480 }, body: { color: isDark ? '#e5e7eb' : '#111827' } }}
    >
      <div
        ref={ref}
        style={{ display: '-webkit-box', WebkitLineClamp: rows, WebkitBoxOrient: 'vertical', overflow: 'hidden', ...style }}
      >
        {children}
      </div>
    </Tooltip>
  );
};
