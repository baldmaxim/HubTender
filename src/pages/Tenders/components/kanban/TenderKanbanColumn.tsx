import { useCallback, useMemo, type CSSProperties, type FC } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { InboxOutlined, PhoneOutlined } from '@ant-design/icons';
import type { TenderRegistryWithRelations } from '../../../../lib/types';
import { formatMoney, shouldShowCallAction } from '../../utils/tenderMonitor';
import { getTenderCost, type KanbanColumnDef, type KanbanColumnKey } from '../../utils/tenderKanban';
import type { TenderMonitorPalette } from '../../utils/tenderMonitorTheme';
import { CallListPopover } from '../CallListPopover';
import { DraggableTenderKanbanCard, TenderKanbanCard, type ITenderKanbanCardHandlers } from './TenderKanbanCard';
import './TenderKanbanColumn.css';

interface ITenderKanbanColumnProps extends ITenderKanbanCardHandlers {
  def: KanbanColumnDef;
  items: TenderRegistryWithRelations[];
  accent: string;
  overBg: string;
  palette: TenderMonitorPalette;
  /** Колонку нельзя выбрать целью (в справочнике нет подходящего статуса). */
  dropDisabled: boolean;
  dragEnabled: boolean;
  isDragActive: boolean;
  isOver: boolean;
  originColumn: KanbanColumnKey | null;
  pendingIds: ReadonlySet<string>;
  errorIds: ReadonlySet<string>;
  readOnly?: boolean;
  /** Сумма КП всех колонок доски — 100% для доли колонки. */
  boardTotalCost: number;
  registerElement: (key: KanbanColumnKey, element: HTMLElement | null) => void;
}

const formatShare = (share: number): string => {
  if (share <= 0) return '0%';
  if (share < 0.01) return '<1%';
  return `${Math.round(share * 100)}%`;
};

export const TenderKanbanColumn: FC<ITenderKanbanColumnProps> = ({
  def,
  items,
  accent,
  overBg,
  palette,
  dropDisabled,
  dragEnabled,
  isDragActive,
  isOver,
  originColumn,
  pendingIds,
  errorIds,
  readOnly,
  boardTotalCost,
  registerElement,
  ...handlers
}) => {
  const { setNodeRef } = useDroppable({ id: def.key, disabled: dropDisabled || !dragEnabled });
  const columnRef = useCallback(
    (element: HTMLElement | null) => {
      setNodeRef(element);
      registerElement(def.key, element);
    },
    [def.key, registerElement, setNodeRef]
  );

  const totalCost = items.reduce((sum, tender) => sum + getTenderCost(tender), 0);
  const share = boardTotalCost > 0 ? totalCost / boardTotalCost : 0;
  const callTenders = useMemo(() => items.filter((tender) => shouldShowCallAction(tender)), [items]);
  const titleId = `kb-column-title-${def.key}`;

  const className = [
    'kb-column',
    isOver && 'kb-column--over',
    isDragActive && dropDisabled && 'kb-column--disabled',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      ref={columnRef}
      className={className}
      style={{ '--kb-accent': accent, '--kb-over-bg': overBg } as CSSProperties}
      aria-labelledby={titleId}
      data-column={def.key}
    >
      <header className="kb-column__head">
        <div className="kb-column__row">
          <span className="kb-column__dot" aria-hidden />
          <h3 className="kb-column__title" id={titleId}>
            {def.title}
          </h3>
          <span className="kb-column__count" aria-label={`${items.length} тендеров`}>
            {items.length}
          </span>
          {callTenders.length > 0 ? (
            <CallListPopover
              tenders={callTenders}
              palette={palette}
              readOnly={readOnly}
              placement="bottomRight"
              onOpenTender={handlers.onOpenTender}
              onQuickCall={handlers.onQuickCall}
            >
              <button
                type="button"
                className="kb-column__alert"
                aria-label={`Требуют звонка: ${callTenders.length}. Показать, кому позвонить`}
                aria-haspopup="dialog"
              >
                <PhoneOutlined aria-hidden />
                {callTenders.length}
              </button>
            </CallListPopover>
          ) : null}
        </div>
        <div className="kb-column__money" title="Сумма КП колонки и её доля в сумме всех КП доски">
          <span className="kb-column__sum">{totalCost > 0 ? formatMoney(totalCost) : '0 ₽'}</span>
          <span className="kb-column__share">{formatShare(share)}</span>
          <span className="kb-column__bar" aria-hidden>
            <span className="kb-column__bar-fill" style={{ '--kb-share': share } as CSSProperties} />
          </span>
        </div>
      </header>

      <div className="kb-column__list" role="list" data-flip-list={def.key}>
        {items.map((tender) => (
          <div key={tender.id} role="listitem" className="kb-column__item" data-flip-key={tender.id}>
            {dragEnabled ? (
              <DraggableTenderKanbanCard
                tender={tender}
                column={def.key}
                originColumn={originColumn}
                palette={palette}
                readOnly={readOnly}
                pending={pendingIds.has(tender.id)}
                error={errorIds.has(tender.id)}
                {...handlers}
              />
            ) : (
              <TenderKanbanCard tender={tender} column={def.key} palette={palette} readOnly={readOnly} {...handlers} />
            )}
          </div>
        ))}
        {items.length === 0 ? (
          <div key="__empty" className="kb-empty" data-flip-key={`__empty-${def.key}`}>
            <InboxOutlined className="kb-empty__icon" aria-hidden />
            {isDragActive && !dropDisabled ? 'Перетащите сюда' : 'Нет тендеров'}
          </div>
        ) : null}
      </div>
    </section>
  );
};
