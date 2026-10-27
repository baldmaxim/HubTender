import type { FC } from 'react';
import { Alert, Button, Empty, Image, Modal, Spin, Upload } from 'antd';
import { FileTextOutlined, InboxOutlined, LoadingOutlined } from '@ant-design/icons';
import { useDocumentViewer } from '../hooks/useDocumentViewer';
import { MAX_DOCUMENT_BYTES } from '../hooks/useObjectDocuments';
import type { IDocumentPatch, IPendingDocument } from '../hooks/useObjectDocuments';
import type { IConstructionObjectDocument } from '../../../lib/api/constructionObjects';
import { DocumentRow } from './DocumentRow';
import styles from './ObjectDocuments.module.css';

interface IObjectDocumentsTabProps {
  documents: IConstructionObjectDocument[];
  loading: boolean;
  error: string | null;
  pending: IPendingDocument[];
  readOnly: boolean;
  onReload: () => void;
  onUpload: (files: File[]) => Promise<void>;
  onSave: (docId: string, patch: IDocumentPatch) => Promise<boolean>;
  onRemove: (docId: string) => Promise<void>;
}

const MAX_MB = MAX_DOCUMENT_BYTES / (1024 * 1024);

export const ObjectDocumentsTab: FC<IObjectDocumentsTabProps> = ({
  documents,
  loading,
  error,
  pending,
  readOnly,
  onReload,
  onUpload,
  onSave,
  onRemove,
}) => {
  const viewer = useDocumentViewer();

  return (
    <div className={styles.tab}>
      {!readOnly && (
        <Upload.Dragger
          multiple
          accept=".pdf,image/*"
          showUploadList={false}
          beforeUpload={(file, fileList) => {
            // beforeUpload зовётся на каждый файл; забираем всю пачку один раз.
            if (file === fileList[0]) void onUpload(fileList);
            return false;
          }}
          className={styles.dragger}
        >
          <p className={styles.dragIcon}>
            <InboxOutlined />
          </p>
          <p className={styles.dragText}>Перетащите документ или нажмите, чтобы выбрать</p>
          <p className={styles.dragHint}>PDF или изображение, до {MAX_MB} МБ на файл</p>
        </Upload.Dragger>
      )}

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" onClick={onReload}>
              Повторить
            </Button>
          }
        />
      )}

      {loading && documents.length === 0 && (
        <div className={styles.center}>
          <Spin />
        </div>
      )}

      {!loading && !error && documents.length === 0 && pending.length === 0 && (
        <Empty image={<FileTextOutlined className={styles.emptyIcon} />} description="Документов пока нет" />
      )}

      <ul className={styles.list}>
        {documents.map((doc) => (
          <DocumentRow
            key={doc.id}
            document={doc}
            readOnly={readOnly}
            busy={viewer.busyId === doc.id}
            onOpen={(d) => void viewer.openDocument(d)}
            onDownload={(d) => void viewer.downloadDocument(d)}
            onSave={onSave}
            onRemove={onRemove}
          />
        ))}
        {pending.map((p) => (
          <li key={p.key} className={`${styles.row} ${styles.rowPending}`}>
            <span className={styles.icon}>
              <LoadingOutlined />
            </span>
            <div className={styles.main}>
              <div className={styles.title}>{p.name}</div>
              <div className={styles.meta}>Загрузка…</div>
            </div>
          </li>
        ))}
      </ul>

      <Image.PreviewGroup
        items={viewer.image ? [{ src: viewer.image.url, alt: viewer.image.title }] : []}
        preview={{
          visible: viewer.image !== null,
          onVisibleChange: (visible) => {
            if (!visible) viewer.closeImage();
          },
        }}
      />

      <Modal
        open={viewer.frame !== null}
        title={viewer.frame?.title}
        footer={null}
        centered
        destroyOnHidden
        width="min(960px, 96vw)"
        onCancel={viewer.closeFrame}
      >
        {viewer.frame && <iframe className={styles.frame} src={viewer.frame.url} title={viewer.frame.title} />}
      </Modal>
    </div>
  );
};
