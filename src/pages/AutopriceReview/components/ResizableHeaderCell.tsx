import { useCallback, useEffect, useRef, type FC, type PointerEvent, type ThHTMLAttributes } from 'react';
import { MIN_COLUMN_WIDTH } from '../hooks/useColumnWidths';
import styles from '../AutopriceReview.module.css';

interface IResizableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** Текущая ширина колонки; без width/onResize ячейка обычная. */
  width?: number;
  onResize?: (width: number) => void;
}

interface IDragState {
  startX: number;
  startWidth: number;
}

/** Ячейка заголовка antd Table с ручкой изменения ширины на правом краю. */
export const ResizableHeaderCell: FC<IResizableHeaderCellProps> = ({ width, onResize, children, ...rest }) => {
  const drag = useRef<IDragState | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<number>(0);

  const flush = useCallback(() => {
    frame.current = null;
    onResize?.(pending.current);
  }, [onResize]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const handleDown = (e: PointerEvent<HTMLSpanElement>) => {
    if (width === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width };
  };

  const handleMove = (e: PointerEvent<HTMLSpanElement>) => {
    const d = drag.current;
    if (!d) return;
    pending.current = Math.max(MIN_COLUMN_WIDTH, Math.round(d.startWidth + e.clientX - d.startX));
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  };

  const handleUp = (e: PointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      flush();
    }
  };

  if (width === undefined || !onResize) return <th {...rest}>{children}</th>;

  return (
    <th {...rest}>
      {children}
      <span
        className={styles.resizeHandle}
        aria-hidden="true"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onClick={(e) => e.stopPropagation()}
      />
    </th>
  );
};
