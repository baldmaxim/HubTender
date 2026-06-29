import { useEffect, useRef, useState } from 'react';

/**
 * Инкрементальный рендер длинных списков карточек (переменной высоты, где честная
 * виртуализация по фиксированной высоте не подходит). Сначала рендерим `step` элементов,
 * затем доращиваем по мере подхода к низу (IntersectionObserver на сентинеле).
 *
 * Решает «долгую загрузку» на крупном тендере: вместо построения сотен карточек разом
 * в первый кадр попадает только первая порция, остальное — по скроллу.
 *
 * Использование:
 *   const { visible, sentinelRef, hasMore } = useIncrementalRender(items);
 *   {visible.map(...)}
 *   {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
 */
export function useIncrementalRender<T>(items: T[], step = 40) {
  const [count, setCount] = useState(step);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Сброс при смене набора (другой тендер/фильтр) — иначе остаёмся на старом count.
  useEffect(() => {
    setCount(step);
  }, [items, step]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setCount((c) => Math.min(c + step, items.length));
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [items.length, step]);

  const hasMore = count < items.length;
  const visible = hasMore ? items.slice(0, count) : items;
  return { visible, sentinelRef, hasMore };
}
