// Read-only reference data hooks — Go BFF only.
import { useEffect, useRef, useState } from 'react';
import type { Database } from '../../supabase/database.types';
import { apiFetch } from '../client';

// ─── Row types from generated schema ─────────────────────────────────────────
type UnitRow = Database['public']['Tables']['units']['Row'];
type RoleRow = Database['public']['Tables']['roles']['Row'];
type MaterialNameRow = Database['public']['Tables']['material_names']['Row'];
type WorkNameRow = Database['public']['Tables']['work_names']['Row'];
type CostCategoryRow = Database['public']['Tables']['cost_categories']['Row'];
type DetailCostCategoryRow = Database['public']['Tables']['detail_cost_categories']['Row'];

// ─── Module-level cache (survives component re-mounts, cleared on page reload) ─
interface CacheEntry<T> {
  data: T[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T[] | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}

function setCached<T>(key: string, data: T[], ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ─── Generic hook ─────────────────────────────────────────────────────────────
interface RefState<T> {
  data: T[];
  loading: boolean;
  error: string | null;
}

function useRefData<T>(
  cacheKey: string,
  ttlMs: number,
  fetchGo: () => Promise<T[]>,
): RefState<T> {
  const [state, setState] = useState<RefState<T>>(() => {
    const cached = getCached<T>(cacheKey);
    return { data: cached ?? [], loading: cached === null, error: null };
  });

  const fetchedRef = useRef(false);

  useEffect(() => {
    const cached = getCached<T>(cacheKey);
    if (cached !== null) {
      setState({ data: cached, loading: false, error: null });
      return;
    }
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const run = async () => {
      try {
        const data = await fetchGo();
        setCached(cacheKey, data, ttlMs);
        setState({ data, loading: false, error: null });
      } catch (err) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'Ошибка загрузки справочника',
        }));
      }
    };

    run();
  }, [cacheKey, ttlMs, fetchGo]);

  return state;
}

// ─── Public hooks ─────────────────────────────────────────────────────────────

export function useUnits() {
  return useRefData<UnitRow>('units', 24 * 60 * 60_000, async () => {
    const res = await apiFetch<{ data: UnitRow[] }>('/api/v1/references/units', {
      cacheKey: 'ref:units',
    });
    return res.data;
  });
}

export function useRoles() {
  return useRefData<RoleRow>('roles', 60 * 60_000, async () => {
    const res = await apiFetch<{ data: RoleRow[] }>('/api/v1/references/roles', {
      cacheKey: 'ref:roles',
    });
    return res.data;
  });
}

export function useMaterialNames() {
  return useRefData<MaterialNameRow>('material_names', 15 * 60_000, async () => {
    const res = await apiFetch<{ data: MaterialNameRow[] }>('/api/v1/references/material-names', {
      cacheKey: 'ref:material_names',
    });
    return res.data;
  });
}

export function useWorkNames() {
  return useRefData<WorkNameRow>('work_names', 15 * 60_000, async () => {
    const res = await apiFetch<{ data: WorkNameRow[] }>('/api/v1/references/work-names', {
      cacheKey: 'ref:work_names',
    });
    return res.data;
  });
}

export function useCostCategoriesRef() {
  return useRefData<CostCategoryRow>('cost_categories', 60 * 60_000, async () => {
    const res = await apiFetch<{ data: CostCategoryRow[] }>('/api/v1/references/cost-categories', {
      cacheKey: 'ref:cost_categories',
    });
    return res.data;
  });
}

export function useDetailCostCategoriesRef(tenderId?: string) {
  const cacheKey = tenderId ? `detail_cost_categories:${tenderId}` : 'detail_cost_categories';
  const path = tenderId
    ? `/api/v1/references/detail-cost-categories?tender_id=${encodeURIComponent(tenderId)}`
    : '/api/v1/references/detail-cost-categories';

  return useRefData<DetailCostCategoryRow>(cacheKey, 60 * 60_000, async () => {
    const res = await apiFetch<{ data: DetailCostCategoryRow[] }>(path, {
      cacheKey: `ref:detail_cost_categories:${tenderId ?? ''}`,
    });
    return res.data;
  });
}

/** Invalidate one or all reference caches (call after admin writes). */
export function invalidateRefCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}
