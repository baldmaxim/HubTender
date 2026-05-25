// Tasks (user_tasks) + per-user work settings — Go BFF only.

import { apiFetch } from './client';
import type {
  UserTaskWithRelations,
  TaskStatus,
  WorkMode,
  WorkStatus,
} from '../supabase/types/tasks';

export interface WorkSettings {
  current_work_mode: WorkMode;
  current_work_status: WorkStatus;
}

/** Tasks of one user (optionally excluding completed), newest first. */
export async function listUserTasks(
  userId: string,
  excludeCompleted = false,
): Promise<UserTaskWithRelations[]> {
  const qs = new URLSearchParams({ user_id: userId });
  if (excludeCompleted) qs.set('exclude_completed', '1');
  const res = await apiFetch<{ data: UserTaskWithRelations[] }>(
    `/api/v1/tasks?${qs.toString()}`,
    { cache: 'no-cache' },
  );
  return res.data ?? [];
}

/** All tasks (manager view; server enforces role). */
export async function listAllTasks(): Promise<UserTaskWithRelations[]> {
  const res = await apiFetch<{ data: UserTaskWithRelations[] }>(
    '/api/v1/tasks',
    { cache: 'no-cache' },
  );
  return res.data ?? [];
}

export async function createUserTask(input: {
  user_id: string;
  tender_id: string | null;
  description: string;
}): Promise<void> {
  await apiFetch<{ data: { id: string } }>('/api/v1/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateUserTask(
  id: string,
  patch: { task_status?: TaskStatus; completed_at?: string },
): Promise<void> {
  await apiFetch<void>(`/api/v1/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function getWorkSettings(userId: string): Promise<WorkSettings> {
  const res = await apiFetch<{ data: WorkSettings }>(
    `/api/v1/users/${encodeURIComponent(userId)}/work-settings`,
  );
  return res.data;
}

export async function setWorkSettings(
  userId: string,
  patch: Partial<WorkSettings>,
): Promise<void> {
  await apiFetch<void>(
    `/api/v1/users/${encodeURIComponent(userId)}/work-settings`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}
