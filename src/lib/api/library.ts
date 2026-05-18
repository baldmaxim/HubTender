// Library page helpers (works_library / materials_library / templates /
// library_folders) — Go BFF only. Added incrementally per tab.

import type { Tables } from '../supabase/database.types';
import { apiFetch } from './client';

export interface LibraryNameEmbed {
  id: string;
  name: string;
  unit: string;
}

// ─── works_library ──────────────────────────────────────────────────────────

export type WorkLibraryRow = Tables<'works_library'> & {
  work_names: LibraryNameEmbed | null;
};

export interface WorkLibraryInput {
  work_name_id: string;
  item_type: string;
  unit_rate: number;
  currency_type: string;
}

/** works_library + work_names embed, newest first. */
export async function listWorksLibrary(): Promise<WorkLibraryRow[]> {
  const res = await apiFetch<{ data: WorkLibraryRow[] }>('/api/v1/library/works');
  return res.data ?? [];
}

export async function createWorkLibrary(input: WorkLibraryInput): Promise<void> {
  await apiFetch<undefined>('/api/v1/library/works', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateWorkLibrary(id: string, input: WorkLibraryInput): Promise<void> {
  await apiFetch<undefined>(`/api/v1/library/works/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteWorkLibrary(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/library/works/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
