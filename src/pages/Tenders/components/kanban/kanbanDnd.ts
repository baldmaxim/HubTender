import {
  defaultDropAnimationSideEffects,
  pointerWithin,
  rectIntersection,
  type Announcements,
  type CollisionDetection,
  type DropAnimation,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { KANBAN_EASE } from './useKanbanFlip';

/** Указатель внутри колонки — она и цель; в зазоре между колонками — колонка с наибольшим перекрытием. */
export const kanbanCollision: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args);
  return byPointer.length > 0 ? byPointer : rectIntersection(args);
};

/** Клавиатура: ←/→ — соседняя доступная колонка; карточка встаёт под её шапкой. */
export const columnKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context: { collisionRect, droppableRects, droppableContainers, over } }
) => {
  if (!collisionRect || (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft')) {
    return undefined;
  }
  event.preventDefault();

  const columns = droppableContainers
    .getEnabled()
    .map((container) => ({ id: container.id, rect: droppableRects.get(container.id) }))
    .filter((item): item is { id: typeof item.id; rect: NonNullable<typeof item.rect> } => item.rect != null)
    .sort((left, right) => left.rect.left - right.rect.left);
  if (columns.length === 0) return undefined;

  const centerX = collisionRect.left + collisionRect.width / 2;
  const currentIndex = over
    ? columns.findIndex((column) => column.id === over.id)
    : columns.findIndex((column) => centerX >= column.rect.left && centerX <= column.rect.right);
  const step = event.code === 'ArrowRight' ? 1 : -1;
  const next = columns[currentIndex < 0 ? (step > 0 ? 0 : columns.length - 1) : currentIndex + step];
  if (!next) return undefined;

  const headerOffset = 56;
  const maxTop = next.rect.top + next.rect.height - collisionRect.height;
  return {
    x: next.rect.left + (next.rect.width - collisionRect.width) / 2,
    y: Math.max(next.rect.top + headerOffset, Math.min(collisionRect.top, maxTop)),
  };
};

/** Посадка «поднятой» карточки в заглушку: оверлей выпрямляется, оригинал скрыт до конца полёта. */
export const kanbanDropAnimation: DropAnimation = {
  duration: 220,
  easing: KANBAN_EASE,
  sideEffects: (params) => {
    params.dragOverlay.node.classList.add('kb-overlay--dropping');
    return defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } })(params);
  },
};

export const KANBAN_SCREEN_READER_INSTRUCTIONS =
  'Чтобы поднять тендер, нажмите пробел. Стрелками влево и вправо выберите колонку. ' +
  'Пробел или Enter — опустить, Escape — отменить.';

export const buildKanbanAnnouncements = (
  getTitle: (id: string | number) => string,
  getColumnTitle: (id: string | number | undefined) => string,
  getOriginTitle: () => string
): Announcements => ({
  onDragStart: ({ active }) =>
    `Тендер «${getTitle(active.id)}» поднят. Текущая колонка «${getOriginTitle()}». ` +
    'Стрелками влево и вправо выберите колонку.',
  onDragOver: ({ active, over }) =>
    over ? `Тендер «${getTitle(active.id)}» над колонкой «${getColumnTitle(over.id)}».` : undefined,
  onDragEnd: ({ active, over }) =>
    over
      ? `Тендер «${getTitle(active.id)}» перенесён в колонку «${getColumnTitle(over.id)}».`
      : `Перенос отменён. Тендер «${getTitle(active.id)}» остался в колонке «${getOriginTitle()}».`,
  onDragCancel: ({ active }) =>
    `Перенос отменён. Тендер «${getTitle(active.id)}» остался в колонке «${getOriginTitle()}».`,
});
