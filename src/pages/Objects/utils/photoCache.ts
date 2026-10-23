import { fetchObjectPhotoImage } from '../../../lib/api/constructionObjects';
import type { ConstructionObjectPhotoSize } from '../../../lib/api/constructionObjects';

/**
 * Кэш object URL картинок (ключ photoId + size). Картинки требуют Authorization,
 * поэтому качаем через apiFetch → Blob → URL.createObjectURL.
 */
const MAX_ENTRIES = 160;
const MAX_PARALLEL = 4;

const urls = new Map<string, string>(); // порядок вставки = LRU
const pending = new Map<string, Promise<string>>();
const queue: (() => void)[] = [];
let active = 0;

const keyOf = (photoId: string, size: ConstructionObjectPhotoSize): string => `${photoId}:${size}`;

const runNext = (): void => {
  while (active < MAX_PARALLEL && queue.length > 0) {
    active += 1;
    queue.shift()?.();
  }
};

const limited = <T>(task: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    queue.push(() => {
      task()
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          runNext();
        });
    });
    runNext();
  });

const store = (key: string, url: string): void => {
  urls.set(key, url);
  while (urls.size > MAX_ENTRIES) {
    const oldest = urls.keys().next().value;
    if (oldest === undefined) break;
    const oldUrl = urls.get(oldest);
    urls.delete(oldest);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
  }
};

/** Уже загруженный URL или undefined. */
export const peekPhotoUrl = (photoId: string, size: ConstructionObjectPhotoSize): string | undefined =>
  urls.get(keyOf(photoId, size));

export const loadPhotoUrl = (photoId: string, size: ConstructionObjectPhotoSize): Promise<string> => {
  const key = keyOf(photoId, size);
  const cached = urls.get(key);
  if (cached) {
    urls.delete(key);
    urls.set(key, cached); // освежить позицию в LRU
    return Promise.resolve(cached);
  }
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const promise = limited(() => fetchObjectPhotoImage(photoId, size)).then((blob) => {
    const url = URL.createObjectURL(blob);
    if (pending.get(key) === promise) {
      pending.delete(key);
      store(key, url);
    } else {
      // Фото удалили, пока оно грузилось.
      URL.revokeObjectURL(url);
    }
    return url;
  });
  promise.catch(() => {
    if (pending.get(key) === promise) pending.delete(key);
  });
  pending.set(key, promise);
  return promise;
};

/** Фото удалено: освободить оба размера. */
export const forgetPhoto = (photoId: string): void => {
  for (const size of ['thumb', 'full'] as const) {
    const key = keyOf(photoId, size);
    pending.delete(key);
    const url = urls.get(key);
    if (url) {
      urls.delete(key);
      URL.revokeObjectURL(url);
    }
  }
};
