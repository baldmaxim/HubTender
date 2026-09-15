// Конвейер проверки: привязка Telegram и рассылка замечаний исполнителям.
// Бот живёт в Go BFF (backend/internal/notify/telegram); отправка — только по
// кнопке проверяющего, адресат находки определяется по истории правок строк.
import { apiFetch } from './client';

export interface TelegramStatus {
  /** false — на сервере не задан бот, привязка и рассылка недоступны. */
  enabled: boolean;
  bot_username?: string;
  linked: boolean;
  telegram_username: string | null;
  linked_at: string | null;
}

export interface TelegramLinkToken {
  deep_link: string;
  expires_at: string;
}

export type DispatchResolver = 'item_author' | 'position_author' | 'sender';

export interface DispatchRecipient {
  user_id: string;
  full_name: string;
  linked: boolean;
  findings: number;
  already_sent: number;
  by_resolver: Partial<Record<DispatchResolver, number>>;
}

export interface DispatchResult {
  recipients: DispatchRecipient[];
  queued: number;
  messages: number;
  duplicates: number;
  unlinked: number;
}

export async function fetchTelegramStatus(): Promise<TelegramStatus> {
  const res = await apiFetch<{ data: TelegramStatus }>('/api/v1/me/telegram');
  return res.data;
}

export async function createTelegramLink(): Promise<TelegramLinkToken> {
  const res = await apiFetch<{ data: TelegramLinkToken }>('/api/v1/me/telegram/link', { method: 'POST' });
  return res.data;
}

export async function unlinkTelegram(): Promise<void> {
  await apiFetch<void>('/api/v1/me/telegram', { method: 'DELETE' });
}

export async function previewDispatch(tenderId: string, findingIds: string[]): Promise<DispatchRecipient[]> {
  const res = await apiFetch<{ data: DispatchRecipient[] }>(
    `/api/v1/tenders/${tenderId}/verification/dispatch/preview`,
    { method: 'POST', body: JSON.stringify({ finding_ids: findingIds }), timeoutMs: 60_000 },
  );
  return res.data ?? [];
}

export async function dispatchFindings(tenderId: string, findingIds: string[]): Promise<DispatchResult> {
  const res = await apiFetch<{ data: DispatchResult }>(`/api/v1/tenders/${tenderId}/verification/dispatch`, {
    method: 'POST',
    body: JSON.stringify({ finding_ids: findingIds }),
    timeoutMs: 60_000,
  });
  return res.data;
}
