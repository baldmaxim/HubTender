// Projects domain helpers — Go BFF only.

import type { Tables } from '../types/database.types';
import type { ProjectInsert } from '../types/types';
import { apiFetch } from './client';

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
  await apiFetch<undefined>('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateProject(id: string, input: ProjectUpsertInput): Promise<void> {
  await apiFetch<undefined>(`/api/v1/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function softDeleteProject(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ─── Project reads (заменяют supabase.from в src/pages/Projects/) ──────────

export interface ProjectTenderEmbed {
  id: string;
  title: string;
  tender_number: string;
}

export interface ProjectWithTender {
  id: string;
  name: string;
  client_name: string;
  contract_cost: number;
  area: number | null;
  construction_end_date: string | null;
  contract_date: string | null;
  tender_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  tender: ProjectTenderEmbed | null;
}

/** Активные проекты + tender embed, новые первыми. */
export async function listProjects(): Promise<ProjectWithTender[]> {
  const res = await apiFetch<{ data: ProjectWithTender[] }>('/api/v1/projects');
  return res.data ?? [];
}

/** Один проект (любой is_active) + tender embed. */
export async function getProject(id: string): Promise<ProjectWithTender> {
  const res = await apiFetch<{ data: ProjectWithTender }>(
    `/api/v1/projects/${encodeURIComponent(id)}`,
  );
  return res.data;
}

/** Все доп. соглашения (клиент маппит по project_id). */
export async function listAllProjectAgreements(): Promise<ProjectAgreementRow[]> {
  const res = await apiFetch<{ data: ProjectAgreementRow[] }>('/api/v1/project-agreements');
  return res.data ?? [];
}

/** Помесячное выполнение; без projectId — по всем проектам. */
export async function listProjectMonthlyCompletion(
  projectId?: string,
): Promise<ProjectMonthlyCompletionRow[]> {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  const res = await apiFetch<{ data: ProjectMonthlyCompletionRow[] }>(
    `/api/v1/project-monthly-completion${qs}`,
  );
  return res.data ?? [];
}

// ─── Project additional agreements ─────────────────────────────────────────

export async function listProjectAgreements(
  projectId: string,
  order: 'asc' | 'desc' = 'desc',
): Promise<ProjectAgreementRow[]> {
  const res = await apiFetch<{ data: ProjectAgreementRow[] }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/agreements?order=${order}`,
  );
  return res.data ?? [];
}

export interface ProjectAgreementInput {
  project_id: string;
  agreement_date: string;
  amount: number;
  description?: string | null;
  agreement_number?: string | null;
}

export async function createProjectAgreement(input: ProjectAgreementInput): Promise<void> {
  await apiFetch<undefined>('/api/v1/project-agreements', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface ProjectAgreementUpdate {
  agreement_number?: string | null;
  agreement_date?: string;
  amount?: number;
  description?: string | null;
}

export async function updateProjectAgreement(id: string, patch: ProjectAgreementUpdate): Promise<void> {
  await apiFetch<undefined>(`/api/v1/project-agreements/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteProjectAgreement(id: string): Promise<void> {
  await apiFetch<undefined>(`/api/v1/project-agreements/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
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
  await apiFetch<undefined>('/api/v1/project-monthly-completion', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateProjectMonthlyCompletion(
  id: string,
  patch: { actual_amount: number; forecast_amount: number | null; note: string | null },
): Promise<void> {
  await apiFetch<undefined>(
    `/api/v1/project-monthly-completion/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}

// ─── Tenders for ProjectSettings (active only) ─────────────────────────────

export interface TenderForProjectSelect {
  id: string;
  title: string;
  tender_number: string;
  client_name: string;
}

export async function listActiveTendersForProjectSelect(): Promise<TenderForProjectSelect[]> {
  const res = await apiFetch<{ data: TenderForProjectSelect[] }>(
    '/api/v1/projects/active-tenders',
  );
  return res.data ?? [];
}
