// Timeline helpers with Go BFF / Supabase fallback.
import { supabase } from '../supabase';
import type { TimelineUserRef } from '../supabase/types';
import { apiFetch } from './client';
import { isGoEnabled } from './featureFlags';

export interface TimelineIterationInput {
  group_id: string;
  user_id: string;
  iteration_number: number;
  user_comment: string;
  user_amount: number | null;
}

/** Fetch users with id/full_name/role_code for the timeline assignment lists. */
export async function listTimelineAssignableUsers(): Promise<TimelineUserRef[]> {
  const { data, error } = await supabase.from('users').select('id, full_name, role_code');
  if (error) throw error;
  return (data ?? []) as TimelineUserRef[];
}

/** Insert a tender_iterations row (manual user-side entry). */
export async function createTenderIteration(input: TimelineIterationInput): Promise<void> {
  const { error } = await supabase.from('tender_iterations').insert({
    group_id: input.group_id,
    user_id: input.user_id,
    iteration_number: input.iteration_number,
    user_comment: input.user_comment,
    user_amount: input.user_amount,
  });
  if (error) throw error;
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
  if (isGoEnabled('timeline')) {
    await apiFetch<unknown>(`/api/v1/timeline/groups/${encodeURIComponent(groupId)}/quality`, {
      method: 'POST',
      body: JSON.stringify({
        quality_level: qualityLevel,
        quality_comment: qualityComment,
      }),
    });
    return;
  }

  const { error } = await supabase.rpc('set_tender_group_quality', {
    p_group_id: groupId,
    p_quality_level: qualityLevel,
    p_quality_comment: qualityComment,
  });
  if (error) throw error;
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
  if (isGoEnabled('timeline')) {
    await apiFetch<unknown>(`/api/v1/timeline/iterations/${encodeURIComponent(iterationId)}/respond`, {
      method: 'POST',
      body: JSON.stringify({
        manager_comment: managerComment,
        approval_status: approvalStatus,
      }),
    });
    return;
  }

  const { error } = await supabase.rpc('respond_tender_iteration', {
    p_iteration_id: iterationId,
    p_manager_comment: managerComment,
    p_approval_status: approvalStatus,
  });
  if (error) throw error;
}
