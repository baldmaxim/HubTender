import type { IConstructionObjectDocument } from '../../../lib/api/constructionObjects';

type DocumentLike = Pick<IConstructionObjectDocument, 'mime' | 'file_name'>;

export const isPdfDocument = (d: DocumentLike): boolean =>
  d.mime === 'application/pdf' || d.file_name.toLowerCase().endsWith('.pdf');

export const isImageDocument = (d: DocumentLike): boolean => d.mime.startsWith('image/');

/** Название в списке: заданное пользователем или имя файла. */
export const documentTitle = (d: Pick<IConstructionObjectDocument, 'title' | 'file_name'>): string =>
  d.title && d.title.trim() !== '' ? d.title : d.file_name;

/** Встроенный просмотрщик берёт тип из Blob: подставляем тип документа, если сервер его не отдал. */
export const withDocumentType = (blob: Blob, d: DocumentLike): Blob => {
  const type = isPdfDocument(d) ? 'application/pdf' : d.mime;
  return blob.type === type || !type ? blob : new Blob([blob], { type });
};

/** Сохраняет Blob файлом через временную ссылку <a download>. */
export const saveBlobAs = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Браузеру нужно время начать скачивание.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
};
