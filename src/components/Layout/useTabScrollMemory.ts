import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Прокрутка вкладок. Страницы скроллятся единым контейнером — <Content overflow:auto> в
 * MainLayout; при display:none у страницы его scrollTop схлопывается, и вернувшись на вкладку
 * пользователь оказался бы наверху. Запоминаем scrollTop по `scrollKey` (key вкладки + её rev:
 * пересозданная страница начинает с начала) и восстанавливаем при показе.
 *
 * `anchorRef` — скрытый элемент-якорь, лежащий прямо в скролл-контейнере (его parentElement).
 * `scrollKey` null — активного таба нет (редирект-роут), прокрутку не трогаем.
 *
 * Восстановление — в useLayoutEffect по смене scrollKey (а не по location): иначе собственный
 * setSearchParams страницы сбрасывал бы прокрутку.
 */
export function useTabScrollMemory(anchorRef: RefObject<HTMLElement>, scrollKey: string | null): void {
  const saved = useRef(new Map<string, number>());
  const keyRef = useRef(scrollKey);

  useEffect(() => {
    const scroller = anchorRef.current?.parentElement;
    if (!scroller) return undefined;
    const onScroll = () => {
      if (keyRef.current) saved.current.set(keyRef.current, scroller.scrollTop);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [anchorRef]);

  useLayoutEffect(() => {
    // keyRef обновляем до восстановления: scroll-события, вызванные переключением,
    // должны писаться уже под ключом новой вкладки.
    keyRef.current = scrollKey;
    const scroller = anchorRef.current?.parentElement;
    if (scroller && scrollKey) scroller.scrollTop = saved.current.get(scrollKey) ?? 0;
  }, [anchorRef, scrollKey]);
}
