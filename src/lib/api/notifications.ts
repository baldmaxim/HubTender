// System notifications helpers with Go BFF / Supabase fallback.

import { apiFetch } from './client';

export type SystemNotificationType = 'success' | 'info' | 'warning' | 'error' | 'pending';

export interface SystemNotificationInput {
  title: string;
  message: string;
  type?: SystemNotificationType;
  user_id?: string;
}

/**
 * Insert a notifications row.
 * Go path: POST /api/v1/notifications (returns 204).
 * Supabase path: direct insert.
 */
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
