import { useCallback, useEffect, useState } from 'react';
import { fetchTenderBrief, saveTenderBrief, type TenderBrief } from '../../../lib/api/tenderBriefs';
import { getErrorMessage } from '../../../utils/errors';

/** Сохранённая выжимка тендера и черновик правки (текст + выбор категорий). */
export function useTenderBrief(tenderId: string) {
  const [brief, setBrief] = useState<TenderBrief | null>(null);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (b: TenderBrief) => {
    setBrief(b);
    setText(b.summary_text);
    setSelected(b.fact_category_ids ?? []);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTenderBrief(tenderId)
      .then((b) => {
        if (cancelled) return;
        apply(b);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError('Не удалось загрузить выжимку: ' + getErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenderId]);

  const save = useCallback(
    async (factCategoryIds: string[] | null) => {
      setSaving(true);
      try {
        apply(await saveTenderBrief(tenderId, text, factCategoryIds));
      } finally {
        setSaving(false);
      }
    },
    [tenderId, text],
  );

  const savedSelection = brief?.fact_category_ids ?? [];
  const dirty =
    !!brief &&
    (text !== brief.summary_text ||
      selected.length !== savedSelection.length ||
      selected.some((id, i) => id !== savedSelection[i]));

  return { brief, text, setText, selected, setSelected, loading, saving, error, save, dirty };
}
