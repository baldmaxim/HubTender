import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FC } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Over,
} from '@dnd-kit/core';
import type { TenderRegistryWithRelations, TenderStatus } from '../../../../lib/types';
import { useTheme } from '../../../../contexts/ThemeContext';
import { useReducedMotion } from '../../../../components/transitions';
import { mixHex } from '../../../../utils/color';
import {
  KANBAN_COLUMNS,
  getKanbanAccent,
  getKanbanColumn,
  getKanbanColumnDef,
  isKanbanColumnKey,
  resolveKanbanTarget,
  type KanbanColumnKey,
} from '../../utils/tenderKanban';
import { getTenderMonitorPalette } from '../../utils/tenderMonitorTheme';
import { TenderKanbanCard, type ITenderKanbanCardHandlers } from './TenderKanbanCard';
import { TenderKanbanColumn } from './TenderKanbanColumn';
import { TenderKanbanChips } from './TenderKanbanChips';
import { useKanbanMove } from './useKanbanMove';
import { useKanbanFlip } from './useKanbanFlip';
import {
  KANBAN_SCREEN_READER_INSTRUCTIONS,
  buildKanbanAnnouncements,
  columnKeyboardCoordinates,
  kanbanCollision,
  kanbanDropAnimation,
} from './kanbanDnd';
import './TenderKanban.css';

interface ITenderKanbanBoardProps extends ITenderKanbanCardHandlers {
  /** Тендеры после поиска и сортировки страницы. */
  tenders: TenderRegistryWithRelations[];
  statuses: TenderStatus[];
  /** Перетаскивание: выключено у генерального директора и на телефонах. */
  dragEnabled: boolean;
  /** Скрыть «Позвонить». */
  readOnly?: boolean;
  onUpdate: () => Promise<void> | void;
}

const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } };
const AUTO_SCROLL = { threshold: { x: 0.15, y: 0.15 }, acceleration: 10 };

