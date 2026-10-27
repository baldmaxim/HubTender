import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { fetchObjectDocumentFile } from '../../../lib/api/constructionObjects';
import type { IConstructionObjectDocument } from '../../../lib/api/constructionObjects';
import {
  documentTitle,
  isImageDocument,
  isPdfDocument,
  saveBlobAs,
  withDocumentType,
} from '../utils/documentFile';

export interface IViewedDocument {
  url: string;
  title: string;
}

interface IUseDocumentViewer {
  /** Id документа, который сейчас скачивается (кнопки показывают загрузку). */
  busyId: string | null;
  /** Картинка в просмотре (antd Image preview). */
  image: IViewedDocument | null;
  /** PDF во всплывающем окне — запасной путь, если браузер заблокировал новую вкладку. */
  frame: IViewedDocument | null;
  openDocument: (doc: IConstructionObjectDocument) => Promise<void>;
  downloadDocument: (doc: IConstructionObjectDocument) => Promise<void>;
  closeImage: () => void;
  closeFrame: () => void;
}

const errorText = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'Не удалось открыть документ');

/** Просмотр и скачивание документов. Blob URL живут, пока открыто окно объекта, и отзываются при закрытии. */
export const useDocumentViewer = (): IUseDocumentViewer => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [image, setImage] = useState<IViewedDocument | null>(null);
  const [frame, setFrame] = useState<IViewedDocument | null>(null);
  const urlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const inlineUrl = useCallback(async (doc: IConstructionObjectDocument): Promise<string> => {
    const cached = urlsRef.current.get(doc.id);
    if (cached) return cached;
    const blob = withDocumentType(await fetchObjectDocumentFile(doc.id, 'inline'), doc);
    const url = URL.createObjectURL(blob);
    urlsRef.current.set(doc.id, url);
    return url;
  }, []);

  const downloadDocument = useCallback(async (doc: IConstructionObjectDocument) => {
    setBusyId(doc.id);
    try {
      saveBlobAs(await fetchObjectDocumentFile(doc.id, 'attachment'), doc.file_name);
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusyId(null);
    }
  }, []);

  const openDocument = useCallback(
    async (doc: IConstructionObjectDocument) => {
      const title = documentTitle(doc);
      if (!isPdfDocument(doc) && !isImageDocument(doc)) {
        await downloadDocument(doc);
        return;
      }
      // Вкладку нужно открыть синхронно с кликом, иначе браузер заблокирует её после загрузки.
      const tab = isPdfDocument(doc) ? window.open('', '_blank') : null;
      if (tab) tab.document.title = title;
      setBusyId(doc.id);
      try {
        const url = await inlineUrl(doc);
        if (!isPdfDocument(doc)) {
          setImage({ url, title });
        } else if (tab && !tab.closed) {
          tab.location.href = url;
        } else {
          setFrame({ url, title });
        }
      } catch (e) {
        tab?.close();
        message.error(errorText(e));
      } finally {
        setBusyId(null);
      }
    },
    [downloadDocument, inlineUrl],
  );

  return {
    busyId,
    image,
    frame,
    openDocument,
    downloadDocument,
    closeImage: useCallback(() => setImage(null), []),
    closeFrame: useCallback(() => setFrame(null), []),
  };
};
