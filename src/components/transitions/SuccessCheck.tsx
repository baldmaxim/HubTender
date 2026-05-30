import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';

interface SuccessCheckProps {
  /** When true the check animates in (fade + rotate + blur + Y-bob + stroke-draw). */
  show: boolean;
  /** Box size in px (square). Default 48. */
  size?: number;
  /** Stroke color. Default inherits currentColor. */
  color?: string;
  strokeWidth?: number;
  className?: string;
}

/**
 * transitions.dev "Success check" (recipe 10) adapted for React.
 *
 * Confirms a completed action. The stroke length is measured at runtime via
 * getTotalLength() and applied inline (the recipe's "dynamic" calibration), so the
 * checkmark draws cleanly regardless of size. Appear-only — mount it at the success
 * moment and unmount to hide. Respects prefers-reduced-motion (renders instantly).
 */
export function SuccessCheck({ show, size = 48, color, strokeWidth = 4, className }: SuccessCheckProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const reduced = useReducedMotion();
  const [state, setState] = useState<'in' | 'out'>('out');

  useEffect(() => {
    const path = pathRef.current;
    if (path) {
      const len = Math.ceil(path.getTotalLength());
      path.style.strokeDasharray = String(len);
      // Hidden (offset = len) only when we're about to animate; otherwise fully drawn.
      path.style.strokeDashoffset = show && !reduced ? String(len) : '0';
    }
    setState(show ? 'in' : 'out');
  }, [show, reduced]);

  return (
    <span
      className={`t-success-check${className ? ` ${className}` : ''}`}
      data-state={state}
      aria-hidden="true"
      style={{ width: size, height: size, color }}
    >
      <svg viewBox="0 0 48 48" width={size} height={size} fill="none">
        <path
          ref={pathRef}
          d="M14 24.5 L21 31.5 L34 16.5"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export default SuccessCheck;
