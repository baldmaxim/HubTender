/**
 * Хук для сохранения результатов перераспределения в базу данных
 */

import { useState, useCallback } from 'react';
import { message } from 'antd';
import { supabase } from '../../../lib/supabase';
import {
  saveRedistributionResults,
  type RedistributionRecord as ApiRedistributionRecord,
} from '../../../lib/api/redistributions';
import type { RedistributionResult, SourceRule, TargetCost } from '../utils';
import type { RedistributionRule } from '../../../lib/supabase';
import type { PositionAdjustmentRule } from '../types/positionAdjustment';

interface LoadedRedistributionResults {
  results: Array<{
    boq_item_id: string;
    original_work_cost: number;
    deducted_amount: number;
    added_amount: number;
    final_work_cost: number;
  }>;
  redistributionRules: RedistributionRule | null;
}

export function useSaveResults() {
  const [saving, setSaving] = useState(false);

  const saveResults = useCallback(
    async (
      tenderId: string,
      tacticId: string,
      results: RedistributionResult[],
      sourceRules: SourceRule[],
      targetCosts: TargetCost[],
      positionAdjustments: PositionAdjustmentRule[] = [],
      fallbackBoqItem?: { id: string; total_commercial_work_cost: number }
    ): Promise<boolean> => {
      if (!tenderId || !tacticId) {
        message.error('Не выбран тендер или тактика наценок');
        return false;
      }

      if (results.length === 0 && !fallbackBoqItem) {
        message.error('Нет результатов для сохранения');
        return false;
      }

      setSaving(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();

        const changedResults = results.filter((result) =>
          Math.abs(result.deducted_amount) > 0.000001 || Math.abs(result.added_amount) > 0.000001
        );
        const placeholderFromBoqItem = fallbackBoqItem
          ? ({
              boq_item_id: fallbackBoqItem.id,
              original_work_cost: fallbackBoqItem.total_commercial_work_cost,
              deducted_amount: 0,
              added_amount: 0,
              final_work_cost: fallbackBoqItem.total_commercial_work_cost,
            } satisfies RedistributionResult)
          : null;
        const resultsToPersist =
          changedResults.length > 0
            ? changedResults
            : results.length > 0
              ? results.slice(0, 1)
              : placeholderFromBoqItem
                ? [placeholderFromBoqItem]
                : [];

        if (resultsToPersist.length === 0) {
          message.error('Нет результатов для сохранения');
          return false;
        }

        const rules: RedistributionRule = {
          deductions: sourceRules.map((rule) => ({
            level: rule.level,
            category_id: rule.category_id,
            detail_cost_category_id: rule.detail_cost_category_id,
            category_name: rule.category_name,
            percentage: rule.percentage,
          })),
          targets: targetCosts.map((target) => ({
            level: target.level,
            category_id: target.category_id,
            detail_cost_category_id: target.detail_cost_category_id,
            category_name: target.category_name,
          })),
          ...(positionAdjustments.length > 0
            ? {
                position_adjustments: positionAdjustments.map((rule) => ({
                  mode: rule.mode,
                  amount: rule.amount,
                  sourceIds: rule.sourceIds,
                  targetIds: rule.targetIds,
                })),
              }
            : {}),
        };

        const records: ApiRedistributionRecord[] = resultsToPersist.map((result) => ({
          boq_item_id: result.boq_item_id,
          original_work_cost: result.original_work_cost,
          deducted_amount: result.deducted_amount,
          added_amount: result.added_amount,
          final_work_cost: result.final_work_cost,
        }));

        await saveRedistributionResults({
          tenderId,
          tacticId,
          records,
          rules,
          createdBy: user?.id ?? null,
        });

        message.success('Результаты перераспределения сохранены');
        return true;
      } catch (error) {
        console.error('Ошибка сохранения результатов:', error);
        message.error('Не удалось сохранить результаты');
        return false;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const loadSavedResults = useCallback(
    async (tenderId: string, tacticId: string): Promise<LoadedRedistributionResults | null> => {
      if (!tenderId || !tacticId) {
        return null;
      }

      try {
        const { data: rulesRow, error: rulesError } = await supabase
          .from('cost_redistribution_results')
          .select('redistribution_rules')
          .eq('tender_id', tenderId)
          .eq('markup_tactic_id', tacticId)
          .not('redistribution_rules', 'is', null)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (rulesError) throw rulesError;

        // CRITICAL: Supabase limit 1000 rows - use batching
        let allResults: Array<{
          boq_item_id: string;
          original_work_cost: number;
          deducted_amount: number;
          added_amount: number;
          final_work_cost: number;
        }> = [];
        let from = 0;
        const batchSize = 1000;
        let hasMore = true;

        while (hasMore) {
          const { data, error } = await supabase
            .from('cost_redistribution_results')
            .select('boq_item_id, original_work_cost, deducted_amount, added_amount, final_work_cost')
            .eq('tender_id', tenderId)
            .eq('markup_tactic_id', tacticId)
            .range(from, from + batchSize - 1);

          if (error) throw error;

          if (data && data.length > 0) {
            allResults = [...allResults, ...data];
            from += batchSize;
            hasMore = data.length === batchSize;
          } else {
            hasMore = false;
          }
        }

        if (allResults.length > 0) {
          return {
            results: allResults,
            redistributionRules: rulesRow?.redistribution_rules ?? null,
          };
        }

        return null;
      } catch (error) {
        console.error('Ошибка загрузки сохраненных результатов:', error);
        return null;
      }
    },
    []
  );

  return {
    saving,
    saveResults,
    loadSavedResults,
  };
}
