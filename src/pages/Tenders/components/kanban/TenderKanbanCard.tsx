import {
  memo,
  type CSSProperties,
  type FC,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { useDraggable, type DraggableAttributes, type DraggableSyntheticListeners } from '@dnd-kit/core';
import { LoadingOutlined, PhoneOutlined } from '@ant-design/icons';
import type { TenderRegistryWithRelations } from '../../../../lib/types';
import {
  formatDate,
  formatMoney,
  formatRubPerSquare,
  getControlDate,
  getDaysSinceControl,
  getDaysToSubmission,
  shouldShowCallAction,
} from '../../utils/tenderMonitor';
import { getTenderCost, type KanbanColumnKey } from '../../utils/tenderKanban';
import type { TenderMonitorPalette } from '../../utils/tenderMonitorTheme';
import { ChronologyPopover, MapPopover, PackagePopover } from '../TenderMonitorPopovers';
import { getSelectableProps, useTenderSelection } from '../selection/tenderSelection';
import { SelectCheck } from '../selection/SelectCheck';

export type KanbanCardVariant = 'default' | 'source' | 'target' | 'overlay';

type Tone = 'title' | 'danger' | 'warn' | 'success' | undefined;

export interface ITenderKanbanCardHandlers {
  onOpenTender: (tender: TenderRegistryWithRelations) => void;
  onOpenTimeline: (tender: TenderRegistryWithRelations) => void;
  onOpenPackage: (tender: TenderRegistryWithRelations) => void;
  onQuickCall: (tender: TenderRegistryWithRelations) => Promise<void> | void;
}

interface ITenderKanbanCardProps extends ITenderKanbanCardHandlers {
  tender: TenderRegistryWithRelations;
  column: KanbanColumnKey;
  palette: TenderMonitorPalette;
  /** Скрыть «Позвонить» (генеральный директор, телефон). */
  readOnly?: boolean;
  variant?: KanbanCardVariant;
  pending?: boolean;
  error?: boolean;
  draggable?: boolean;
  dragRef?: (element: HTMLElement | null) => void;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  /** Только для оверлея: акцент колонки-источника (оверлей живёт вне колонки). */
  accent?: string;
}

const formatAreaShort = (area?: number | null) =>
  area ? `${Math.round(area).toLocaleString('ru-RU')} м²` : '—';

const stop = (event: SyntheticEvent) => event.stopPropagation();

// Кнопки внутри карточки не начинают перетаскивание и не открывают тендер.
const interactionStopper: HTMLAttributes<HTMLSpanElement> = {
  onClick: stop,
  onMouseDown: stop,
  onTouchStart: stop,
  onKeyDown: stop,
};

const Metric: FC<{ label: string; value: ReactNode; tone?: Tone }> = ({ label, value, tone }) => (
  <div className="kb-metric">
    <div className="kb-metric__label">{label}</div>
    <div className={tone ? `kb-metric__value kb-tone--${tone}` : 'kb-metric__value'}>{value}</div>
  </div>
);

function getSubmissionTone(column: KanbanColumnKey, daysToSubmission: number | null): Tone {
  if (column !== 'calc' || daysToSubmission == null) return undefined;
  if (daysToSubmission < 0) return 'danger';
  return daysToSubmission <= 3 ? 'warn' : undefined;
}

// Четвёртый показатель: контроль звонка для «Направлено»/«В работе», иначе ₽/м².
function getControlMetric(tender: TenderRegistryWithRelations, column: KanbanColumnKey) {
  const daysSinceControl = getDaysSinceControl(tender);

  if (column === 'sent' && daysSinceControl != null) {
    return { label: 'Контроль', value: `${daysSinceControl} дн`, tone: daysSinceControl > 7 ? 'danger' : undefined } as const;
  }

  const daysToSubmission = getDaysToSubmission(tender);
  if (column === 'calc' && daysToSubmission != null) {
    const afterSubmission = daysToSubmission < 0 && getControlDate(tender) != null;
    return afterSubmission
      ? ({ label: 'Контроль', value: `${daysSinceControl ?? 0}/7 дн`, tone: 'success' } as const)
      : ({ label: 'До подачи', value: `${daysToSubmission} дн`, tone: 'warn' } as const);
  }

  return { label: '₽/м²', value: formatRubPerSquare(getTenderCost(tender), tender.area), tone: undefined };
}

export const TenderKanbanCard = memo(function TenderKanbanCard({
  tender,
  column,
  palette,
  readOnly,
  variant = 'default',
  pending,
  error,
  draggable,
  dragRef,
  dragAttributes,
  dragListeners,
  accent,
  onOpenTender,
  onOpenTimeline,
  onOpenPackage,
  onQuickCall,
}: ITenderKanbanCardProps) {
  const cost = getTenderCost(tender);
  const control = getControlMetric(tender, column);
  const canCall = !readOnly && variant !== 'overlay' && shouldShowCallAction(tender);
  const isPlaceholder = variant === 'source' || variant === 'target';
  const selection = useTenderSelection();
  const selecting = selection.active && variant === 'default';
  const selected = selecting && selection.isSelected(tender.id);

  const className = [
    'kb-card',
    draggable ? 'kb-card--draggable' : 'kb-card--readonly',
    variant !== 'default' && `kb-card--${variant}`,
    pending && 'kb-card--pending',
    error && 'kb-card--error',
    selecting && 'tm-select-item',
    selected && 'kb-card--selected',
  ]
    .filter(Boolean)
    .join(' ');

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    dragListeners?.onKeyDown?.(event);
    if (event.defaultPrevented || isPlaceholder) return;
    if (event.key === 'Enter' || (!draggable && event.key === ' ')) {
      event.preventDefault();
      onOpenTender(tender);
    }
  };

  // В режиме удаления карточка — флажок выбора (перенос на это время выключен).
  const interaction = selecting
    ? getSelectableProps(selection, tender.id)
    : {
        role: 'button' as const,
        tabIndex: variant === 'overlay' ? -1 : 0,
        onClick: () => {
          if (!isPlaceholder) onOpenTender(tender);
        },
        onKeyDown: handleKeyDown,
      };

  return (
    <div
      ref={dragRef}
      {...dragAttributes}
      {...dragListeners}
      {...interaction}
      aria-label={`Тендер ${tender.title}, ${tender.client_name || 'заказчик не указан'}`}
      aria-busy={pending || undefined}
      className={className}
      style={accent ? ({ '--kb-accent': accent } as CSSProperties) : undefined}
    >
      <div className="kb-card__head">
        {selecting ? <SelectCheck checked={selected} /> : null}
        <div className="kb-card__title">{tender.title}</div>
        <span className="kb-card__map" {...interactionStopper}>
          <MapPopover tender={tender} palette={palette} />
        </span>
      </div>

      <div className="kb-card__meta">
        {tender.client_name || 'Заказчик не указан'}
        {tender.tender_number ? <span className="kb-card__number"> · №{tender.tender_number}</span> : null}
      </div>

      <div className="kb-card__grid">
        <Metric label="Стоимость КП" value={cost ? formatMoney(cost) : '—'} tone="title" />
        <Metric label="Площадь" value={formatAreaShort(tender.area)} />
        <Metric
          label="Подача КП"
          value={formatDate(tender.submission_date)}
          tone={getSubmissionTone(column, getDaysToSubmission(tender))}
        />
        <Metric label={control.label} value={control.value} tone={control.tone} />
      </div>

      <div className="kb-card__foot">
        <span className="kb-card__icons" {...interactionStopper}>
          <ChronologyPopover tender={tender} palette={palette} onOpenTimeline={onOpenTimeline} />
          <PackagePopover tender={tender} palette={palette} onOpenPackage={onOpenPackage} />
        </span>
        {canCall ? (
          <span {...interactionStopper}>
            <button type="button" className="kb-call" onClick={() => void onQuickCall(tender)}>
              <PhoneOutlined />
              Позвонить
            </button>
          </span>
        ) : null}
      </div>

      {pending ? <LoadingOutlined className="kb-card__spinner" aria-hidden /> : null}
    </div>
  );
});

interface IDraggableTenderKanbanCardProps extends Omit<ITenderKanbanCardProps, 'variant' | 'draggable'> {
  /** Колонка, откуда начато перетаскивание (для вида заглушки). */
  originColumn: KanbanColumnKey | null;
}

export const DraggableTenderKanbanCard: FC<IDraggableTenderKanbanCardProps> = ({ originColumn, ...props }) => {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: props.tender.id,
    disabled: props.pending,
    attributes: { roleDescription: 'перетаскиваемый тендер' },
  });

  const variant: KanbanCardVariant = isDragging ? (props.column === originColumn ? 'source' : 'target') : 'default';

  return (
    <TenderKanbanCard
      {...props}
      draggable
      variant={variant}
      dragRef={setNodeRef}
      dragAttributes={attributes}
      dragListeners={listeners}
    />
  );
};
