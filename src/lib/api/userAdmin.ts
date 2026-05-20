// Admin user/role management helpers consumed by src/pages/Users/Users.tsx.
// Go BFF endpoints under /api/v1/admin/* — Go-only.

import { apiFetch } from './client';

export interface PendingRequestRow {
  id: string;
  full_name: string;
  email: string;
  role_code: string;
  registration_date: string;
  roles: { name: string; color: string | null } | { name: string; color: string | null }[] | null;
}

export interface UserRow {
  id: string;
  full_name: string;
  email: string;
  role_code: string;
  access_status: string;
  allowed_pages: string[] | null;
  registration_date: string;
  approved_by?: string;
  approved_at?: string;
  password: string | null;
  access_enabled: boolean;
  roles?: { name: string; color: string | null } | { name: string; color: string | null }[] | null;
}

export interface RoleRow {
  code: string;
  name: string;
  allowed_pages: string[];
  is_system_role: boolean;
  color?: string;
  created_at: string;
  updated_at: string;
}

export interface TenderListItem {
  id: string;
  tender_number: string;
  title: string;
  version: number;
}

// ─── Tenders for the TenderAccess tab ───────────────────────────────────────

export async function listTendersForUserAccess(): Promise<TenderListItem[]> {
  const res = await apiFetch<{ data: TenderListItem[] }>('/api/v1/admin/tenders-for-access');
  return res.data ?? [];
}

export interface AccessUserRow {
  id: string;
  full_name: string;
  role_code: string;
  role_name: string;
  tender_deadline_extensions: { tender_id: string; extended_deadline: string }[];
}

export async function listAccessUsers(): Promise<AccessUserRow[]> {
  const res = await apiFetch<{ data: AccessUserRow[] }>('/api/v1/admin/access-users');
  return res.data ?? [];
}

/** Upsert (or remove when extendedDeadline === '') the per-tender extension for the given user_ids. */
export async function setTenderExtensionForUsers(input: {
  tender_id: string;
  user_ids: string[];
  extended_deadline: string;
}): Promise<void> {
  await apiFetch<undefined>('/api/v1/admin/tender-extensions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ─── Users ──────────────────────────────────────────────────────────────────

export async function listPendingUsers(): Promise<PendingRequestRow[]> {
  const res = await apiFetch<{ data: PendingRequestRow[] }>('/api/v1/admin/users/pending');
  return res.data ?? [];
}

export async function listAllUsers(): Promise<UserRow[]> {
  const res = await apiFetch<{ data: UserRow[] }>('/api/v1/admin/users');
  return res.data ?? [];
}

export async function approveUser(
  userId: string,
  _approvedBy: string,
  roleCode: string,
  allowedPages: string[],
): Promise<void> {
  await apiFetch<undefined>(`/api/v1/admin/users/${encodeURIComponent(userId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ role_code: roleCode, allowed_pages: allowedPages }),
  });
}

export async function deleteUser(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function setUserAccessEnabled(id: string, enabled: boolean): Promise<void> {
  await apiFetch<undefined>(`/api/v1/admin/users/${encodeURIComponent(id)}/access`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export async function updateUserProfile(
  id: string,
  patch: { full_name?: string; email?: string; role_code?: string; allowed_pages?: string[] },
): Promise<void> {
  await apiFetch<undefined>(`/api/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function syncUsersAllowedPagesByRole(roleCode: string, allowedPages: string[]): Promise<void> {
  await apiFetch<undefined>(
    `/api/v1/admin/users/by-role/${encodeURIComponent(roleCode)}/allowed-pages`,
    { method: 'PATCH', body: JSON.stringify({ allowed_pages: allowedPages }) },
  );
}

export async function countUsersWithRole(roleCode: string): Promise<number> {
  const res = await apiFetch<{ count: number }>(
    `/api/v1/admin/users/count-by-role?role_code=${encodeURIComponent(roleCode)}`,
  );
  return res.count ?? 0;
}

// ─── Notifications (admin → user notify) ───────────────────────────────────

export async function sendUserNotification(input: {
  userId: string;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  message: string;
}): Promise<void> {
  // Reuse the dedicated notifications helper to keep the Go call in one place.
  const { createSystemNotification } = await import('./notifications');
  await createSystemNotification({
    user_id: input.userId,
    type: input.type,
    title: input.title,
    message: input.message,
  });
}

// ─── Roles ──────────────────────────────────────────────────────────────────

export async function listRoles(): Promise<RoleRow[]> {
  const res = await apiFetch<{ data: RoleRow[] }>('/api/v1/admin/roles');
  return res.data ?? [];
}

export async function updateRoleAllowedPages(code: string, allowedPages: string[]): Promise<void> {
  await apiFetch<undefined>(
    `/api/v1/admin/roles/${encodeURIComponent(code)}/allowed-pages`,
    { method: 'PATCH', body: JSON.stringify({ allowed_pages: allowedPages }) },
  );
}

export async function deleteRole(code: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/admin/roles/${encodeURIComponent(code)}`, {
    method: 'DELETE',
  });
}

export async function findRoleByCode(code: string): Promise<RoleRow | null> {
  const res = await apiFetch<{ data: RoleRow | null }>(
    `/api/v1/admin/roles/by-code?code=${encodeURIComponent(code)}`,
  );
  return res.data ?? null;
}

export async function findRoleByName(name: string): Promise<RoleRow | null> {
  const res = await apiFetch<{ data: RoleRow | null }>(
    `/api/v1/admin/roles/by-name?name=${encodeURIComponent(name)}`,
  );
  return res.data ?? null;
}

export async function createRole(input: { code: string; name: string; color: string }): Promise<RoleRow> {
  const res = await apiFetch<{ data: RoleRow }>('/api/v1/admin/roles', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}
