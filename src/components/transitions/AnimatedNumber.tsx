import React from 'react';
import { useReducedMotion } from './useReducedMotion';

interface AnimatedNumberProps {
  /** Already-formatted display string, e.g. "1 234 567,89 ₽". */
  value: string;
  className?: string;
  /** Optional title/tooltip passthrough. */
  title?: string;
}

/**
 * transitions.dev "Number pop-in" (recipe 02) adapted for React.
 *
 * Each character re-enters with a blurred slide; the last two characters stagger.
 * Replay-on-change is driven by remounting the digit group via `key={value}` instead
 * of the vanilla force-reflow trick — when the formatted value changes, React mounts a
 * fresh group and the CSS animation plays once.
 *
 * Respects prefers-reduced-motion (renders plain text, no animation).
 *
 * USE ONLY for single headline/total figures — never inside virtualized table rows.
 */
export function AnimatedNumber({ value, className, title }: AnimatedNumberProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return <span className={className} title={title}>{value}</span>;
  }

  const chars = Array.from(value);
  const lastIdx = chars.length - 1;

  return (
    <span
      key={value}
      className={`t-digit-group is-animating${className ? ` ${className}` : ''}`}
      title={title}
    >
      {chars.map((ch, i) => {
        const stagger = i === lastIdx - 1 ? 1 : i === lastIdx ? 2 : undefined;
        return (
          <span className="t-digit" data-stagger={stagger} key={i}>
            {ch === ' ' ? ' ' : ch}
          </span>
        );
      })}
    </span>
  );
}

export default AnimatedNumber;
