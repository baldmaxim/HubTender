import { useLayoutEffect, useRef, type RefObject } from 'react';

// Плавность доски: FLIP поверх раскладки. Позиции карточек храним в координатах
// списка колонки (offsetLeft/offsetTop) — прокрутка колонок и страницы их не сбивает.

export const KANBAN_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'; // --resize-ease из transitions.dev
const SHIFT_MS = 220;
const ENTER_MS = 180;
const FLIGHT_MS = 320;

interface ISnapshot {
  list: string;
  x: number;
  y: number;
}

const readTranslate = (el: HTMLElement): { x: number; y: number } => {
  const { transform } = getComputedStyle(el);
  if (!transform || transform === 'none') return { x: 0, y: 0 };
  const matrix = new DOMMatrixReadOnly(transform);
  return { x: matrix.m41, y: matrix.m42 };
};

const visualPosition = (list: HTMLElement, snap: ISnapshot) => {
  const rect = list.getBoundingClientRect();
  return {
    left: rect.left + list.clientLeft + snap.x - list.scrollLeft,
    top: rect.top + list.clientTop + snap.y - list.scrollTop,
  };
};

// Перелёт между колонками: список колонки обрезает transform, поэтому летит клон поверх доски.
function flyBetweenColumns(host: HTMLElement, el: HTMLElement, from: { left: number; top: number }) {
  const to = el.getBoundingClientRect();
  const clone = el.cloneNode(true) as HTMLElement;
  clone.removeAttribute('data-flip-key');
  clone.setAttribute('aria-hidden', 'true');
  clone.classList.add('kb-flight');
  clone.style.setProperty('--kb-accent', getComputedStyle(el).getPropertyValue('--kb-accent'));
  clone.style.left = `${to.left}px`;
  clone.style.top = `${to.top}px`;
  clone.style.width = `${to.width}px`;
  clone.style.height = `${to.height}px`;
  host.appendChild(clone);

  const hide = el.animate([{ opacity: 0 }, { opacity: 0 }], { duration: FLIGHT_MS });
  const flight = clone.animate(
    [
      { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(1.02)` },
      { transform: 'translate(0, 0) scale(1)' },
    ],
    { duration: FLIGHT_MS, easing: KANBAN_EASE }
  );
  const cleanup = () => {
    clone.remove();
    hide.cancel();
  };
  flight.onfinish = cleanup;
  flight.oncancel = cleanup;
}

/**
 * После каждого рендера сравнивает позиции карточек `[data-flip-key]` в списках `[data-flip-list]`:
 * сдвиг в своей колонке — FLIP, новая карточка — проявление, переход в другую колонку — перелёт.
 * `skipFlightRef` — карточка под курсором (её заглушка не летает, а проявляется);
 * доска держит ключ ещё один рендер после отпускания, пока оверлей садится на место.
 */
export function useKanbanFlip(
  rootRef: RefObject<HTMLElement>,
  skipFlightRef: { readonly current: string | null },
  disabled: boolean
) {
  const snapshotsRef = useRef<Map<string, ISnapshot> | null>(null);
  const animationsRef = useRef(new WeakMap<HTMLElement, Animation>());

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const previous = snapshotsRef.current;
    const next = new Map<string, ISnapshot>();
    const lists = new Map<string, HTMLElement>();
    const items: Array<{ key: string; el: HTMLElement; snap: ISnapshot }> = [];

    root.querySelectorAll<HTMLElement>('[data-flip-list]').forEach((list) => {
      const listKey = list.dataset.flipList as string;
      lists.set(listKey, list);
      Array.from(list.children).forEach((child) => {
        const el = child as HTMLElement;
        const key = el.dataset.flipKey;
        if (!key) return;
        const snap = { list: listKey, x: el.offsetLeft, y: el.offsetTop };
        next.set(key, snap);
        items.push({ key, el, snap });
      });
    });

    snapshotsRef.current = next;
    // Первый рендер и reduced-motion — только запоминаем позиции.
    if (!previous || disabled) return;

    items.forEach(({ key, el, snap }) => {
      const prev = previous.get(key);

      if (!prev) {
        animationsRef.current.get(el)?.cancel();
        animationsRef.current.set(
          el,
          el.animate(
            [
              { opacity: 0, transform: 'scale(0.96)' },
              { opacity: 1, transform: 'scale(1)' },
            ],
            { duration: ENTER_MS, easing: KANBAN_EASE }
          )
        );
        return;
      }

      if (prev.list !== snap.list) {
        const fromList = lists.get(prev.list);
        if (key === skipFlightRef.current || !fromList) {
          el.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }], {
            duration: ENTER_MS,
            easing: KANBAN_EASE,
          });
        } else {
          flyBetweenColumns(root, el, visualPosition(fromList, prev));
        }
        return;
      }

      // Прерванный сдвиг продолжаем с текущей точки, без рывка.
      const running = animationsRef.current.get(el);
      const current = running && running.playState === 'running' ? readTranslate(el) : { x: 0, y: 0 };
      const dx = prev.x - snap.x + current.x;
      const dy = prev.y - snap.y + current.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

      running?.cancel();
      animationsRef.current.set(
        el,
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
          duration: SHIFT_MS,
          easing: KANBAN_EASE,
        })
      );
    });
  });
}
