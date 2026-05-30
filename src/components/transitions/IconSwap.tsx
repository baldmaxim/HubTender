import React from 'react';

interface IconSwapProps {
  /** Which icon is currently shown. */
  state: 'a' | 'b';
  iconA: React.ReactNode;
  iconB: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * transitions.dev "Icon swap" (recipe 09). Both icons stay stacked in one grid cell;
 * the active one cross-fades in while the other fades out with blur + scale.
 * Pure CSS — the recipe's @media (prefers-reduced-motion) guard handles accessibility.
 */
export function IconSwap({ state, iconA, iconB, className, style }: IconSwapProps) {
  return (
    <span className={`t-icon-swap${className ? ` ${className}` : ''}`} data-state={state} style={style}>
      <span className="t-icon" data-icon="a">{iconA}</span>
      <span className="t-icon" data-icon="b">{iconB}</span>
    </span>
  );
}

export default IconSwap;
