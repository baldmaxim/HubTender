import type { HTMLAttributes } from 'react';

/** Свойства для column.onHeaderCell: width/onResize читает ResizableHeaderCell (в типах antd их нет). */
export const resizableHeaderProps = (width: number, onResize: (width: number) => void): HTMLAttributes<HTMLElement> =>
  ({ width, onResize }) as HTMLAttributes<HTMLElement>;
