// Admin user/role management helpers consumed by src/pages/Users/Users.tsx.
// Currently Supabase-only — only the user-self-register flow has a Go BFF
// endpoint (see src/lib/api/users.ts).

import { supabase } from '../supabase';

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

// ─── Tenders list (used by TenderAccess tab) ────────────────────────────────

export async function listTendersForUserAccess(): Promise<TenderListItem[]> {
  const { data, error } = await supabase
    .from('tenders')
    .select('id, tender_number, title, version')
    .order('submission_deadline', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TenderListItem[];
}

// ─── Users ──────────────────────────────────────────────────────────────────

export async function listPendingUsers(): Promise<PendingRequestRow[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role_code, registration_date, roles:role_code (name, color)')
    .eq('access_status', 'pending')
    .order('registration_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PendingRequestRow[];
}

export async function listAllUsers(): Promise<UserRow[]> {
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
  const { error } = await supabase.from('users').delete().eq('id', id);
  if (error) throw error;
}

export async function setUserAccessEnabled(id: string, enabled: boolean): Promise<void> {
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
  const { error } = await supabase.from('users').update(patch).eq('id', id);
  if (error) throw error;
}

export async function syncUsersAllowedPagesByRole(roleCode: string, allowedPages: string[]): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ allowed_pages: allowedPages })
    .eq('role_code', roleCode);
  if (error) throw error;
}

export async function countUsersWithRole(roleCode: string): Promise<number> {
  const { data, error } = await supabase.from('users').select('id').eq('role_code', roleCode);
  if (error) throw error;
  return data?.length ?? 0;
}

// ─── Notifications (admin → user notify) ───────────────────────────────────

export async function sendUserNotification(input: {
  userId: string;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  message: string;
}): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    user_id: input.userId,
    type: input.type,
    title: input.title,
    message: input.message,
    is_read: false,
  });
  if (error) throw error;
}

// ─── Roles ──────────────────────────────────────────────────────────────────

export async function listRoles(): Promise<RoleRow[]> {
  const { data, error } = await supabase.from('roles').select('*').order('name');
  if (error) throw error;
  return (data ?? []) as RoleRow[];
}

export async function updateRoleAllowedPages(code: string, allowedPages: string[]): Promise<void> {
  const { error } = await supabase
    .from('roles')
    .update({ allowed_pages: allowedPages, updated_at: new Date().toISOString() })
    .eq('code', code);
  if (error) throw error;
}

export async function deleteRole(code: string): Promise<void> {
  const { error } = await supabase.from('roles').delete().eq('code', code);
  if (error) throw error;
}

export async function findRoleByCode(code: string): Promise<RoleRow | null> {
  const { data, error } = await supabase.from('roles').select('*').eq('code', code).maybeSingle();
  if (error) throw error;
  return (data as RoleRow) ?? null;
}

export async function findRoleByName(name: string): Promise<RoleRow | null> {
  const { data, error } = await supabase.from('roles').select('*').eq('name', name).maybeSingle();
  if (error) throw error;
  return (data as RoleRow) ?? null;
}

export async function createRole(input: { code: string; name: string; color: string }): Promise<RoleRow> {
  const { data, error } = await supabase
    .from('roles')
    .insert([{ code: input.code, name: input.name, color: input.color }])
    .select()
    .single();
  if (error) throw error;
  return data as RoleRow;
}
