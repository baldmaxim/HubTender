import { useCallback, useState } from 'react';
import type { IConstructionObjectPhoto } from '../../../lib/api/constructionObjects';
import { loadPhotoUrl, peekPhotoUrl } from '../utils/photoCache';

// Прозрачный пиксель, пока ни миниатюра, ни полное фото не загружены.
const BLANK_SRC = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

export interface IPreviewItem {
  src: string;
  alt: string;
}

interface IUsePhotoPreview {
  open: boolean;
  current: number;
  items: IPreviewItem[];
  show: (index: number) => void;
  hide: () => void;
  change: (index: number) => void;
}

/** Полноразмерный просмотр группы фото: полные версии грузятся по требованию (текущая + соседние). */
export const usePhotoPreview = (photos: IConstructionObjectPhoto[], fallbackAlt: string): IUsePhotoPreview => {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(0);
  const [, setVersion] = useState(0);

  const ensureFull = useCallback(
    (index: number) => {
      for (const i of [index, index + 1, index - 1]) {
        const photo = photos[i];
        if (!photo || peekPhotoUrl(photo.id, 'full')) continue;
        // Ошибку не показываем: просмотр останется на миниатюре.
        loadPhotoUrl(photo.id, 'full').then(
          () => setVersion((v) => v + 1),
          () => undefined,
        );
      }
    },
    [photos],
  );

  const show = useCallback(
    (index: number) => {
      setCurrent(index);
      ensureFull(index);
      setOpen(true);
    },
    [ensureFull],
  );

  const change = useCallback(
    (index: number) => {
      setCurrent(index);
      ensureFull(index);
    },
    [ensureFull],
  );

  const items = photos.map((p) => ({
    src: peekPhotoUrl(p.id, 'full') ?? peekPhotoUrl(p.id, 'thumb') ?? BLANK_SRC,
    alt: p.caption ?? fallbackAlt,
  }));

  return { open, current, items, show, hide: useCallback(() => setOpen(false), []), change };
};
