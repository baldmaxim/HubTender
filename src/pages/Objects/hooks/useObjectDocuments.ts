import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import {
  deleteObjectDocument,
  fetchObjectDocuments,
  updateObjectDocument,
  uploadObjectDocument,
} from '../../../lib/api/constructionObjects';
import type { IConstructionObjectDocument } from '../../../lib/api/constructionObjects';

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

const TOO_LARGE_FOR_PORTAL =
  'Файл слишком большой для загрузки через портал (лимит сервера) — передайте его администратору';

export interface IPendingDocument {
  key: string;
  name: string;
}

export interface IDocumentPatch {
  title: string | null;
  doc_date: string | null;
}

interface IUseObjectDocuments {
  documents: IConstructionObjectDocument[];
  loading: boolean;
  error: string | null;
  pending: IPendingDocument[];
  reloadList: () => Promise<void>;
  upload: (files: File[]) => Promise<void>;
  save: (docId: string, patch: IDocumentPatch) => Promise<boolean>;
  remove: (docId: string) => Promise<void>;
}

const errorText = (e: unknown, fallback: string): string => {
  if (typeof e === 'object' && e !== null && (e as { status?: number }).status === 413) return TOO_LARGE_FOR_PORTAL;
  return e instanceof Error && e.message ? e.message : fallback;
};

const bySortOrder = (a: IConstructionObjectDocument, b: IConstructionObjectDocument): number =>
  a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);

/** Документы объекта и операции над ними. onChanged — обновить document_count в списке объектов. */
export const useObjectDocuments = (objectId: string | null, onChanged: () => void): IUseObjectDocuments => {
  const [documents, setDocuments] = useState<IConstructionObjectDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<IPendingDocument[]>([]);
  const objectRef = useRef(objectId);
  objectRef.current = objectId;
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const reloadList = useCallback(async () => {
    if (!objectId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchObjectDocuments(objectId);
      if (objectRef.current === objectId) setDocuments([...list].sort(bySortOrder));
    } catch (e) {
      if (objectRef.current === objectId) setError(errorText(e, 'Не удалось загрузить документы'));
    } finally {
      if (objectRef.current === objectId) setLoading(false);
    }
  }, [objectId]);

  useEffect(() => {
    setDocuments([]);
    setPending([]);
    if (objectId) void reloadList();
  }, [objectId, reloadList]);

  const upload = useCallback(
    async (files: File[]) => {
      if (!objectId) return;
      const entries = files.map((file, i) => ({ file, key: `${Date.now()}-${i}-${file.name}` }));
      setPending((prev) => [...prev, ...entries.map((x) => ({ key: x.key, name: x.file.name }))]);
      let uploaded = 0;
      // По одному запросу на файл.
      for (const { file, key } of entries) {
        try {
          if (file.size > MAX_DOCUMENT_BYTES) throw new Error('Файл больше 25 МБ');
          const meta = await uploadObjectDocument(objectId, { file });
          uploaded += 1;
          if (objectRef.current === objectId) setDocuments((prev) => [...prev, meta].sort(bySortOrder));
        } catch (e) {
          message.error(`${file.name}: ${errorText(e, 'не удалось загрузить документ')}`);
        } finally {
          setPending((prev) => prev.filter((p) => p.key !== key));
        }
      }
      if (uploaded > 0) onChangedRef.current();
    },
    [objectId],
  );

  const save = useCallback(async (docId: string, patch: IDocumentPatch): Promise<boolean> => {
    try {
      await updateObjectDocument(docId, patch);
      setDocuments((prev) => prev.map((d) => (d.id === docId ? { ...d, ...patch } : d)));
      return true;
    } catch (e) {
      message.error(errorText(e, 'Не удалось сохранить документ'));
      return false;
    }
  }, []);

  const remove = useCallback(async (docId: string): Promise<void> => {
    try {
      await deleteObjectDocument(docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      onChangedRef.current();
    } catch (e) {
      message.error(errorText(e, 'Не удалось удалить документ'));
    }
  }, []);

  return { documents, loading, error, pending, reloadList, upload, save, remove };
};
