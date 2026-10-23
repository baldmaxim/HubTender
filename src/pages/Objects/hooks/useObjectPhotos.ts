import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import {
  deleteObjectPhoto,
  fetchObjectPhotos,
  updateObjectPhotoCaption,
  uploadObjectPhoto,
} from '../../../lib/api/constructionObjects';
import type { IConstructionObjectPhoto } from '../../../lib/api/constructionObjects';
import { compressImage } from '../utils/imageCompress';
import { forgetPhoto } from '../utils/photoCache';

export const MAX_PHOTOS_PER_OBJECT = 30;

export interface IPendingUpload {
  key: string;
  name: string;
  stage: 'compress' | 'upload';
}

interface IUseObjectPhotos {
  photos: IConstructionObjectPhoto[];
  loading: boolean;
  error: string | null;
  pending: IPendingUpload[];
  reloadList: () => Promise<void>;
  upload: (files: File[]) => Promise<void>;
  saveCaption: (photoId: string, caption: string) => Promise<boolean>;
  remove: (photoId: string) => Promise<void>;
}

const errorText = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message : fallback);

const bySortOrder = (a: IConstructionObjectPhoto, b: IConstructionObjectPhoto): number =>
  a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);

/** Список фото объекта и операции над ним. onChanged — обновить photo_count/cover_photo_id в списке объектов. */
export const useObjectPhotos = (objectId: string | null, onChanged: () => void): IUseObjectPhotos => {
  const [photos, setPhotos] = useState<IConstructionObjectPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<IPendingUpload[]>([]);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const objectRef = useRef(objectId);
  objectRef.current = objectId;
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const reloadList = useCallback(async () => {
    if (!objectId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchObjectPhotos(objectId);
      if (objectRef.current === objectId) setPhotos([...list].sort(bySortOrder));
    } catch (e) {
      if (objectRef.current === objectId) setError(errorText(e, 'Не удалось загрузить фото'));
    } finally {
      if (objectRef.current === objectId) setLoading(false);
    }
  }, [objectId]);

  useEffect(() => {
    setPhotos([]);
    setPending([]);
    if (objectId) void reloadList();
  }, [objectId, reloadList]);

  const upload = useCallback(
    async (files: File[]) => {
      if (!objectId) return;
      const free = MAX_PHOTOS_PER_OBJECT - photosRef.current.length;
      if (files.length > free) {
        message.warning(`На объект можно загрузить не более ${MAX_PHOTOS_PER_OBJECT} фото`);
      }
      const batch = files.slice(0, Math.max(free, 0));
      const entries = batch.map((file, i) => ({ file, key: `${Date.now()}-${i}-${file.name}` }));
      setPending((prev) => [...prev, ...entries.map((x) => ({ key: x.key, name: x.file.name, stage: 'compress' as const }))]);
      const setStage = (key: string, stage: IPendingUpload['stage']) =>
        setPending((prev) => prev.map((p) => (p.key === key ? { ...p, stage } : p)));

      let uploaded = 0;
      for (const { file, key } of entries) {
        try {
          const compressed = await compressImage(file);
          setStage(key, 'upload');
          const meta = await uploadObjectPhoto(objectId, compressed);
          uploaded += 1;
          if (objectRef.current === objectId) setPhotos((prev) => [...prev, meta].sort(bySortOrder));
        } catch (e) {
          message.error(`${file.name}: ${errorText(e, 'не удалось загрузить фото')}`);
        } finally {
          setPending((prev) => prev.filter((p) => p.key !== key));
        }
      }
      if (uploaded > 0) onChangedRef.current();
    },
    [objectId],
  );

  const saveCaption = useCallback(async (photoId: string, caption: string): Promise<boolean> => {
    const value = caption.trim();
    try {
      await updateObjectPhotoCaption(photoId, value === '' ? null : value);
      setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, caption: value === '' ? null : value } : p)));
      return true;
    } catch (e) {
      message.error(errorText(e, 'Не удалось сохранить подпись'));
      return false;
    }
  }, []);

  const remove = useCallback(async (photoId: string): Promise<void> => {
    try {
      await deleteObjectPhoto(photoId);
      forgetPhoto(photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      onChangedRef.current();
    } catch (e) {
      message.error(errorText(e, 'Не удалось удалить фото'));
    }
  }, []);

  return { photos, loading, error, pending, reloadList, upload, saveCaption, remove };
};
