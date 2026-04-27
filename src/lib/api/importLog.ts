// Import sessions log helpers with Go BFF / Supabase fallback.
// On the Go path the cancel flow is one atomic transaction; on Supabase the
// frontend composes delete+restore+mark calls itself (legacy behaviour).

import { supabase } from '../supabase';
import { apiFetch } from './client';
import { isGoEnabled } from './featureFlags';

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

export interface CancelImportSessionResult {
  boq_deleted: number;
  positions_restored: number;
}

export async function fetchImportSessions(tenderId?: string | null): Promise<ImportSession[]> {
  if (isGoEnabled('importLog')) {
    const qs = tenderId ? `?tender_id=${encodeURIComponent(tenderId)}` : '';
    const res = await apiFetch<{ data: ImportSession[] }>(`/api/v1/import-sessions${qs}`);
    return res.data ?? [];
  }

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
  if (isGoEnabled('importLog')) {
    const qs = encodeURIComponent(ids.join(','));
    const res = await apiFetch<{ data: ImportLogUser[] }>(
      `/api/v1/import-sessions/users?ids=${qs}`,
    );
    return res.data ?? [];
  }

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
  if (isGoEnabled('importLog')) {
    const qs = encodeURIComponent(ids.join(','));
    const res = await apiFetch<{ data: ImportLogTender[] }>(
      `/api/v1/import-sessions/tenders?ids=${qs}`,
    );
    return res.data ?? [];
  }
  const { data, error } = await supabase
    .from('tenders')
    .select('id, title, tender_number')
    .in('id', ids);
  if (error) throw error;
  return (data ?? []) as ImportLogTender[];
}

export async function fetchAllTendersForFilter(): Promise<ImportLogTender[]> {
  if (isGoEnabled('importLog')) {
    const res = await apiFetch<{ data: ImportLogTender[] }>(
      '/api/v1/import-sessions/all-tenders',
    );
    return res.data ?? [];
  }
  const { data, error } = await supabase
    .from('tenders')
    .select('id, title, tender_number')
    .order('title');
  if (error) throw error;
  return (data ?? []) as ImportLogTender[];
}

/**
 * Cancel an import session. Go path performs delete+restore+mark in a single
 * transaction; Supabase fallback composes the three writes from the client
 * (preserves the legacy behaviour).
 */
export async function cancelImportSession(
  session: ImportSession,
  cancelledBy: string,
): Promise<CancelImportSessionResult> {
  if (isGoEnabled('importLog')) {
    const res = await apiFetch<{ data: CancelImportSessionResult }>(
      `/api/v1/import-sessions/${encodeURIComponent(session.id)}/cancel`,
      { method: 'POST' },
    );
    return res.data;
  }

  const { error: deleteError } = await supabase
    .from('boq_items')
    .delete()
    .eq('import_session_id', session.id);
  if (deleteError) throw deleteError;

  let restored = 0;
  if (session.positions_snapshot && session.positions_snapshot.length > 0) {
    for (const snap of session.positions_snapshot) {
      const { error } = await supabase
        .from('client_positions')
        .update({ manual_volume: snap.manual_volume, manual_note: snap.manual_note })
        .eq('id', snap.id);
      if (error) throw error;
      restored++;
    }
  }

  const { error: updateError } = await supabase
    .from('import_sessions')
    .update({ cancelled_at: new Date().toISOString(), cancelled_by: cancelledBy })
    .eq('id', session.id);
  if (updateError) throw updateError;

  return { boq_deleted: session.items_count, positions_restored: restored };
}
