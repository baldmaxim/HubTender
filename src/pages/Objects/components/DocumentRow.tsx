import { useState } from 'react';
import type { FC } from 'react';
import { Button, DatePicker, Input, Popconfirm } from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileImageOutlined,
  FileOutlined,
  FilePdfOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import type { IConstructionObjectDocument } from '../../../lib/api/constructionObjects';
import type { IDocumentPatch } from '../hooks/useObjectDocuments';
import { documentTitle, isImageDocument, isPdfDocument } from '../utils/documentFile';
import { formatDate, formatFileSize } from '../utils/format';
import styles from './ObjectDocuments.module.css';

const MAX_TITLE = 200;
const DATE_FORMAT = 'DD.MM.YYYY';
const ISO_FORMAT = 'YYYY-MM-DD';

interface IDocumentRowProps {
  document: IConstructionObjectDocument;
  readOnly: boolean;
  busy: boolean;
  onOpen: (doc: IConstructionObjectDocument) => void;
  onDownload: (doc: IConstructionObjectDocument) => void;
  onSave: (docId: string, patch: IDocumentPatch) => Promise<boolean>;
  onRemove: (docId: string) => Promise<void>;
}

const DocumentIcon: FC<{ doc: IConstructionObjectDocument }> = ({ doc }) => {
  if (isPdfDocument(doc)) return <FilePdfOutlined />;
  if (isImageDocument(doc)) return <FileImageOutlined />;
  return <FileOutlined />;
};

/** Строка документа: название, дата, размер и действия; правка названия и даты — на месте. */
export const DocumentRow: FC<IDocumentRowProps> = ({ document: doc, readOnly, busy, onOpen, onDownload, onSave, onRemove }) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState<Dayjs | null>(null);

  const startEdit = () => {
    setTitle(doc.title ?? '');
    setDate(doc.doc_date ? dayjs(doc.doc_date) : null);
    setEditing(true);
  };

  const commit = async () => {
    setSaving(true);
    const trimmed = title.trim();
    const ok = await onSave(doc.id, {
      title: trimmed === '' ? null : trimmed,
      doc_date: date && date.isValid() ? date.format(ISO_FORMAT) : null,
    });
    setSaving(false);
    if (ok) setEditing(false);
  };

  const canView = isPdfDocument(doc) || isImageDocument(doc);

  if (editing) {
    return (
      <li className={`${styles.row} ${styles.rowEditing}`}>
        <span className={styles.icon}>
          <DocumentIcon doc={doc} />
        </span>
        <div className={styles.editForm}>
          <Input
            autoFocus
            allowClear
            className={styles.field}
            value={title}
            maxLength={MAX_TITLE}
            disabled={saving}
            placeholder={doc.file_name}
            aria-label="Название документа"
            onChange={(e) => setTitle(e.target.value)}
            onPressEnter={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <DatePicker
            className={styles.field}
            value={date}
            format={DATE_FORMAT}
            disabled={saving}
            placeholder="Дата документа"
            aria-label="Дата документа"
            onChange={setDate}
          />
          <div className={styles.editActions}>
            <Button type="primary" icon={<CheckOutlined />} loading={saving} onClick={() => void commit()}>
              Сохранить
            </Button>
            <Button icon={<CloseOutlined />} disabled={saving} onClick={() => setEditing(false)}>
              Отмена
            </Button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className={styles.row}>
      <span className={styles.icon}>
        <DocumentIcon doc={doc} />
      </span>
      <div className={styles.main}>
        <div className={styles.title} title={doc.file_name}>
          {documentTitle(doc)}
        </div>
        <div className={styles.meta}>
          {doc.doc_date && <span>{formatDate(doc.doc_date)}</span>}
          <span>{formatFileSize(doc.size_bytes)}</span>
        </div>
      </div>
      <div className={styles.actions}>
        {canView && (
          <Button className={styles.action} icon={<EyeOutlined />} loading={busy} onClick={() => onOpen(doc)}>
            Открыть
          </Button>
        )}
        <Button className={styles.action} icon={<DownloadOutlined />} disabled={busy} onClick={() => onDownload(doc)}>
          Скачать
        </Button>
        {!readOnly && (
          <>
            <Button
              className={styles.action}
              icon={<EditOutlined />}
              aria-label={`Изменить: ${documentTitle(doc)}`}
              onClick={startEdit}
            />
            <Popconfirm
              title="Удалить документ?"
              okText="Удалить"
              cancelText="Отмена"
              okButtonProps={{ danger: true }}
              placement="bottomRight"
              onConfirm={() => onRemove(doc.id)}
            >
              <Button
                className={styles.action}
                danger
                icon={<DeleteOutlined />}
                aria-label={`Удалить: ${documentTitle(doc)}`}
              />
            </Popconfirm>
          </>
        )}
      </div>
    </li>
  );
};
