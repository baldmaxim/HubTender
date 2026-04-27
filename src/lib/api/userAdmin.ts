// Admin user/role management helpers consumed by src/pages/Users/Users.tsx.
// Go BFF endpoints land under /api/v1/admin/*; toggle via VITE_API_USERADMIN_ENABLED.

import { supabase } from '../supabase';
import { apiFetch } from './client';
import { isGoEnabled } from './featureFlags';

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
  if (isGoEnabled('userAdmin')) {
    const res = await apiFetch<{ data: TenderListItem[] }>('/api/v1/admin/tenders-for-access');
    return res.data ?? [];
  }
  const { data, error } = await supabase
    .from('tenders')
    .select('id, tender_number, title, version')
    .order('submission_deadline', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TenderListItem[];
}

// ─── Users ──────────────────────────────────────────────────────────────────

export async function listPendingUsers(): Promise<PendingRequestRow[]> {
  if (isGoEnabled('userAdmin')) {
    const res = await apiFetch<{ data: PendingRequestRow[] }>('/api/v1/admin/users/pending');
    return res.data ?? [];
  }
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role_code, registration_date, roles:role_code (name, color)')
    .eq('access_status', 'pending')
    .order('registration_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PendingRequestRow[];
}

export async function listAllUsers(): Promise<UserRow[]> {
  if (isGoEnabled('userAdmin')) {
    const res = await apiFetch<{ data: UserRow[] }>('/api/v1/admin/users');
    return res.data ?? [];
  }
  const { data, error } = await supabase
    .from('users')
    .select('*, roles:role_code (name, color)')
    .order('registration_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as UserRow[];
}

export async function approveUser(
  userId: string,
  approvedBy: string,
  roleCode: string,
  allowedPages: string[],
): Promise<void> {
  if (isGoEnabled('userAdmin')) {
    await apiFetch<undefined>(`/api/v1/admin/users/${encodeURIComponent(userId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ role_code: roleCode, allowed_pages: allowedPages }),
    });
    return;
  }
  const { error } = await supabase
    .from('users')
    .update({
      access_status: 'approved',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
      role_code: roleCode,
      allowed_pages: allowedPages,
    })
    .eq('id', userId);
  if (error) throw error;
}

export async function deleteUser(id: string): Promise<void> {
  if (isGoEnabled('userAdmin')) {
    await apiFetch<undefined>(`/api/v1/admin/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return;
  }
  const { error } = await supabase.from('users').delete().eq('id', id);
  if (error) throw error;
}

export async function setUserAccessEnabled(id: string, enabled: boolean): Promise<void> {
  if (isGoEnabled('userAdmin')) {
    await apiFetch<undefined>(`/api/v1/admin/users/${encodeURIComponent(id)}/access`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    return;
  }
  const { error } = await supabase
    .from('users')
    .update({ access_enabled: enabled })
    .eq('id', id);
  if (error) throw error;
}

export async function updateUserProfile(
  id: string,
  patch: { full_name?: string; email?: string; role_code?: string; allowed_pages?: string[] },
): Promise<void> {
  if (isGoEnabled('userAdmin')) {
    await apiFetch<undefined>(`/api/v1/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return;
  }
  const { error } = await supabase.from('users').update(patch).eq('id', id);
  if (error) throw error;
}

export async function syncUsersAllowedPagesByRole(roleCode: string, allowedPages: string[]): Promise<void> {
  if (isGoEnabled('userAdmin')) {
    await apiFetch<undefined>(
      `/api/v1/admin/users/by-role/${encodeURIComponent(roleCode)}/allowed-pages`,
      { method: 'PATCH', body: JSON.stringify({ allowed_pages: allowedPages }) },
    );
    return;
  }
  const { error } = await supabase
    .from('users')
    .update({ allowed_pages: allowedPages })
    .eq('role_code', roleCode);
  if (error) throw error;
}

export async function countUsersWithRole(roleCode: string): Promise<number> {
  if (isGoEnabled('userAdmin')) {
    const res = await apiFetch<{ count: number }>(
      `/api/v1/admin/users/count-by-role?role_code=${encodeURIComponent(roleCode)}`,
    );
    return res.count ?? 0;
  }
  const { data, error } = await supabase.from('users').select('id').eq('role_code', roleCode);
  if (error) throw error;
  return data?.length ?? 0;
}

// ─── Notifications (admin → user notify) ───────────────────────────────────
// Stays via createSystemNotification — already exposes a Go-aware path.

export async function sendUserNotification(input: {
  userId: string;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  message: string;
}): Promise<void> {
  // Reuse the dedicated notifications helper to keep the Go branch in one place.
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
  if (isGoEnabled('userAdmin')) {
    const res = await apiFetch<{ data: RoleRow[] }>('/api/v1/admin/roles');
    return res.data ?? [];
  }
  const { data, error } = await supabase.from('roles').select('*').order('name');
  if (error) throw error;
  return (data ?? []) as RoleRow[];
}

export async function updateRoleAllowedPages(code: string, allowedPages: string[]): Promise<void> {
  if (isGoEnabled('userAdmin')) {
    await apiFetch<undefined>(
      `/api/v1/admin/roles/${encodeURIComponent(code)}/allowed-pages`,
      { method: 'PATCH', body: JSON.stringify({ allowed_pages: allowedPages }) },
    );
    return;
  }
  const { error } = await supabase
    .from('roles')
    .update({ allowed_pages: allowedPages, updated_at: new Date().toISOString() })
    .eq('code', code);
  if (error) throw error;
}

export async function deleteRole(code: string): Promise<void> {
  if (isGoEnabled('userAdmin')) {
    await apiFetch<undefined>(`/api/v1/admin/roles/${encodeURIComponent(code)}`, {
      method: 'DELETE',
    });
    return;
  }
  const { error } = await supabase.from('roles').delete().eq('code', code);
  if (error) throw error;
}

export async function findRoleByCode(code: string): Promise<RoleRow | null> {
  if (isGoEnabled('userAdmin')) {
    const res = await apiFetch<{ data: RoleRow | null }>(
      `/api/v1/admin/roles/by-code?code=${encodeURIComponent(code)}`,
    );
    return res.data ?? null;
  }
  const { data, error } = await supabase.from('roles').select('*').eq('code', code).maybeSingle();
  if (error) throw error;
  return (data as RoleRow) ?? null;
}

export async function findRoleByName(name: string): Promise<RoleRow | null> {
  if (isGoEnabled('userAdmin')) {
    const res = await apiFetch<{ data: RoleRow | null }>(
      `/api/v1/admin/roles/by-name?name=${encodeURIComponent(name)}`,
    );
    return res.data ?? null;
  }
  const { data, error } = await supabase.from('roles').select('*').eq('name', name).maybeSingle();
  if (error) throw error;
  return (data as RoleRow) ?? null;
}

export async function createRole(input: { code: string; name: string; color: string }): Promise<RoleRow> {
  if (isGoEnabled('userAdmin')) {
    const res = await apiFetch<{ data: RoleRow }>('/api/v1/admin/roles', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res.data;
  }
  const { data, error } = await supabase
    .from('roles')
    .insert([{ code: input.code, name: input.name, color: input.color }])
    .select()
    .single();
  if (error) throw error;
  return data as RoleRow;
}