export const TenderKanbanBoard: FC<ITenderKanbanBoardProps> = ({
  tenders,
  statuses,
  dragEnabled,
  readOnly,
  onUpdate,
  ...handlers
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const palette = getTenderMonitorPalette(isDark);
  const reducedMotion = useReducedMotion();
  const { effectiveTenders, moveTender, pendingIds, errorIds } = useKanbanMove({ tenders, onUpdate });

  const [activeId, setActiveId] = useState<string | null>(null);
  const [originColumn, setOriginColumn] = useState<KanbanColumnKey | null>(null);
  const [overColumn, setOverColumn] = useState<KanbanColumnKey | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const columnElements = useRef(new Map<KanbanColumnKey, HTMLElement>());
  const skipFlightRef = useRef<string | null>(null);
  const tendersRef = useRef(effectiveTenders);
  tendersRef.current = effectiveTenders;
  const originRef = useRef<KanbanColumnKey | null>(null);

  const targets = useMemo(
    () => new Map(KANBAN_COLUMNS.map((column) => [column.key, resolveKanbanTarget(column.key, statuses)])),
    [statuses]
  );

  // Карточка под курсором показывается заглушкой в колонке-цели — на своём месте по сортировке.
  const columns = useMemo(() => {
    const buckets = new Map<KanbanColumnKey, TenderRegistryWithRelations[]>(
      KANBAN_COLUMNS.map((column) => [column.key, []])
    );
    effectiveTenders.forEach((tender) => {
      const key = tender.id === activeId && overColumn ? overColumn : getKanbanColumn(tender);
      buckets.get(key)?.push(tender);
    });
    return buckets;
  }, [effectiveTenders, activeId, overColumn]);

  useKanbanFlip(rootRef, skipFlightRef, reducedMotion);
  // Ключ заглушки держим до конца рендера, в котором карточку отпустили (см. useKanbanFlip).
  useLayoutEffect(() => {
    if (!activeId) skipFlightRef.current = null;
  });

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: columnKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    })
  );

  const accessibility = useMemo(
    () => ({
      announcements: buildKanbanAnnouncements(
        (id) => tendersRef.current.find((tender) => tender.id === id)?.title ?? '',
        (id) => (isKanbanColumnKey(id) ? getKanbanColumnDef(id).title : ''),
        () => (originRef.current ? getKanbanColumnDef(originRef.current).title : '')
      ),
      screenReaderInstructions: { draggable: KANBAN_SCREEN_READER_INSTRUCTIONS },
    }),
    []
  );

  const toTargetColumn = (over: Over | null): KanbanColumnKey | null =>
    over && isKanbanColumnKey(over.id) && targets.get(over.id) ? over.id : null;

  const resetDrag = () => {
    setActiveId(null);
    setOriginColumn(null);
    setOverColumn(null);
  };

  const handleDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const tender = tendersRef.current.find((item) => item.id === active.id);
    if (!tender) return;
    const origin = getKanbanColumn(tender);
    originRef.current = origin;
    skipFlightRef.current = tender.id;
    setActiveId(tender.id);
    setOriginColumn(origin);
    setOverColumn(origin);
    if (typeof TouchEvent !== 'undefined' && activatorEvent instanceof TouchEvent && 'vibrate' in navigator) {
      navigator.vibrate(10);
    }
  };

  const handleDragOver = ({ over }: DragOverEvent) => {
    setOverColumn(toTargetColumn(over));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const column = toTargetColumn(over);
    const target = column ? targets.get(column) : null;
    if (column && target && column !== originColumn) {
      void moveTender(String(active.id), column, target);
    }
    resetDrag();
  };

  // Фишки колонок — когда все колонки не помещаются (телефон, планшет, узкий десктоп).
  const [overflowing, setOverflowing] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<ReadonlySet<KanbanColumnKey>>(() => new Set());

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    // Края с невидимыми колонками — классом на самой доске, без перерисовки React на каждый скролл.
    let frame = 0;
    const updateEdges = () => {
      frame = 0;
      const maxScroll = board.scrollWidth - board.clientWidth;
      board.classList.toggle('kb-board--more-left', board.scrollLeft > 4);
      board.classList.toggle('kb-board--more-right', board.scrollLeft < maxScroll - 4);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(updateEdges);
    };
    const update = () => {
      setOverflowing(board.scrollWidth > board.clientWidth + 1);
      updateEdges();
    };
    const observer = new ResizeObserver(update);
    observer.observe(board);
    board.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      board.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    const board = boardRef.current;
    if (!board || !overflowing) return;
    const visible = new Set<KanbanColumnKey>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const key = (entry.target as HTMLElement).dataset.column;
          if (!isKanbanColumnKey(key)) return;
          if (entry.isIntersecting) visible.add(key);
          else visible.delete(key);
        });
        setVisibleColumns(new Set(visible));
      },
      { root: board, threshold: 0.6 }
    );
    columnElements.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [overflowing]);

  const registerElement = useCallback((key: KanbanColumnKey, element: HTMLElement | null) => {
    if (element) columnElements.current.set(key, element);
    else columnElements.current.delete(key);
  }, []);

  const scrollToColumn = (key: KanbanColumnKey) => {
    columnElements.current.get(key)?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      inline: 'start',
      block: 'nearest',
    });
  };

  const activeTender = activeId ? effectiveTenders.find((tender) => tender.id === activeId) ?? null : null;
  const overlayColumn = overColumn ?? originColumn;

  const rootStyle = {
    '--kb-col-bg': palette.sectionBg,
    '--kb-col-border': palette.borderSoft,
    '--kb-card-bg': palette.cardBgAlt,
    '--kb-card-border': palette.border,
    '--kb-text': palette.text,
    '--kb-text2': palette.textSecondary,
    '--kb-muted': palette.muted,
    '--kb-subtle': palette.subtleText,
    '--kb-title': palette.title,
    '--kb-hover-border': palette.warningBorder,
    '--kb-lift-border': palette.warning,
    '--kb-warn': palette.sent,
    '--kb-success': palette.success,
    '--kb-danger': palette.danger,
    '--kb-danger-bg': palette.dangerBg,
    '--kb-danger-border': palette.dangerBorder,
    '--kb-info': palette.info,
    '--kb-badge-bg': palette.tabBadgeBg,
    '--kb-placeholder-bg': palette.disabledBg,
    '--kb-target-bg': palette.warningBg,
    '--kb-shadow-rest': isDark ? '0 1px 2px rgba(0, 0, 0, 0.18)' : '0 1px 2px rgba(15, 23, 42, 0.08)',
    '--kb-shadow-hover': isDark ? '0 6px 16px rgba(0, 0, 0, 0.32)' : '0 6px 16px rgba(15, 23, 42, 0.10)',
    '--kb-shadow-lift': isDark ? '0 14px 32px rgba(0, 0, 0, 0.48)' : '0 14px 32px rgba(15, 23, 42, 0.20)',
    '--kb-scroll-thumb': isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(15, 23, 42, 0.18)',
    '--kb-scroll-thumb-hover': isDark ? 'rgba(255, 255, 255, 0.28)' : 'rgba(15, 23, 42, 0.32)',
    // Нативные части прокрутки (Safari, оверлейные ползунки) — в цвет темы приложения, а не системы.
    colorScheme: isDark ? 'dark' : 'light',
  } as CSSProperties;

  const rootClassName = ['kb', activeId && 'kb--dragging', overflowing && 'kb--overflow'].filter(Boolean).join(' ');

  return (
    <div ref={rootRef} className={rootClassName} style={rootStyle} role="region" aria-label="Канбан-доска тендеров">
      <DndContext
        sensors={sensors}
        collisionDetection={kanbanCollision}
        measuring={MEASURING}
        autoScroll={AUTO_SCROLL}
        accessibility={accessibility}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={resetDrag}
      >
        <TenderKanbanChips
          columns={KANBAN_COLUMNS.map((def) => ({
            def,
            count: columns.get(def.key)?.length ?? 0,
            accent: getKanbanAccent(def.key, palette),
          }))}
          visibleColumns={visibleColumns}
          hint={dragEnabled ? 'Перетащите карточку в другую колонку, чтобы сменить статус' : null}
          onSelect={scrollToColumn}
        />

        <div ref={boardRef} className="kb-board">
          {KANBAN_COLUMNS.map((def) => {
            const accent = getKanbanAccent(def.key, palette);
            return (
              <TenderKanbanColumn
                key={def.key}
                def={def}
                items={columns.get(def.key) ?? []}
                accent={accent}
                overBg={mixHex(palette.sectionBg, accent, isDark ? 0.1 : 0.07)}
                palette={palette}
                dropDisabled={!targets.get(def.key)}
                dragEnabled={dragEnabled}
                isDragActive={activeId != null}
                isOver={activeId != null && overColumn === def.key && overColumn !== originColumn}
                originColumn={originColumn}
                pendingIds={pendingIds}
                errorIds={errorIds}
                readOnly={readOnly}
                registerElement={registerElement}
                {...handlers}
              />
            );
          })}
        </div>

        <DragOverlay dropAnimation={reducedMotion ? null : kanbanDropAnimation} zIndex={1100}>
          {activeTender && overlayColumn ? (
            <TenderKanbanCard
              tender={activeTender}
              column={overlayColumn}
              palette={palette}
              variant="overlay"
              accent={getKanbanAccent(overlayColumn, palette)}
              readOnly
              {...handlers}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};
