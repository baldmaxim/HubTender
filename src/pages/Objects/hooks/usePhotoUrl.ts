import { useEffect, useState } from 'react';
import type { ConstructionObjectPhotoSize } from '../../../lib/api/constructionObjects';
import { loadPhotoUrl, peekPhotoUrl } from '../utils/photoCache';

interface IPhotoUrlState {
  key: string;
  url: string | null;
  failed: boolean;
}

interface IUsePhotoUrl {
  url: string | null;
  failed: boolean;
}

/** URL картинки из кэша; грузит, когда enabled (ленивая загрузка). */
export const usePhotoUrl = (
  photoId: string | null,
  size: ConstructionObjectPhotoSize,
  enabled = true,
): IUsePhotoUrl => {
  const key = photoId ? `${photoId}:${size}` : '';
  const [state, setState] = useState<IPhotoUrlState>({ key: '', url: null, failed: false });

  useEffect(() => {
    if (!photoId || !enabled) return;
    let alive = true;
    loadPhotoUrl(photoId, size).then(
      (url) => alive && setState({ key, url, failed: false }),
      () => alive && setState({ key, url: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [photoId, size, enabled, key]);

  if (!photoId) return { url: null, failed: false };
  const cached = peekPhotoUrl(photoId, size);
  if (cached) return { url: cached, failed: false };
  return state.key === key ? { url: state.url, failed: state.failed } : { url: null, failed: false };
};
