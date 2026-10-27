import { fetchObjectPhotos } from '../../../lib/api/constructionObjects';
import type { IConstructionObjectPhoto } from '../../../lib/api/constructionObjects';

/** Списки фото объектов на время сессии (для карусели в попапе карты). */
const lists = new Map<string, Promise<IConstructionObjectPhoto[]>>();

export const bySortOrder = (a: IConstructionObjectPhoto, b: IConstructionObjectPhoto): number =>
  a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);

/** Фото добавили/удалили/переподписали — список придётся загрузить заново. */
export const invalidatePhotoList = (objectId: string): void => {
  lists.delete(objectId);
};

/** Список фото из кэша; если число фото не совпало с ожидаемым (объект изменился) — загружается заново. */
export const loadObjectPhotoList = async (
  objectId: string,
  expectedCount: number,
): Promise<IConstructionObjectPhoto[]> => {
  const cached = lists.get(objectId);
  if (cached) {
    try {
      const list = await cached;
      if (list.length === expectedCount) return list;
    } catch {
      // ниже — повторный запрос
    }
    if (lists.get(objectId) === cached) lists.delete(objectId);
  }
  const promise = fetchObjectPhotos(objectId).then((list) => [...list].sort(bySortOrder));
  lists.set(objectId, promise);
  promise.catch(() => {
    if (lists.get(objectId) === promise) lists.delete(objectId);
  });
  return promise;
};
