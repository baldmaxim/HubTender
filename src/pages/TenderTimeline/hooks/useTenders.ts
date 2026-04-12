import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { ApprovalStatus } from '../../../lib/supabase/types';

const EXCLUDED_TENDER_NUMBERS = new Set([
  '306-TEST-V2-20260407174128',
  '306-TEST-V2-20260407174613',
]);

const EXCLUDED_TENDER_TITLES = new Set([
  'ЖК Муза (Генподряд) [ТЕСТ КОПИЯ v2]',
  'ЖК Муза (Генподряд) [TEST copy v2]',
]);

type IterationScoreRow = {
  id: string;
  user_id: string;
  iteration_number: number;
  approval_status: ApprovalStatus;
  submitted_at: string;
  manager_responded_at: string | null;
};

type GroupRow = {
  id: string;
  name: string;
  color: string;
  quality_level?: number | null;
  tender_iterations: IterationScoreRow[] | null;
};

type TenderRow = {
  id: string;
  title: string;
  tender_number: string;
  submission_deadline: string | null;
  is_archived?: boolean | null;
  version?: number | null;
  created_at: string;
  tender_groups: GroupRow[] | null;
};

type TenderRegistryRow = {
  id: string;
  title: string;
  tender_number?: string | null;
  submission_date?: string | null;
  sort_order: number;
  is_archived: boolean;
};

export interface TimelineTenderListItem {
  id: string;
  title: string;
  tender_number: string;
  submission_deadline: string | null;
  is_archived: boolean;
  overallScore: number;
  qualityLevel: number | null;
  groupsCount: number;
  status: ApprovalStatus;
  lastActivityAt: string | null;
}

interface UseTendersResult {
  tenders: TimelineTenderListItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

function getLatestIterationStatuses(groups: GroupRow[] = []): ApprovalStatus[] {
  const latestIterations = new Map<string, IterationScoreRow>();

  groups.forEach((group) => {
    (group.tender_iterations || []).forEach((iteration) => {
      const key = `${group.id}:${iteration.user_id}`;
      const current = latestIterations.get(key);

      if (!current || iteration.iteration_number > current.iteration_number) {
        latestIterations.set(key, iteration);
      }
    });
  });

  return Array.from(latestIterations.values()).map((iteration) => iteration.approval_status);
}

function getQualityLevel(groups: GroupRow[] = []): number | null {
  const qualityLevels = groups
    .map((group) => group.quality_level)
    .filter((level): level is number => typeof level === 'number' && level >= 1 && level <= 10);

  if (qualityLevels.length === 0) {
    return null;
  }

  const average = qualityLevels.reduce((sum, level) => sum + level, 0) / qualityLevels.length;
  return Math.round(average * 10) / 10;
}

function getOverallScore(groups: GroupRow[] = []): number {
  const qualityLevel = getQualityLevel(groups);

  if (qualityLevel == null) {
    return 0;
  }

  return Math.round(qualityLevel * 10);
}

function getGroupsCount(groups: GroupRow[] = []): number {
  return groups.filter((group) => (group.tender_iterations || []).length > 0).length;
}

function getLastActivityAt(groups: GroupRow[] = []): string | null {
  const timestamps = groups
    .flatMap((group) => group.tender_iterations || [])
    .flatMap((iteration) => [iteration.submitted_at, iteration.manager_responded_at].filter(Boolean) as string[]);

  if (timestamps.length === 0) {
    return null;
  }

  return timestamps.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
}

function getTenderStatus(groups: GroupRow[] = []): ApprovalStatus {
  const latestStatuses = getLatestIterationStatuses(groups);

  if (latestStatuses.length === 0) {
    return 'pending';
  }

  if (latestStatuses.some((status) => status === 'pending')) {
    return 'pending';
  }

  if (latestStatuses.some((status) => status === 'rejected')) {
    return 'rejected';
  }

  if (latestStatuses.some((status) => status === 'approved')) {
    return 'approved';
  }

  return 'pending';
}

function pickLatestTenderVersion(tenders: TenderRow[]): Map<string, TenderRow> {
  const latestByNumber = new Map<string, TenderRow>();

  tenders.forEach((tender) => {
    const current = latestByNumber.get(tender.tender_number);

    if (!current) {
      latestByNumber.set(tender.tender_number, tender);
      return;
    }

    const currentVersion = current.version ?? 0;
    const nextVersion = tender.version ?? 0;

    if (nextVersion > currentVersion) {
      latestByNumber.set(tender.tender_number, tender);
      return;
    }

    if (nextVersion === currentVersion && new Date(tender.created_at).getTime() > new Date(current.created_at).getTime()) {
      latestByNumber.set(tender.tender_number, tender);
    }
  });

  return latestByNumber;
}

function dedupeRegistryRowsByTenderNumber(rows: TenderRegistryRow[]): TenderRegistryRow[] {
  const uniqueByNumber = new Map<string, TenderRegistryRow>();

  rows.forEach((row) => {
    const tenderNumber = row.tender_number?.trim();

    if (!tenderNumber || uniqueByNumber.has(tenderNumber)) {
      return;
    }

    uniqueByNumber.set(tenderNumber, row);
  });

  return Array.from(uniqueByNumber.values());
}

function isExcludedTender(title: string, tenderNumber: string): boolean {
  return EXCLUDED_TENDER_NUMBERS.has(tenderNumber.trim()) || EXCLUDED_TENDER_TITLES.has(title.trim());
}

function sortTendersByNumber(tenders: TimelineTenderListItem[]): TimelineTenderListItem[] {
  return [...tenders].sort((left, right) => {
    const byNumber = left.tender_number.localeCompare(right.tender_number, 'ru-RU', {
      numeric: true,
      sensitivity: 'base',
    });

    if (byNumber !== 0) {
      return byNumber;
    }

    return left.title.localeCompare(right.title, 'ru-RU', { sensitivity: 'base' });
  });
}

export function useTenders(): UseTendersResult {
  const [tenders, setTenders] = useState<TimelineTenderListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: registryData, error: registryError } = await supabase
        .from('tender_registry')
        .select(`
          id,
          title,
          tender_number,
          submission_date,
          sort_order,
          is_archived
        `)
        .order('sort_order', { ascending: true });

