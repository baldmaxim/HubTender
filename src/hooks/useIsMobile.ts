import { Grid } from 'antd';

const { useBreakpoint } = Grid;

/**
 * Реактивные флаги размера экрана поверх AntD Grid.useBreakpoint().
 * Брейкпоинты AntD: xs < 576, sm ≥ 576, md ≥ 768, lg ≥ 992.
 * - isPhone:  < 576  (iPhone 12 390, 15 Pro Max 430)
 * - isMobile: < 768  (телефоны)
 * - isTablet: 768..991 (iPad портрет = md, без lg)
 */
export function useIsMobile() {
  const screens = useBreakpoint();
  return {
    isPhone: !screens.sm,
    isMobile: !screens.md,
    isTablet: !!screens.md && !screens.lg,
    screens,
  };
}
