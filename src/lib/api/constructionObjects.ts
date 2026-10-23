// Construction objects (страница «Объекты») — Go BFF only.

import type { IConstructionObject, IConstructionObjectInput } from '../types/types';
import { apiFetch } from './client';

const BASE_PATH = '/api/v1/construction-objects';

/** Все объекты, уже отсортированные сервером. */
export async function fetchConstructionObjects(): Promise<IConstructionObject[]> {
  const res = await apiFetch<{ data: IConstructionObject[] }>(BASE_PATH);
  return res.data ?? [];
}

export async function createConstructionObject(
  input: IConstructionObjectInput,
): Promise<IConstructionObject> {
  const res = await apiFetch<{ data: IConstructionObject }>(BASE_PATH, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

/** Полная замена полей объекта. */
export async function updateConstructionObject(
  id: string,
  input: IConstructionObjectInput,
): Promise<IConstructionObject> {
  const res = await apiFetch<{ data: IConstructionObject }>(`${BASE_PATH}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function deleteConstructionObject(id: string): Promise<void> {
  await apiFetch<undefined>(`${BASE_PATH}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Фото объектов ──

export interface IConstructionObjectPhoto {
  id: string;
  object_id: string;
  caption: string | null;
  width: number;
  height: number;
  size_bytes: number;
  sort_order: number;
  created_at: string;
}

export type ConstructionObjectPhotoSize = 'thumb' | 'full';

const PHOTOS_PATH = '/api/v1/construction-object-photos';
// Загрузка до 2 МБ по мобильной сети дольше обычных 10 секунд.
const UPLOAD_TIMEOUT_MS = 60_000;
const IMAGE_TIMEOUT_MS = 30_000;

export async function fetchObjectPhotos(objectId: string): Promise<IConstructionObjectPhoto[]> {
  const res = await apiFetch<{ data: IConstructionObjectPhoto[] }>(
    `${BASE_PATH}/${encodeURIComponent(objectId)}/photos`,
  );
  return res.data ?? [];
}

export interface IUploadObjectPhotoInput {
  file: Blob;
  thumb: Blob;
  width: number;
  height: number;
  caption?: string;
}

export async function uploadObjectPhoto(
  objectId: string,
  input: IUploadObjectPhotoInput,
): Promise<IConstructionObjectPhoto> {
  const form = new FormData();
  form.append('file', input.file, 'photo');
  form.append('thumb', input.thumb, 'thumb');
  form.append('width', String(input.width));
  form.append('height', String(input.height));
  if (input.caption) form.append('caption', input.caption);
  const res = await apiFetch<{ data: IConstructionObjectPhoto }>(
    `${BASE_PATH}/${encodeURIComponent(objectId)}/photos`,
    { method: 'POST', body: form, timeoutMs: UPLOAD_TIMEOUT_MS },
  );
  return res.data;
}

export async function updateObjectPhotoCaption(photoId: string, caption: string | null): Promise<void> {
  await apiFetch<unknown>(`${PHOTOS_PATH}/${encodeURIComponent(photoId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ caption }),
  });
}

export async function deleteObjectPhoto(photoId: string): Promise<void> {
  await apiFetch<undefined>(`${PHOTOS_PATH}/${encodeURIComponent(photoId)}`, { method: 'DELETE' });
}

/** Байты картинки: <img src> не подставит Authorization, поэтому качаем через apiFetch. */
export function fetchObjectPhotoImage(
  photoId: string,
  size: ConstructionObjectPhotoSize,
): Promise<Blob> {
  return apiFetch<Blob>(`${PHOTOS_PATH}/${encodeURIComponent(photoId)}/image?size=${size}`, {
    asBlob: true,
    timeoutMs: IMAGE_TIMEOUT_MS,
  });
}
