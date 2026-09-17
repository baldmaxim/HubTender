import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import {
  fetchTenderAIAssessments,
  startAITriage,
  type TenderAIAssessments,
} from '../../../lib/api/verificationAI';
import { availabilityText, currentAssessments } from '../../../lib/quality/aiTriagePolicy';
import { getErrorMessage } from '../../../utils/errors';

/** Пока идёт разбор — перечитываем оценки, чтобы они появлялись по мере ответа модели. */
const POLL_MS = 10_000;

export function useAITriage(tenderId: string | null) {
  const [data, setData] = useState<TenderAIAssessments | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async (id: string) => {
    try {
      setData(await fetchTenderAIAssessments(id));
    } catch (e) {
      // ИИ-разбор — дополнение к странице: без него находки работают как раньше.
      console.warn('ИИ-оценки не загружены:', getErrorMessage(e));
      setData(null);
    }
  }, []);

  useEffect(() => {
    setData(null);
    if (tenderId) void load(tenderId);
  }, [tenderId, load]);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (tenderId && data?.running) {
      timer.current = window.setTimeout(() => void load(tenderId), POLL_MS);
    }
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [tenderId, data, load]);

  const start = useCallback(async () => {
    if (!tenderId) return;
    setStarting(true);
    try {
      const status = await startAITriage(tenderId);
      if (status === 'started') {
        message.info('ИИ-разбор запущен — оценки появятся по мере ответа модели');
      } else if (status === 'already_running') {
        message.info('ИИ-разбор уже идёт');
      } else {
        message.warning(availabilityText(status) ?? 'ИИ-разбор недоступен');
      }
      await load(tenderId);
    } catch (e) {
      message.error('Не удалось запустить ИИ-разбор: ' + getErrorMessage(e));
    } finally {
      setStarting(false);
    }
  }, [tenderId, load]);

  const byFinding = useMemo(() => currentAssessments(data?.assessments), [data]);

  return { data, byFinding, start, starting, reload: () => tenderId && load(tenderId) };
}
