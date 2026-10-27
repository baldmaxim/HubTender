import { useMemo } from 'react';
import type { FC, ReactNode } from 'react';
import { Skeleton } from 'antd';
import type { IConstructionObject } from '../../../lib/types/types';
import { Glyph } from './Glyph';
import { ObjectCard } from './ObjectCard';
import styles from './ObjectCard.module.css';

interface IObjectsListProps {
  objects: IConstructionObject[];
  selectedId: string | null;
  loading: boolean;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onEdit: (item: IConstructionObject) => void;
  onPhotos: (item: IConstructionObject) => void;
  onDocuments: (item: IConstructionObject) => void;
  onDelete: (item: IConstructionObject) => Promise<void>;
}

const SKELETON_COUNT = 6;

/** Заглушка загрузки в форме карточек. */
export const ObjectsListSkeleton: FC = () => (
  <div className={styles.grid} aria-busy="true">
    {Array.from({ length: SKELETON_COUNT }, (_, i) => (
      <div key={i} className={`${styles.card} ${styles.cardSkeleton}`}>
        <Skeleton active avatar={{ shape: 'square', size: 32 }} paragraph={{ rows: 2 }} title={false} />
      </div>
    ))}
  </div>
);

const EmptyState: FC = () => (
  <div className={styles.empty}>
    <span className={styles.emptyIcon}>
      <Glyph name="mapOff" size={28} />
    </span>
    <div className={styles.emptyTitle}>Объектов не найдено</div>
    <div className={styles.emptyHint}>Измените фильтр или строку поиска.</div>
  </div>
);

interface ISectionProps {
  title: string;
  status: 'current' | 'archive';
  count: number;
  children: ReactNode;
}

const Section: FC<ISectionProps> = ({ title, status, count, children }) => (
  <section className={styles.section}>
    <div className={styles.sectionHead}>
      <i className={`${styles.sectionDot} ${status === 'current' ? styles.dotCurrent : styles.dotArchive}`} />
      <h2 className={styles.sectionTitle}>{title}</h2>
      <span className={styles.sectionCount}>{count}</span>
    </div>
    <div className={styles.grid}>{children}</div>
  </section>
);

export const ObjectsList: FC<IObjectsListProps> = ({
  objects,
  selectedId,
  loading,
  readOnly,
  onSelect,
  onHover,
  onEdit,
  onPhotos,
  onDocuments,
  onDelete,
}) => {
  const { current, archive } = useMemo(
    () => ({
      current: objects.filter((o) => o.status === 'current'),
      archive: objects.filter((o) => o.status === 'archive'),
    }),
    [objects],
  );

  if (objects.length === 0) return loading ? <ObjectsListSkeleton /> : <EmptyState />;

  const renderCard = (o: IConstructionObject) => (
    <ObjectCard
      key={o.id}
      object={o}
      selected={o.id === selectedId}
      readOnly={readOnly}
      onSelect={onSelect}
      onHover={onHover}
      onEdit={onEdit}
      onPhotos={onPhotos}
      onDocuments={onDocuments}
      onDelete={onDelete}
    />
  );

  return (
    <div className={styles.list}>
      {current.length > 0 && (
        <Section title="В работе" status="current" count={current.length}>
          {current.map(renderCard)}
        </Section>
      )}
      {archive.length > 0 && (
        <Section title="Построенные" status="archive" count={archive.length}>
          {archive.map(renderCard)}
        </Section>
      )}
    </div>
  );
};
