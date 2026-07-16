import { useCallback, useEffect, useState } from 'react';

/**
 * Ближайший предок с собственной прокруткой. Нужен как явный `root` наблюдателя:
 * при неявном root'е (viewport) `rootMargin` бесполезен — клиппинг-предки
 * (у нас <Content overflow:auto> в MainLayout) режут сентинел без учёта margin,
 * и подгрузка срабатывала бы только по факту достижения низа, без предзагрузки.
 */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/**
 * Инкрементальный рендер длинных списков карточек (переменной высоты, где честная
 * виртуализация по фиксированной высоте не подходит). Сначала рендерим `step` элементов,
 * затем доращиваем по мере подхода к низу (IntersectionObserver на сентинеле).
 *
 * Решает «долгую загрузку» на крупном тендере: вместо построения сотен карточек разом
 * в первый кадр попадает только первая порция, остальное — по скроллу.
 *
 * `resetKey` — необязательный ключ сброса к первой порции; по умолчанию это
 * идентичность `items`.
 *
 * Использование:
 *   const { visible, sentinelRef, hasMore } = useIncrementalRender(items);
 *   {visible.map(...)}
 *   {hasMore && <div ref={sentinelRef} style={{ height: 1 }} />}
 */
export function useIncrementalRender<T>(items: T[], step = 40, resetKey?: unknown) {
  const [count, setCount] = useState(step);
  // Сентинел держим в state, а не в useRef: колбэк-ref заставляет эффект
  // переподписаться, когда нода перемонтируется (например, список ушёл в ветку
  // `loading ? <Spin/> : ...` на рефетче). С useRef наблюдатель оставался бы на
  // оторванной ноде и рост умирал навсегда.
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => setSentinel(node), []);

  const total = items.length;
  const hasMore = count < total;

  // Сброс к первой порции при смене набора (другой тендер/фильтр/поиск).
  // По умолчанию ключ — идентичность массива. Страницы с realtime-рефетчем
  // передают стабильный `resetKey`: рефетч отдаёт новый массив с тем же
  // содержимым, и на идентичности пользователя выкидывало бы к первым `step`
  // строкам посреди прокрутки.
  const key = resetKey === undefined ? items : resetKey;
  useEffect(() => {
    setCount(step);
  }, [key, step]);

  useEffect(() => {
    if (!sentinel || !hasMore || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setCount((c) => Math.min(c + step, total));
      }
    }, { root: findScrollParent(sentinel), rootMargin: '400px' });
    io.observe(sentinel);
    return () => io.disconnect();
    // `count` в deps не лишний: после каждой подгрузки наблюдатель пересоздаётся и
    // заново оценивает пересечение. Иначе, если сентинел остался в зоне видимости,
    // IO повторно не сработает (он репортит только пересечение границы) и список
    // залипнет на текущей порции.
  }, [sentinel, hasMore, count, total, step]);

  const visible = hasMore ? items.slice(0, count) : items;
  return { visible, sentinelRef, hasMore };
}
