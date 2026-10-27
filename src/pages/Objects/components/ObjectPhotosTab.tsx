import type { FC } from 'react';
import { Alert, Button, Empty, Image, Popconfirm, Spin, Upload } from 'antd';
import { CameraOutlined, DeleteOutlined, InboxOutlined, LoadingOutlined } from '@ant-design/icons';
import type { IConstructionObjectPhoto } from '../../../lib/api/constructionObjects';
import { MAX_PHOTOS_PER_OBJECT } from '../hooks/useObjectPhotos';
import type { IPendingUpload } from '../hooks/useObjectPhotos';
import { usePhotoPreview } from '../hooks/usePhotoPreview';
import { PhotoCaption } from './PhotoCaption';
import { PhotoThumb } from './PhotoThumb';
import styles from './ObjectPhotosDrawer.module.css';

interface IObjectPhotosTabProps {
  objectName: string;
  photos: IConstructionObjectPhoto[];
  loading: boolean;
  error: string | null;
  pending: IPendingUpload[];
  readOnly: boolean;
  onReload: () => void;
  onUpload: (files: File[]) => Promise<void>;
  onSaveCaption: (photoId: string, caption: string) => Promise<boolean>;
  onRemove: (photoId: string) => Promise<void>;
}

export const ObjectPhotosTab: FC<IObjectPhotosTabProps> = ({
  objectName,
  photos,
  loading,
  error,
  pending,
  readOnly,
  onReload,
  onUpload,
  onSaveCaption,
  onRemove,
}) => {
  const preview = usePhotoPreview(photos, objectName);
  const canUpload = !readOnly && photos.length + pending.length < MAX_PHOTOS_PER_OBJECT;

  return (
    <div className={styles.tabPane}>
      {!readOnly && (
        <div className={styles.upload}>
          <Upload.Dragger
            multiple
            accept="image/*"
            showUploadList={false}
            disabled={!canUpload}
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
            <p className={styles.dragText}>
              {canUpload ? 'Перетащите фото или нажмите, чтобы выбрать' : `Достигнут предел: ${MAX_PHOTOS_PER_OBJECT} фото`}
            </p>
            <p className={styles.dragHint}>
              JPEG, PNG, WebP — сожмём перед отправкой. Загружено {photos.length} из {MAX_PHOTOS_PER_OBJECT}
            </p>
          </Upload.Dragger>
        </div>
      )}

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" onClick={() => onReload()}>
              Повторить
            </Button>
          }
        />
      )}

      {loading && photos.length === 0 && (
        <div className={styles.center}>
          <Spin />
        </div>
      )}

      {!loading && !error && photos.length === 0 && pending.length === 0 && (
        <Empty image={<CameraOutlined className={styles.emptyIcon} />} description="Фото пока нет" />
      )}

      <div className={styles.grid}>
        {photos.map((photo, index) => (
          <figure key={photo.id} className={styles.tile}>
            <div className={styles.frame}>
              <button
                type="button"
                className={styles.open}
                aria-label={`Открыть фото ${index + 1}`}
                onClick={() => preview.show(index)}
              >
                <PhotoThumb photoId={photo.id} alt={photo.caption ?? objectName} />
              </button>
              {!readOnly && (
                <Popconfirm
                  title="Удалить фото?"
                  okText="Удалить"
                  cancelText="Отмена"
                  okButtonProps={{ danger: true }}
                  placement="bottomRight"
                  onConfirm={() => onRemove(photo.id)}
                >
                  <Button
                    className={styles.remove}
                    shape="circle"
                    icon={<DeleteOutlined />}
                    aria-label="Удалить фото"
                  />
                </Popconfirm>
              )}
            </div>
            <figcaption className={styles.figcaption}>
              <PhotoCaption
                value={photo.caption}
                editable={!readOnly}
                onSave={(text) => onSaveCaption(photo.id, text)}
              />
            </figcaption>
          </figure>
        ))}
        {pending.map((p) => (
          <div key={p.key} className={styles.tile}>
            <div className={`${styles.frame} ${styles.pendingFrame}`}>
              <LoadingOutlined className={styles.pendingIcon} />
              <span className={styles.pendingText}>{p.stage === 'compress' ? 'Сжатие…' : 'Загрузка…'}</span>
            </div>
            <div className={styles.figcaption}>
              <div className={styles.caption}>{p.name}</div>
            </div>
          </div>
        ))}
      </div>

      <Image.PreviewGroup
        items={preview.items}
        preview={{
          visible: preview.open,
          current: preview.current,
          onVisibleChange: (visible) => {
            if (!visible) preview.hide();
          },
          onChange: preview.change,
        }}
      />
    </div>
  );
};
