import { useState, useEffect } from 'react';
import { Grid } from 'antd';

const { useBreakpoint } = Grid;

/** Реактивная короткая сторона вьюпорта + признак ландшафта. */
function useViewport() {
  const read = () => ({
    short: Math.min(window.innerWidth, window.innerHeight),
    landscape: window.innerWidth > window.innerHeight,
  });
  const [vp, setVp] = useState(() =>
    typeof window !== 'undefined' ? read() : { short: 9999, landscape: true },
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChange = () => setVp(read());
    window.addEventListener('resize', onChange);
    window.addEventListener('orientationchange', onChange);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('orientationchange', onChange);
    };
  }, []);
  return vp;
}

/**
 * Реактивные флаги размера экрана поверх AntD Grid.useBreakpoint().
 * Брейкпоинты AntD: xs < 576, sm ≥ 576, md ≥ 768, lg ≥ 992.
 * - isPhone:  < 576  (iPhone 12 390, 15 Pro Max 430)
 * - isMobile: < 768  (телефоны)
 * - isTablet: 768..991 (iPad портрет = md, без lg)
 * - isLandscapePhone: телефон, повёрнутый горизонтально. Определяем по короткой стороне
 *   вьюпорта (< 576px) + ориентации landscape: у телефона короткая сторона ≤ ~430, у планшета ≥ 768.
 *   Завязка на короткую сторону (а не max-height/pointer) надёжнее на реальных устройствах
 *   и в эмуляции, где AntD ширина-брейкпоинты считают ландшафтный телефон планшетом/десктопом.
 * - isPhoneDevice: телефон в любой ориентации (isPhone || isLandscapePhone).
 */
export function useIsMobile() {
  const screens = useBreakpoint();
  const { short, landscape } = useViewport();
  const isPhone = !screens.sm;
  const isLandscapePhone = landscape && short < 576;
  return {
    isPhone,
    isLandscapePhone,
    isPhoneDevice: isPhone || isLandscapePhone,
    isMobile: !screens.md,
    isTablet: !!screens.md && !screens.lg,
    screens,
  };
}
