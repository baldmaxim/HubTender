import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from './useReducedMotion';

interface ShakeOnErrorProps {
  /** Increment (or change) this to replay the shake. Mount value never shakes. */
  trigger: number;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** Read the total shake duration (2*A + 2*B) from CSS vars, with a 280ms fallback. */
function readShakeMs(): number {
  if (typeof window === 'undefined') return 280;
  const cs = getComputedStyle(document.documentElement);
  const num = (name: string, fb: number) => {
    const v = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(v) ? v : fb;
  };
  return num('--shake-dur-a', 80) * 2 + num('--shake-dur-b', 60) * 2;
}

/**
 * transitions.dev "Error state shake" (recipe 12) adapted for React.
 *
 * Wraps any content (a form, a field, a card) and replays a percussive left/right
 * shake whenever `trigger` changes — e.g. a counter you bump on a failed submit.
 * This wrapper owns only the shake tween (recipe's `.t-input.is-shaking`); it does
 * NOT manage error borders/messages, so it composes cleanly on top of antd forms.
 *
 * Respects prefers-reduced-motion (no-op).
 */
export function ShakeOnError({ trigger, children, className, style }: ShakeOnErrorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const prevTrigger = useRef(trigger);

  useEffect(() => {
    if (trigger === prevTrigger.current) return;
    prevTrigger.current = trigger;
    if (reduced) return;
    const el = ref.current;
    if (!el) return;

    el.classList.remove('is-shaking');
    void el.offsetWidth; // force reflow so the keyframes restart from 0
    el.classList.add('is-shaking');

    const timer = window.setTimeout(() => el.classList.remove('is-shaking'), readShakeMs() + 40);
    return () => window.clearTimeout(timer);
  }, [trigger, reduced]);

  return (
    <div ref={ref} className={`t-input${className ? ` ${className}` : ''}`} style={style}>
      {children}
    </div>
  );
}

export default ShakeOnError;
