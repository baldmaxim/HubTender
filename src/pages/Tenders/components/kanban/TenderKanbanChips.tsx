import type { CSSProperties, FC } from 'react';
import type { KanbanColumnDef, KanbanColumnKey } from '../../utils/tenderKanban';

interface ITenderKanbanChipsProps {
  columns: Array<{ def: KanbanColumnDef; count: number; accent: string }>;
  /** Колонки, видимые в окне доски (подсвечиваются, если доска шире экрана). */
  visibleColumns: ReadonlySet<KanbanColumnKey>;
  hint: string | null;
  onSelect: (key: KanbanColumnKey) => void;
}

/** Навигация по колонкам, когда доска не помещается по ширине, и подсказка про перетаскивание. */
export const TenderKanbanChips: FC<ITenderKanbanChipsProps> = ({ columns, visibleColumns, hint, onSelect }) => (
  <div className="kb-toolbar">
    <nav className="kb-chips" aria-label="Колонки доски">
      {columns.map(({ def, count, accent }) => {
        const isVisible = visibleColumns.has(def.key);
        return (
          <button
            key={def.key}
            type="button"
            className={isVisible ? 'kb-chip kb-chip--visible' : 'kb-chip'}
            style={{ '--kb-accent': accent } as CSSProperties}
            aria-label={`${def.title}: ${count}`}
            aria-current={isVisible || undefined}
            onClick={() => onSelect(def.key)}
          >
            <span className="kb-chip__dot" aria-hidden />
            <span className="kb-chip__label">{def.title}</span>
            <span className="kb-chip__count">{count}</span>
          </button>
        );
      })}
    </nav>
    {hint ? <div className="kb-hint">{hint}</div> : null}
  </div>
);
