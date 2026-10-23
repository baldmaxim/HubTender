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
