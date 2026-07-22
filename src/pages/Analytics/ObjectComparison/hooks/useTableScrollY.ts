import { useLayoutEffect, useRef, useState } from 'react';

/** Нижний отступ страницы под таблицей (px). */
const BOTTOM_PAD = 24;
/** Минимальная высота тела таблицы, чтобы оно не схлопнулось на низких окнах. */
const MIN_BODY = 240;
/** Фолбэк высоты шапки (две строки сгруппированных заголовков), если DOM ещё не готов. */
const FALLBACK_HEAD = 70;

/**
 * Высота тела таблицы для `scroll.y`: от верха таблицы до низа окна.
 * Нужна там, где блок над таблицей меняет высоту (карточка выбора переносится при добавлении
 * объектов, карточка статистики встаёт рядом только на lg) — константный calc() не подходит.
 *
 * `revision` — строка-триггер пересчёта. ResizeObserver на самом контейнере зациклился бы:
 * его высота зависит от возвращаемого значения.
 */
export function useTableScrollY(enabled: boolean, revision: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(420);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const head = el.querySelector('.ant-table-header')?.clientHeight ?? FALLBACK_HEAD;
      setScrollY(Math.max(MIN_BODY, Math.round(window.innerHeight - top - head - BOTTOM_PAD)));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [enabled, revision]);

  return { ref, scrollY };
}
