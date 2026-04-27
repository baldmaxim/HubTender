// Projects domain helpers with Go BFF / Supabase fallback.

import { supabase } from '../supabase';
import type { Tables } from '../supabase/database.types';
import type { ProjectInsert } from '../supabase/types';
import { apiFetch } from './client';
import { isGoEnabled } from './featureFlags';

export type ProjectAgreementRow = Tables<'project_additional_agreements'>;
export type ProjectMonthlyCompletionRow = Tables<'project_monthly_completion'>;

// ─── Projects ───────────────────────────────────────────────────────────────

export interface ProjectUpsertInput {
  name?: string;
  client_name?: string;
  contract_cost?: number;
  area?: number | null;
  contract_date?: string | null;
  construction_end_date?: string | null;
  tender_id?: string | null;
}

export async function createProject(input: ProjectInsert): Promise<void> {
  if (isGoEnabled('projects')) {
    await apiFetch<undefined>('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return;
  }
  const { error } = await supabase.from('projects').insert([input]);
  if (error) throw error;
}

export async function updateProject(id: string, input: ProjectUpsertInput): Promise<void> {
  if (isGoEnabled('projects')) {
    await apiFetch<undefined>(`/api/v1/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    return;
  }
  const { error } = await supabase.from('projects').update(input).eq('id', id);
  if (error) throw error;
}

export async function softDeleteProject(id: string): Promise<void> {
  if (isGoEnabled('projects')) {
    await apiFetch<undefined>(`/api/v1/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return;
  }
  const { error } = await supabase.from('projects').update({ is_active: false }).eq('id', id);
  if (error) throw error;
}

// ─── Project additional agreements ─────────────────────────────────────────

export async function listProjectAgreements(
  projectId: string,
  order: 'asc' | 'desc' = 'desc',
): Promise<ProjectAgreementRow[]> {
  if (isGoEnabled('projects')) {
    const res = await apiFetch<{ data: ProjectAgreementRow[] }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/agreements?order=${order}`,
    );
    return res.data ?? [];
  }
  const { data, error } = await supabase
    .from('project_additional_agreements')
    .select('*')
    .eq('project_id', projectId)
    .order('agreement_date', { ascending: order === 'asc' });
  if (error) throw error;
  return (data ?? []) as ProjectAgreementRow[];
}

export interface ProjectAgreementInput {
  project_id: string;
  agreement_date: string;
  amount: number;
  description?: string | null;
  agreement_number?: string | null;
}

export async function createProjectAgreement(input: ProjectAgreementInput): Promise<void> {
  if (isGoEnabled('projects')) {
    await apiFetch<undefined>('/api/v1/project-agreements', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return;
  }
  const { error } = await supabase.from('project_additional_agreements').insert([input]);
  if (error) throw error;
}

export interface ProjectAgreementUpdate {
  agreement_number?: string | null;
  agreement_date?: string;
  amount?: number;
  description?: string | null;
}

export async function updateProjectAgreement(id: string, patch: ProjectAgreementUpdate): Promise<void> {
  if (isGoEnabled('projects')) {
    await apiFetch<undefined>(`/api/v1/project-agreements/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return;
  }
  const { error } = await supabase.from('project_additional_agreements').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteProjectAgreement(id: string): Promise<void> {
  if (isGoEnabled('projects')) {
    await apiFetch<undefined>(`/api/v1/project-agreements/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return;
  }
  const { error } = await supabase.from('project_additional_agreements').delete().eq('id', id);
  if (error) throw error;
}

// ─── Project monthly completion ────────────────────────────────────────────

export interface ProjectMonthlyCompletionInput {
  project_id: string;
  year: number;
  month: number;
  actual_amount: number;
  forecast_amount: number | null;
  note: string | null;
}

export async function createProjectMonthlyCompletion(
  input: ProjectMonthlyCompletionInput,
): Promise<void> {
  if (isGoEnabled('projects')) {
    await apiFetch<undefined>('/api/v1/project-monthly-completion', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return;
  }
  const { error } = await supabase.from('project_monthly_completion').insert([input]);
  if (error) throw error;
}

export async function updateProjectMonthlyCompletion(
  id: string,
  patch: { actual_amount: number; forecast_amount: number | null; note: string | null },
): Promise<void> {
  if (isGoEnabled('projects')) {
    await apiFetch<undefined>(
      `/api/v1/project-monthly-completion/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
    return;
  }
  const { error } = await supabase.from('project_monthly_completion').update(patch).eq('id', id);
  if (error) throw error;
}

// ─── Tenders for ProjectSettings (active only) ─────────────────────────────

export interface TenderForProjectSelect {
  id: string;
  title: string;
  tender_number: string;
  client_name: string;
}

export async function listActiveTendersForProjectSelect(): Promise<TenderForProjectSelect[]> {
  if (isGoEnabled('projects')) {
    const res = await apiFetch<{ data: TenderForProjectSelect[] }>(
      '/api/v1/projects/active-tenders',
    );
    return res.data ?? [];
  }
  const { data, error } = await supabase
    .from('tenders')
    .select('id, title, tender_number, client_name')
    .eq('is_archived', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TenderForProjectSelect[];
}
