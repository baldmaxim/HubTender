import { useState, useCallback, useEffect } from 'react';
import { message } from 'antd';
import {
  listProjects,
  listAllProjectAgreements,
  listProjectMonthlyCompletion,
} from '../../../lib/api/projects';
import type { ProjectFull, ProjectCompletion, ProjectAgreement } from '../../../lib/supabase/types';

// Детали доп соглашений по project_id
export type AgreementsMap = Record<string, ProjectAgreement[]>;

interface TenderJoin {
  id: string;
  title: string;
  tender_number: string;
}

interface ProjectWithTender {
  id: string;
  name: string;
  client_name: string;
  contract_cost: number;
  area: number | null;
  construction_end_date: string | null;
  tender_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  tender: TenderJoin | null;
}

export const useProjectsData = () => {
  const [projects, setProjects] = useState<ProjectFull[]>([]);
  const [completionData, setCompletionData] = useState<ProjectCompletion[]>([]);
  const [agreementsMap, setAgreementsMap] = useState<AgreementsMap>({});
  const [loading, setLoading] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      // Go: GET /api/v1/projects (active + tender embed, newest first).
      const typedProjects = (await listProjects()) as unknown as ProjectWithTender[];
      const projectIds = typedProjects?.map((p) => p.id) || [];

      if (projectIds.length === 0) {
        setProjects([]);
        setLoading(false);
        return;
      }

      // Все доп. соглашения (упорядочены по agreement_date asc на сервере);
      // ниже маппятся по project_id, как и раньше.
      const agreementsData = await listAllProjectAgreements();

      // Build agreements map by project_id
      const newAgreementsMap: AgreementsMap = {};
      (agreementsData || []).forEach((a) => {
        if (!newAgreementsMap[a.project_id]) {
          newAgreementsMap[a.project_id] = [];
        }
        newAgreementsMap[a.project_id].push({
          ...a,
          amount: Number(a.amount),
        } as unknown as ProjectAgreement);
      });
      setAgreementsMap(newAgreementsMap);

      // Fetch completion totals (все строки; суммируются по project_id ниже)
      const completionSums = await listProjectMonthlyCompletion();

      // Calculate derived fields
      const enrichedProjects: ProjectFull[] = (typedProjects || []).map((project) => {
        const agreementsSum = (newAgreementsMap[project.id] || [])
          .reduce((sum, a) => sum + a.amount, 0);

        const completionSum = (completionSums || [])
          .filter((c) => c.project_id === project.id)
          .reduce((sum, c) => sum + (Number(c.actual_amount) || 0), 0);

        const finalContractCost = Number(project.contract_cost) + agreementsSum;
        const completionPercentage =
          finalContractCost > 0 ? (completionSum / finalContractCost) * 100 : 0;

        return {
          ...project,
          contract_cost: Number(project.contract_cost),
          area: project.area ? Number(project.area) : null,
          additional_agreements_sum: agreementsSum,
          final_contract_cost: finalContractCost,
          total_completion: completionSum,
          completion_percentage: completionPercentage,
          tender_name: project.tender?.title,
          tender_number: project.tender?.tender_number,
        };
      });

      setProjects(enrichedProjects);
    } catch (error) {
      console.error('Error loading projects:', error);
      message.error('Ошибка загрузки объектов');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCompletionData = useCallback(async () => {
    try {
      const data = await listProjectMonthlyCompletion();

      setCompletionData(
        (data || []).map((item) => ({
          ...item,
          actual_amount: Number(item.actual_amount),
          forecast_amount: item.forecast_amount ? Number(item.forecast_amount) : null,
        }))
      );
    } catch (error) {
      console.error('Error loading completion data:', error);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
    fetchCompletionData();
  }, [fetchProjects, fetchCompletionData]);

  return { projects, loading, fetchProjects, completionData, fetchCompletionData, agreementsMap };
};
