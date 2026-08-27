import { useLayoutEffect, useState, type RefObject } from 'react';

// Дефолтная (size="large") строка antd Table: 16px padding ×2 + line-height 22 + border 1.
const ROW_HEIGHT = 55;
const HEADER_HEIGHT = 55;
// Пагинация 32px + margin 16px сверху и снизу.
const PAGINATION_HEIGHT = 64;
// <Content> padding-bottom 16 (MainLayout) + padding страницы 24 + рамка Card 1.
const BOTTOM_GAP = 41;

/**
 * Число строк таблицы, которое помещается от верха `ref` до низа окна.
 * Пересчитывается при активации вкладки и ресайзе окна.
 */
export function useFitPageSize(ref: RefObject<HTMLElement | null>, active: boolean, min = 10): number {
  const [pageSize, setPageSize] = useState(min);

  useLayoutEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;

    const compute = () => {
      // Скрытая (неактивная) панель Tabs — offsetParent null, rect бессмысленен.
      if (el.offsetParent === null) return;
      const top = el.getBoundingClientRect().top;
      const available = window.innerHeight - top - HEADER_HEIGHT - PAGINATION_HEIGHT - BOTTOM_GAP;
      setPageSize(Math.max(min, Math.floor(available / ROW_HEIGHT)));
    };

    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [ref, active, min]);

  return pageSize;
}
