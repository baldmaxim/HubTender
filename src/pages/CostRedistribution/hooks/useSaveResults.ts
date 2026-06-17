/**
 * Хук для сохранения результатов перераспределения в базу данных
 */

import { useState, useCallback } from 'react';
import { message } from 'antd';
import { getCurrentUserId as appAuthGetCurrentUserId } from '../../../lib/auth/client';
import {
  saveRedistributionResults,
  loadRedistributionResults,
  type RedistributionRecord as ApiRedistributionRecord,
} from '../../../lib/api/redistributions';
import type { RedistributionResult, SourceRule, TargetCost } from '../utils';
import type { RedistributionRule } from '../../../lib/supabase';
import type { PositionAdjustmentRule } from '../types/positionAdjustment';
import { markRealtimeMutation } from '../../../lib/realtime/useRealtimeRefetch';

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
        const userId = appAuthGetCurrentUserId();

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
            ...(rule.boq_item_types && rule.boq_item_types.length > 0
              ? { boq_item_types: rule.boq_item_types }
              : {}),
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
          createdBy: userId,
        });

        // Подавляем self-echo: запись породит NOTIFY → WS-эхо в той же вкладке.
        markRealtimeMutation(`tender:${tenderId}`);

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
        // Go отдаёт всё одним запросом (без 1000-строчной пагинации) +
        // rules из единственной holder-строки. null, если результатов нет.
        const loaded = await loadRedistributionResults(tenderId, tacticId);
        if (!loaded) {
          return null;
        }
        return {
          results: loaded.results,
          redistributionRules: loaded.redistribution_rules,
        };
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
