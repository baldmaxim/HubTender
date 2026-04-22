// Timeline helpers with Go BFF / Supabase fallback.
import { supabase } from '../supabase';
import { apiFetch } from './client';
import { isGoEnabled } from './featureFlags';

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
