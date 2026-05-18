import { useCallback, useEffect, useState } from 'react';
import { listTimelineTenderGroups } from '../../../lib/api/timeline';
import type {
  ApprovalStatus,
  TenderGroup,
  TenderGroupMemberWithUser,
} from '../../../lib/supabase/types';

type GroupIterationRow = {
  id: string;
  user_id: string;
  approval_status: ApprovalStatus;
  iteration_number: number;
};

type GroupResponseRow = TenderGroup & {
  tender_group_members: TenderGroupMemberWithUser[] | null;
  tender_iterations: GroupIterationRow[] | null;
};

export interface TimelineGroupItem extends TenderGroup {
  members: TenderGroupMemberWithUser[];
  iterationsCount: number;
  qualityScore: number;
  qualityLevel: number | null;
  iterationUserIds: string[];
  status: ApprovalStatus;
}

interface UseTenderGroupsResult {
  groups: TimelineGroupItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

function getQualityScore(qualityLevel: number | null | undefined): number {
  if (!qualityLevel || qualityLevel <= 0) {
    return 0;
  }

  return Math.round((qualityLevel / 3) * 100);
}

function getGroupStatus(iterations: GroupIterationRow[]): ApprovalStatus {
  const latestIterations = new Map<string, GroupIterationRow>();

  iterations.forEach((iteration) => {
    const current = latestIterations.get(iteration.user_id);
    if (!current || iteration.iteration_number > current.iteration_number) {
      latestIterations.set(iteration.user_id, iteration);
    }
  });

  const statuses = Array.from(latestIterations.values()).map((iteration) => iteration.approval_status);

  if (statuses.length === 0) {
    return 'pending';
  }

  if (statuses.some((status) => status === 'pending')) {
    return 'pending';
  }

  if (statuses.some((status) => status === 'rejected')) {
    return 'rejected';
  }

  return 'approved';
}

export function useTenderGroups(tenderId: string | null): UseTenderGroupsResult {
  const [groups, setGroups] = useState<TimelineGroupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!tenderId) {
      setGroups([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await listTimelineTenderGroups(tenderId);

      const normalized = ((data || []) as unknown as GroupResponseRow[]).map((group) => {
        const members = group.tender_group_members || [];
        const iterations = group.tender_iterations || [];

        return {
          id: group.id,
          tender_id: group.tender_id,
          name: group.name,
          color: group.color,
          sort_order: group.sort_order,
          quality_level: group.quality_level ?? null,
          quality_comment: group.quality_comment ?? null,
          quality_updated_by: group.quality_updated_by ?? null,
          quality_updated_at: group.quality_updated_at ?? null,
          created_at: group.created_at,
          updated_at: group.updated_at,
          members,
          iterationsCount: iterations.length,
          qualityScore: getQualityScore(group.quality_level),
          qualityLevel: group.quality_level ?? null,
          iterationUserIds: Array.from(new Set(iterations.map((iteration) => iteration.user_id))),
          status: getGroupStatus(iterations),
        };
      });

      setGroups(normalized);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить группы тендера';
      setError(message);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { groups, loading, error, refetch };
}
