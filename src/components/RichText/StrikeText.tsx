import React from 'react';
import type { StrikeRun } from '../../lib/types/types/boq';

// Рендер зачёркивания из Excel как React-узлов.
// XSS-безопасно by design: строим <s>/фрагменты сами, без dangerouslySetInnerHTML.

/**
 * Отрендерить раны зачёркивания. Если ранов нет — вернуть fallback (обычный текст).
 * Зачёркнутые фрагменты оборачиваются в <s>, остальные — как есть.
 */
export function renderStrikeRuns(
  runs: StrikeRun[] | null | undefined,
  fallback: React.ReactNode,
): React.ReactNode {
  if (!runs || runs.length === 0) return fallback;
  return runs.map((r, i) =>
    r.s ? <s key={i}>{r.t}</s> : <React.Fragment key={i}>{r.t}</React.Fragment>,
  );
}

/** Обернуть узел в <s>, если struck. Для целиком зачёркнутого числа (кол-во). */
export function renderStruck(
  struck: boolean | null | undefined,
  node: React.ReactNode,
): React.ReactNode {
  return struck ? <s>{node}</s> : node;
}
