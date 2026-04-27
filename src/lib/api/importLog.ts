// Helpers for the Admin/ImportLog page (import_sessions, related users/tenders).
// Currently Supabase-only — no Go BFF endpoints exist for import_sessions.

import { supabase } from '../supabase';

export interface ImportSession {
  id: string;
  user_id: string;
  tender_id: string;
  file_name: string | null;
  items_count: number;
  imported_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  positions_snapshot: Array<{
    id: string;
    manual_volume: number | null;
    manual_note: string | null;
  }> | null;
}

export interface ImportLogUser {
  id: string;
  full_name: string;
  role_code: string;
  roles: { name: string; color: string | null } | null;
}

export interface ImportLogTender {
  id: string;
  title: string;
  tender_number: string;
}

export async function fetchImportSessions(tenderId?: string | null): Promise<ImportSession[]> {
  let query = supabase
    .from('import_sessions')
    .select(
      'id, user_id, tender_id, file_name, items_count, imported_at, cancelled_at, cancelled_by, positions_snapshot',
    )
    .order('imported_at', { ascending: false })
    .limit(200);

  if (tenderId) {
    query = query.eq('tender_id', tenderId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ImportSession[];
}

export async function fetchImportLogUsers(ids: string[]): Promise<ImportLogUser[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, role_code, roles:role_code (name, color)')
    .in('id', ids);
  if (error) throw error;
  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as {
      id: string;
      full_name: string;
      role_code: string;
      roles: { name: string; color: string | null } | { name: string; color: string | null }[] | null;
    };
    const role = Array.isArray(r.roles) ? r.roles[0] ?? null : r.roles;
    return { id: r.id, full_name: r.full_name, role_code: r.role_code, roles: role };
  });
}

export async function fetchImportLogTenders(ids: string[]): Promise<ImportLogTender[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('tenders')
    .select('id, title, tender_number')
    .in('id', ids);
  if (error) throw error;
  return (data ?? []) as ImportLogTender[];
}

export async function fetchAllTendersForFilter(): Promise<ImportLogTender[]> {
  const { data, error } = await supabase
    .from('tenders')
    .select('id, title, tender_number')
    .order('title');
  if (error) throw error;
  return (data ?? []) as ImportLogTender[];
}

export async function deleteBoqItemsForImportSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('boq_items')
    .delete()
    .eq('import_session_id', sessionId);
  if (error) throw error;
}

export async function restoreClientPositionFromSnapshot(snap: {
  id: string;
  manual_volume: number | null;
  manual_note: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('client_positions')
    .update({ manual_volume: snap.manual_volume, manual_note: snap.manual_note })
    .eq('id', snap.id);
  if (error) throw error;
}

export async function markImportSessionCancelled(sessionId: string, cancelledBy: string): Promise<void> {
  const { error } = await supabase
    .from('import_sessions')
    .update({
      cancelled_at: new Date().toISOString(),
      cancelled_by: cancelledBy,
    })
    .eq('id', sessionId);
  if (error) throw error;
}
