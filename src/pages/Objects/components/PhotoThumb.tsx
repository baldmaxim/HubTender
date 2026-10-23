import { useEffect, useRef, useState } from 'react';
import type { FC } from 'react';
import { PictureOutlined } from '@ant-design/icons';
import { usePhotoUrl } from '../hooks/usePhotoUrl';
import styles from './PhotoThumb.module.css';

interface IPhotoThumbProps {
  photoId: string;
  alt: string;
}

/** Миниатюра, заполняющая родителя (соотношение задаёт родитель). Грузится, когда попала в экран. */
export const PhotoThumb: FC<IPhotoThumbProps> = ({ photoId, alt }) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const { url, failed } = usePhotoUrl(photoId, 'thumb', visible);

  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={boxRef} className={styles.box}>
      {url ? (
        <img className={styles.img} src={url} alt={alt} draggable={false} />
      ) : failed ? (
        <span className={styles.failed} role="img" aria-label="Фото не загрузилось">
          <PictureOutlined />
        </span>
      ) : (
        <span className={styles.skeleton} aria-hidden="true" />
      )}
    </div>
  );
};
