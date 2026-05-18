import { useState, useEffect, useCallback } from 'react';
import { message } from 'antd';
import { apiFetch } from '../lib/api/client';
import type { TenderNote, TenderNoteFull } from '../lib/supabase/types';

interface UseTenderNotesResult {
  myNote: TenderNote | null;
  allNotes: TenderNoteFull[];
  loading: boolean;
  saving: boolean;
  saveNote: (text: string) => Promise<void>;
}

interface NotesEnvelope {
  data: {
    my_note: TenderNote | null;
    all_notes: TenderNoteFull[];
  };
}

/**
 * Заметки тендера — через Go BFF (→ Yandex). Привилегированность ("видеть
 * все") определяется сервером по role_code из JWT-пользователя; параметр
 * canViewAll оставлен для совместимости сигнатуры (UI-логика), на выборку
 * не влияет — сервер сам отдаёт all_notes только привилегированным ролям.
 */
export const useTenderNotes = (
  tenderId: string | null,
  userId: string | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canViewAll: boolean,
): UseTenderNotesResult => {
  const [myNote, setMyNote] = useState<TenderNote | null>(null);
  const [allNotes, setAllNotes] = useState<TenderNoteFull[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchNotes = useCallback(async () => {
    if (!tenderId || !userId) {
      setMyNote(null);
      setAllNotes([]);
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch<NotesEnvelope>(
        `/api/v1/tenders/${encodeURIComponent(tenderId)}/notes`,
      );
      setMyNote(res.data.my_note ?? null);
      setAllNotes(res.data.all_notes ?? []);
    } catch (err) {
      console.error('Ошибка загрузки заметок:', err);
    } finally {
      setLoading(false);
    }
  }, [tenderId, userId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const saveNote = useCallback(
    async (text: string) => {
      if (!tenderId || !userId) return;

      setSaving(true);
      try {
        await apiFetch<void>(
          `/api/v1/tenders/${encodeURIComponent(tenderId)}/notes`,
          { method: 'PUT', body: JSON.stringify({ note_text: text }) },
        );
        message.success(text.trim() === '' ? 'Заметка удалена' : 'Заметка сохранена');
        await fetchNotes();
      } catch (err) {
        console.error('Ошибка сохранения заметки:', err);
        message.error('Не удалось сохранить заметку');
      } finally {
        setSaving(false);
      }
    },
    [tenderId, userId, fetchNotes],
  );

  return { myNote, allNotes, loading, saving, saveNote };
};
