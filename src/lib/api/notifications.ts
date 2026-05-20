// System notifications helpers (Go BFF).

import { apiFetch } from './client';

export type SystemNotificationType = 'success' | 'info' | 'warning' | 'error' | 'pending';

export interface SystemNotificationInput {
  title: string;
  message: string;
  type?: SystemNotificationType;
  user_id?: string;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

/** Insert a notifications row. POST /api/v1/notifications → 204. */
export async function createSystemNotification(input: SystemNotificationInput): Promise<void> {
  const type = input.type ?? 'info';

  await apiFetch<undefined>('/api/v1/notifications', {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      message: input.message,
      type,
      ...(input.user_id ? { user_id: input.user_id } : {}),
    }),
  });
}

/** GET /api/v1/notifications?limit=50 — newest first. */
export async function listNotifications(limit = 50): Promise<NotificationRow[]> {
  const res = await apiFetch<{ data: NotificationRow[] }>(
    `/api/v1/notifications?limit=${encodeURIComponent(String(limit))}`,
  );
  return res.data ?? [];
}

/** DELETE /api/v1/notifications — clear all rows. */
export async function deleteAllNotifications(): Promise<void> {
  await apiFetch<undefined>('/api/v1/notifications', { method: 'DELETE' });
}
