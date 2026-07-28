import { useCallback, useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { fetchTenders as apiFetchTenders } from '../../../lib/api/tenders';
import {
  fetchTenderQuality,
  setQualityVerdict,
  type QualityFinding,
  type QualityReport,
  type QualityVerdict,
} from '../../../lib/api/quality';
import { useRealtimeTopic } from '../../../lib/realtime/useRealtimeTopic';

export interface QualityTenderOption {
  id: string;
  title: string;
  version?: number;
}

/** Группа находок одного правила — в таком виде их показывает страница. */
export interface RuleGroup {
  ruleCode: string;
  ruleTitle: string;
  severity: QualityFinding['severity'];
  summary: string;
  findings: QualityFinding[];
  moneyTotal: number;
  acceptedCount: number;
}

export function useQualityReport() {
  const [tenders, setTenders] = useState<QualityTenderOption[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAccepted, setShowAccepted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetchTenders();
        if (cancelled) return;
        setTenders(
          data.map((t) => ({
            id: t.id,
            title: t.title,
            version: t.version ?? undefined,
          })),
        );
      } catch (error) {
        console.error('Ошибка загрузки тендеров:', error);
        message.error('Не удалось загрузить список тендеров');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async (tenderId: string, refresh: boolean) => {
    setLoading(true);
    try {
      const data = await fetchTenderQuality(tenderId, refresh);
      setReport(data);
      if (data.errors.length > 0) {
        message.warning(
          `Правил не отработало: ${data.errors.length}. Остальные находки актуальны.`,
        );
      }
    } catch (error) {
      console.error('Ошибка проверки данных:', error);
      message.error('Не удалось выполнить проверку данных');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedTenderId) void load(selectedTenderId, false);
    else setReport(null);
  }, [selectedTenderId, load]);

  // Правки в тендере делают находки неактуальными — перечитываем.
  useRealtimeTopic(
    selectedTenderId ? `tender:${selectedTenderId}` : null,
    useCallback(() => {
      if (selectedTenderId) void load(selectedTenderId, true);
    }, [selectedTenderId, load]),
  );

  const recheck = useCallback(() => {
    if (selectedTenderId) void load(selectedTenderId, true);
  }, [selectedTenderId, load]);

  const submitVerdict = useCallback(
    async (finding: QualityFinding, verdict: QualityVerdict, note?: string) => {
      if (!selectedTenderId) return;
      try {
        await setQualityVerdict(selectedTenderId, {
          rule_code: finding.rule_code,
          entity_id: finding.entity_id,
          fingerprint: finding.fingerprint,
          verdict,
          note: note ?? null,
        });
        // Оптимистично — без полного перепрогона правил по тендеру.
        setReport((prev) =>
          prev
            ? {
                ...prev,
                findings: prev.findings.map((f) =>
                  f.rule_code === finding.rule_code && f.entity_id === finding.entity_id
                    ? { ...f, verdict, note: note ?? null }
                    : f,
                ),
              }
            : prev,
        );
        message.success(verdict === 'accepted' ? 'Отмечено как норма' : 'Отмечено как ошибка');
      } catch (error) {
        console.error('Ошибка сохранения вердикта:', error);
        message.error('Не удалось сохранить вердикт');
      }
    },
    [selectedTenderId],
  );

  const groups = useMemo<RuleGroup[]>(() => {
    if (!report) return [];
    const byRule = new Map<string, RuleGroup>();

    for (const f of report.findings) {
      const accepted = f.verdict === 'accepted';
      if (accepted && !showAccepted) continue;

      let g = byRule.get(f.rule_code);
      if (!g) {
        g = {
          ruleCode: f.rule_code,
          ruleTitle: f.rule_title,
          severity: f.severity,
          summary: f.summary,
          findings: [],
          moneyTotal: 0,
          acceptedCount: 0,
        };
        byRule.set(f.rule_code, g);
      }
      g.findings.push(f);
      if (accepted) g.acceptedCount += 1;
      if (typeof f.money_delta === 'number') g.moneyTotal += Math.abs(f.money_delta);
    }

    const order = { error: 0, warning: 1, info: 2 } as const;
    return Array.from(byRule.values()).sort(
      (a, b) => order[a.severity] - order[b.severity] || b.moneyTotal - a.moneyTotal,
    );
  }, [report, showAccepted]);

  const counts = useMemo(() => {
    const active = (report?.findings ?? []).filter((f) => f.verdict !== 'accepted');
    return {
      error: active.filter((f) => f.severity === 'error').length,
      warning: active.filter((f) => f.severity === 'warning').length,
      info: active.filter((f) => f.severity === 'info').length,
      accepted: (report?.findings ?? []).filter((f) => f.verdict === 'accepted').length,
      money: active.reduce((sum, f) => sum + Math.abs(f.money_delta ?? 0), 0),
    };
  }, [report]);

  return {
    tenders,
    selectedTenderId,
    setSelectedTenderId,
    report,
    groups,
    counts,
    loading,
    showAccepted,
    setShowAccepted,
    recheck,
    submitVerdict,
  };
}
