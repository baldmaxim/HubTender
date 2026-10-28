import { useMemo } from 'react';
import type { FC } from 'react';
import { Tag } from 'antd';
import { parsePdRef, splitNote } from '../utils/pdRefs';
import type { IPdRef, NoteKind } from '../utils/pdRefs';
import styles from './BasisSection.module.css';

interface IBasisSectionProps {
  refs: string[];
  note: string | null;
}

const getSourceTag = (ref: IPdRef): { label: string; color?: string } => {
  if (ref.source === 'pd') return { label: ref.section ? `ПД · ${ref.section}` : 'ПД', color: 'blue' };
  if (ref.source === 'contract') return { label: 'Договор', color: 'gold' };
  return { label: 'Прочее' };
};

const KIND_CLASS: Record<NoteKind, string> = {
  assumption: styles.partAssumption,
  excluded: styles.partExcluded,
  normal: '',
};

export const BasisSection: FC<IBasisSectionProps> = ({ refs, note }) => {
  const parsed = useMemo(() => refs.map(parsePdRef), [refs]);
  const noteSplit = useMemo(() => (note ? splitNote(note) : null), [note]);
  const hasNote = noteSplit !== null && (noteSplit.title !== null || noteSplit.parts.length > 0);

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Основание</div>

      {parsed.length > 0 ? (
        <ul className={styles.refList}>
          {parsed.map((ref, i) => {
            const tag = getSourceTag(ref);
            // Шифр раздела уже в метке источника — не повторяем его в названии.
            const showDoc = !(ref.source === 'pd' && ref.doc === ref.section);
            return (
              <li key={`${i}-${ref.raw}`} className={styles.refCard} title={ref.raw}>
                <div className={styles.refHead}>
                  <Tag className={styles.tag} color={tag.color}>
                    {tag.label}
                  </Tag>
                  {showDoc && <span className={styles.refDoc}>{ref.doc}</span>}
                  {ref.location && <span className={styles.refLocation}>{ref.location}</span>}
                </div>
                {ref.detail && <div className={styles.refDetail}>{ref.detail}</div>}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={styles.muted}>Ссылок на ПД нет</div>
      )}

      {hasNote && noteSplit && (
        <div className={styles.note}>
          <div className={styles.noteTitle}>Пояснение</div>
          {noteSplit.title && <div className={styles.noteHeading}>{noteSplit.title}</div>}
          {noteSplit.parts.length > 0 && (
            <ul className={styles.partList}>
              {noteSplit.parts.map((part, i) => (
                <li key={`${i}-${part.text}`} className={`${styles.part} ${KIND_CLASS[part.kind]}`}>
                  {part.kind === 'assumption' && (
                    <Tag className={styles.tag} color="gold">
                      допущение
                    </Tag>
                  )}
                  {part.kind === 'excluded' && (
                    <Tag className={styles.tag} color="purple">
                      не входит / отдельно
                    </Tag>
                  )}
                  <span className={styles.partText}>{part.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
