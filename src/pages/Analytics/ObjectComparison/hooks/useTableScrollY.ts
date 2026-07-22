import { useLayoutEffect, useRef, useState } from 'react';

/** Нижний отступ страницы под таблицей (px). */
const BOTTOM_PAD = 24;
/** Минимальная высота тела таблицы, чтобы оно не схлопнулось на низких окнах. */
const DEFAULT_MIN_BODY = 240;
/** Фолбэк высоты шапки (две строки сгруппированных заголовков), если DOM ещё не готов. */
const FALLBACK_HEAD = 70;
/** Фолбэк доступной высоты: 64px шапка MainLayout + 2×16px padding у Content. */
const LAYOUT_CHROME = 96;

interface Options {
  /**
   * Режим «карточка прилипает к верху скролл-контейнера» (ландшафт телефона):
   * высота считается не до низа окна, а по видимой области `.ant-layout-content`,
   * т.к. в прилипшем состоянии карточка стоит вверху этой области, а не там,
   * где её застаёт измерение.
   */
  pinned?: boolean;
  /** Минимальная высота тела таблицы (на низких экранах дефолт 240 не подходит). */
  minBody?: number;
}

/** Видимая высота скролл-контейнера страницы (без паддингов) или фолбэк по окну. */
function availableHeight(el: HTMLElement): number {
  const content = el.closest('.ant-layout-content') as HTMLElement | null;
  if (!content) return window.innerHeight - LAYOUT_CHROME;
  const cs = window.getComputedStyle(content);
  return content.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
}

/**
 * Высота тела таблицы для `scroll.y`: от верха таблицы до низа окна.
 * Нужна там, где блок над таблицей меняет высоту (карточка выбора переносится при добавлении
 * объектов, карточка статистики встаёт рядом только на lg) — константный calc() не подходит.
 *
 * `revision` — строка-триггер пересчёта. ResizeObserver на самом контейнере зациклился бы:
 * его высота зависит от возвращаемого значения.
 */
export function useTableScrollY(enabled: boolean, revision: string, opts: Options = {}) {
  const { pinned = false, minBody = DEFAULT_MIN_BODY } = opts;
  const ref = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(420);
  const [availH, setAvailH] = useState(() =>
    typeof window === 'undefined' ? 420 : window.innerHeight - LAYOUT_CHROME,
  );

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const head = el.querySelector('.ant-table-header')?.clientHeight ?? FALLBACK_HEAD;
      if (pinned) {
        const avail = availableHeight(el);
        // Шапка карточки (заголовок + фильтры) остаётся видимой в прилипшем состоянии.
        const cardHead = el.closest('.ant-card')?.querySelector(':scope > .ant-card-head')?.clientHeight ?? 0;
        setAvailH(avail);
        setScrollY(Math.max(minBody, Math.round(avail - cardHead - head - 4)));
        return;
      }
      const top = el.getBoundingClientRect().top;
      setScrollY(Math.max(minBody, Math.round(window.innerHeight - top - head - BOTTOM_PAD)));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [enabled, revision, pinned, minBody]);

  return { ref, scrollY, availH };
}
