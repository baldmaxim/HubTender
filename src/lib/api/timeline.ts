// Timeline helpers with Go BFF / Supabase fallback.
// Timeline helpers — Go BFF only.
import type { TimelineUserRef } from '../supabase/types';
import { apiFetch } from './client';

export interface TimelineIterationInput {
  group_id: string;
  user_id: string;
  iteration_number: number;
  user_comment: string;
  user_amount: number | null;
}

/** Fetch users with id/full_name/role_code for the timeline assignment lists. */
export async function listTimelineAssignableUsers(): Promise<TimelineUserRef[]> {
  const res = await apiFetch<{ data: TimelineUserRef[] }>(
    '/api/v1/timeline/assignable-users',
  );
  return res.data ?? [];
}

/** Insert a tender_iterations row (manual user-side entry).
 *  user_id берётся сервером из JWT (не из body). */
export async function createTenderIteration(input: TimelineIterationInput): Promise<void> {
  await apiFetch<undefined>('/api/v1/timeline/iterations', {
    method: 'POST',
    body: JSON.stringify({
      group_id: input.group_id,
      iteration_number: input.iteration_number,
      user_comment: input.user_comment,
      user_amount: input.user_amount,
    }),
  });
}

/**
 * Set quality_level and quality_comment on a tender_group.
 * Go path: POST /api/v1/timeline/groups/:id/quality.
 * Supabase path: set_tender_group_quality RPC.
 */
export async function setTenderGroupQuality(
  groupId: string,
  qualityLevel: number | null,
  qualityComment: string | null,
): Promise<void> {
  await apiFetch<unknown>(`/api/v1/timeline/groups/${encodeURIComponent(groupId)}/quality`, {
    method: 'POST',
    body: JSON.stringify({
      quality_level: qualityLevel,
      quality_comment: qualityComment,
    }),
  });
}

/**
 * Respond to a tender iteration.
 * Go path: POST /api/v1/timeline/iterations/:id/respond.
 * Supabase path: respond_tender_iteration RPC.
 */
export async function respondTenderIteration(
  iterationId: string,
  managerComment: string,
  approvalStatus: 'pending' | 'approved' | 'rejected',
): Promise<void> {
  await apiFetch<unknown>(`/api/v1/timeline/iterations/${encodeURIComponent(iterationId)}/respond`, {
    method: 'POST',
    body: JSON.stringify({
      manager_comment: managerComment,
      approval_status: approvalStatus,
    }),
  });
}
