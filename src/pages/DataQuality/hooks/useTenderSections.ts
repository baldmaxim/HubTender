import { useCallback, useEffect, useState } from 'react';
import { message } from 'antd';
import {
  fetchTenderSections,
  isSectionChangedError,
  markTenderSection,
  unmarkTenderSection,
  type SectionStage,
  type TenderSection,
  type TenderSections,
} from '../../../lib/api/verificationSections';
import { useRealtimeTopic } from '../../../lib/realtime/useRealtimeTopic';

/** Готовность по разделам ВОР выбранного тендера. */
export function useTenderSections(tenderId: string | null) {
  const [data, setData] = useState<TenderSections | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ключ «раздел|этап», по которому идёт запрос, — чтобы крутить спиннер у кнопки.
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async (id: string, silent: boolean) => {
    if (!silent) setLoading(true);
    try {
      setData(await fetchTenderSections(id));
      setError(null);
    } catch (e) {
      console.error('Ошибка загрузки разделов:', e);
      setError('Не удалось загрузить разделы ВОР');
      if (!silent) setData(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tenderId) void load(tenderId, false);
    else setData(null);
  }, [tenderId, load]);

  // Правки тендера меняют хеши разделов — состояние отметок надо перечитать.
  useRealtimeTopic(
    tenderId ? `tender:${tenderId}` : null,
    useCallback(() => {
      if (tenderId) void load(tenderId, true);
    }, [tenderId, load]),
  );

  const mark = useCallback(
    async (section: TenderSection, stage: SectionStage) => {
      if (!tenderId) return;
      setBusyKey(`${section.key}|${stage}`);
      try {
        await markTenderSection(tenderId, {
          section_key: section.key,
          stage,
          content_hash: section.content_hash,
        });
        message.success('Раздел отмечен проверенным');
      } catch (e) {
        if (isSectionChangedError(e)) {
          message.warning('Раздел изменился, пока вы его смотрели. Данные обновлены — проверьте и отметьте снова.');
        } else {
          console.error('Ошибка отметки раздела:', e);
          message.error('Не удалось отметить раздел');
        }
      } finally {
        setBusyKey(null);
        await load(tenderId, true);
      }
    },
    [tenderId, load],
  );

  const unmark = useCallback(
    async (section: TenderSection, stage: SectionStage) => {
      if (!tenderId) return;
      setBusyKey(`${section.key}|${stage}`);
      try {
        await unmarkTenderSection(tenderId, { section_key: section.key, stage });
        message.success('Отметка снята');
      } catch (e) {
        console.error('Ошибка снятия отметки:', e);
        message.error('Не удалось снять отметку');
      } finally {
        setBusyKey(null);
        await load(tenderId, true);
      }
    },
    [tenderId, load],
  );

  return { data, loading, error, busyKey, mark, unmark };
}
