import { useState, useEffect } from 'react';
import { Grid } from 'antd';

const { useBreakpoint } = Grid;

/** Реактивная подписка на media-query через matchMedia. */
function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

/**
 * Реактивные флаги размера экрана поверх AntD Grid.useBreakpoint().
 * Брейкпоинты AntD: xs < 576, sm ≥ 576, md ≥ 768, lg ≥ 992.
 * - isPhone:  < 576  (iPhone 12 390, 15 Pro Max 430)
 * - isMobile: < 768  (телефоны)
 * - isTablet: 768..991 (iPad портрет = md, без lg)
 * - isLandscapePhone: телефон, повёрнутый горизонтально (ширина ≥576, но крошечная высота + touch).
 *   AntD ширина-брейкпоинты тут считают его планшетом/десктопом — этот флаг исправляет детекцию.
 * - isPhoneDevice: телефон в любой ориентации (isPhone || isLandscapePhone).
 */
export function useIsMobile() {
  const screens = useBreakpoint();
  const isLandscapePhone = useMatchMedia(
    '(orientation: landscape) and (max-height: 575px) and (pointer: coarse)',
  );
  const isPhone = !screens.sm;
  return {
    isPhone,
    isLandscapePhone,
    isPhoneDevice: isPhone || isLandscapePhone,
    isMobile: !screens.md,
    isTablet: !!screens.md && !screens.lg,
    screens,
  };
}
