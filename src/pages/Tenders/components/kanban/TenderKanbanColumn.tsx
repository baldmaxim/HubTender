import { useCallback, type CSSProperties, type FC } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { InboxOutlined, PhoneOutlined } from '@ant-design/icons';
import type { TenderRegistryWithRelations } from '../../../../lib/types';
import { formatMoney, shouldShowCallAction } from '../../utils/tenderMonitor';
import { getTenderCost, type KanbanColumnDef, type KanbanColumnKey } from '../../utils/tenderKanban';
import type { TenderMonitorPalette } from '../../utils/tenderMonitorTheme';
import { DraggableTenderKanbanCard, TenderKanbanCard, type ITenderKanbanCardHandlers } from './TenderKanbanCard';

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
  registerElement: (key: KanbanColumnKey, element: HTMLElement | null) => void;
}

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
  const callCount = def.key === 'sent' ? items.filter((tender) => shouldShowCallAction(tender)).length : 0;
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
        <span className="kb-column__dot" aria-hidden />
        <h3 className="kb-column__title" id={titleId}>
          {def.title}
        </h3>
        <span className="kb-column__count" aria-label={`${items.length} тендеров`}>
          {items.length}
        </span>
        {callCount > 0 ? (
          <span className="kb-column__alert" title="Требуют звонка">
            <PhoneOutlined aria-hidden />
            {callCount}
          </span>
        ) : null}
        {totalCost > 0 ? <span className="kb-column__sum">{formatMoney(totalCost)}</span> : null}
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