      if (registryError) {
        throw registryError;
      }

      const registryRows = dedupeRegistryRowsByTenderNumber((registryData || []) as TenderRegistryRow[]).filter(
        (row) => !isExcludedTender(row.title || '', row.tender_number || '')
      );
      const tenderNumbers = Array.from(
        new Set(
          registryRows
            .map((row) => row.tender_number)
            .filter((tenderNumber): tenderNumber is string => Boolean(tenderNumber))
        )
      );

      if (tenderNumbers.length === 0) {
        setTenders([]);
        return;
      }

      const { data: tendersData, error: tendersError } = await supabase
        .from('tenders')
        .select(`
          id,
          title,
          tender_number,
          submission_deadline,
          is_archived,
          version,
          created_at,
          tender_groups (
            id,
            name,
            color,
            quality_level,
            tender_iterations (
              id,
              user_id,
              iteration_number,
              approval_status,
              submitted_at,
              manager_responded_at
            )
          )
        `)
        .in('tender_number', tenderNumbers);

      if (tendersError) {
        throw tendersError;
      }

      const latestTendersByNumber = pickLatestTenderVersion((tendersData || []) as TenderRow[]);

      const normalized = registryRows
        .filter((registryRow) => {
          if (!registryRow.tender_number) {
            return false;
          }

          return latestTendersByNumber.has(registryRow.tender_number);
        })
        .map((registryRow) => {
        const tender = registryRow.tender_number
          ? latestTendersByNumber.get(registryRow.tender_number) || null
          : null;
        const groups = tender?.tender_groups || [];
        const overallScore = getOverallScore(groups);
        const qualityLevel = getQualityLevel(groups);

        return {
          id: tender?.id || registryRow.id,
          title: tender?.title || registryRow.title,
          tender_number: tender?.tender_number || registryRow.tender_number || '—',
          submission_deadline: tender?.submission_deadline || registryRow.submission_date || null,
          is_archived: Boolean(registryRow.is_archived ?? tender?.is_archived),
          overallScore,
          qualityLevel,
          groupsCount: getGroupsCount(groups),
          status: tender ? getTenderStatus(groups) : 'pending',
          lastActivityAt: tender ? getLastActivityAt(groups) : null,
        };
        })
        .filter((tender) => !isExcludedTender(tender.title, tender.tender_number));

      setTenders(sortTendersByNumber(normalized));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить тендеры';
      setError(message);
      setTenders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { tenders, loading, error, refetch };
}
