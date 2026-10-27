import { useEffect, useRef, useState } from 'react';
import type { FC, KeyboardEvent, PointerEvent } from 'react';
import { Image } from 'antd';
import { LeftOutlined, PictureOutlined, RightOutlined } from '@ant-design/icons';
import type { IConstructionObjectPhoto } from '../../../lib/api/constructionObjects';
import { usePhotoPreview } from '../hooks/usePhotoPreview';
import { usePhotoUrl } from '../hooks/usePhotoUrl';
import { loadPhotoUrl } from '../utils/photoCache';
import { loadObjectPhotoList } from '../utils/photoListCache';
import styles from './PopupCarousel.module.css';

interface IPopupCarouselProps {
  objectId: string;
  objectName: string;
  photoCount: number;
  /** Первое фото — показывается сразу, пока не пришёл полный список. */
  coverPhotoId: string;
}

/** Горизонтальный сдвиг пальцем/мышью, после которого кадр переключается. */
const SWIPE_THRESHOLD_PX = 40;

interface ISwipeStart {
  x: number;
  y: number;
  id: number;
}

/** Мини-карусель фото в попапе карты: стрелки, свайп, клавиши ←/→, просмотр на весь экран. */
export const PopupCarousel: FC<IPopupCarouselProps> = ({ objectId, objectName, photoCount, coverPhotoId }) => {
  const [photos, setPhotos] = useState<IConstructionObjectPhoto[] | null>(null);
  const [index, setIndex] = useState(0);
  const regionRef = useRef<HTMLDivElement | null>(null);
  const swipeRef = useRef<ISwipeStart | null>(null);
  const swipedRef = useRef(false);
  const preview = usePhotoPreview(photos ?? [], objectName);

  useEffect(() => {
    let alive = true;
    loadObjectPhotoList(objectId, photoCount).then(
      (list) => alive && setPhotos(list),
      () => undefined, // остаётся обложка
    );
    return () => {
      alive = false;
    };
  }, [objectId, photoCount]);

  const total = photos?.length ?? photoCount;
  const multi = total > 1;
  const current = photos?.[index] ?? null;
  const photoId = current?.id ?? coverPhotoId;
  const { url, failed } = usePhotoUrl(photoId, 'thumb');

  // Соседние кадры подгружаем заранее.
  useEffect(() => {
    if (!photos || photos.length < 2) return;
    for (const i of [index + 1, index - 1]) {
      const neighbour = photos[(i + photos.length) % photos.length];
      loadPhotoUrl(neighbour.id, 'thumb').catch(() => undefined);
    }
  }, [photos, index]);

  // Клавиши работают сразу после открытия попапа.
  const loaded = photos !== null && photos.length > 1;
  useEffect(() => {
    if (loaded) regionRef.current?.focus({ preventScroll: true });
  }, [loaded]);

  const go = (step: number) => {
    if (!photos || photos.length < 2) return;
    setIndex((i) => (i + step + photos.length) % photos.length);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    // Стрелки иначе двигали бы карту (клавиатурный обработчик Leaflet).
    e.stopPropagation();
    e.preventDefault();
    go(e.key === 'ArrowLeft' ? -1 : 1);
  };

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    swipeRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swipedRef.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // захват недоступен — свайп завершится по pointerup над кадром
    }
  };

  const handlePointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
      swipedRef.current = true; // следующий click — часть жеста, просмотр не открываем
      go(dx < 0 ? 1 : -1);
    }
  };

  const handleClick = () => {
    if (swipedRef.current) {
      swipedRef.current = false;
      return;
    }
    if (photos && photos.length > 0) preview.show(index);
  };

  const caption = current?.caption ?? null;

  return (
    <>
      <div
        ref={regionRef}
        className={styles.carousel}
        role="group"
        aria-roledescription="карусель"
        aria-label={`Фото объекта: ${objectName}`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.stage}>
          <button
            type="button"
            className={styles.frame}
            aria-label={`Открыть фото ${index + 1} из ${total}`}
            onClick={handleClick}
            onPointerDown={handlePointerDown}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
              swipeRef.current = null;
            }}
          >
            {url ? (
              <img key={photoId} className={styles.img} src={url} alt={caption ?? objectName} draggable={false} />
            ) : failed ? (
              <span className={styles.failed} role="img" aria-label="Фото не загрузилось">
                <PictureOutlined />
              </span>
            ) : null}
          </button>
          {multi && (
            <>
              <button
                type="button"
                className={`${styles.arrow} ${styles.prev}`}
                aria-label="Предыдущее фото"
                onClick={() => go(-1)}
              >
                <span className={styles.arrowDisc}>
                  <LeftOutlined />
                </span>
              </button>
              <button
                type="button"
                className={`${styles.arrow} ${styles.next}`}
                aria-label="Следующее фото"
                onClick={() => go(1)}
              >
                <span className={styles.arrowDisc}>
                  <RightOutlined />
                </span>
              </button>
            </>
          )}
        </div>
        {photoCount > 1 && (
          <div className={styles.meta}>
            <span className={styles.caption} title={caption ?? undefined}>
              {caption}
            </span>
            <span className={styles.counter} aria-live="polite">
              {index + 1} / {total}
            </span>
          </div>
        )}
      </div>
      <Image.PreviewGroup
        items={preview.items}
        preview={{
          visible: preview.open,
          current: preview.current,
          onVisibleChange: (visible) => {
            if (!visible) preview.hide();
          },
          onChange: preview.change,
        }}
      />
    </>
  );
};
