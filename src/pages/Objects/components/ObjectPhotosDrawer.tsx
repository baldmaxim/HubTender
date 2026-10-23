import { useCallback, useEffect, useState } from 'react';
import type { FC } from 'react';
import { Alert, Button, Drawer, Empty, Image, Popconfirm, Spin, Upload, theme as antdTheme } from 'antd';
import { CameraOutlined, DeleteOutlined, InboxOutlined, LoadingOutlined } from '@ant-design/icons';
import { useIsMobile } from '../../../hooks/useIsMobile';
import type { IConstructionObject } from '../../../lib/types/types';
import { MAX_PHOTOS_PER_OBJECT, useObjectPhotos } from '../hooks/useObjectPhotos';
import { getObjectsCssVars } from '../utils/cssVars';
import { loadPhotoUrl, peekPhotoUrl } from '../utils/photoCache';
import { PhotoCaption } from './PhotoCaption';
import { PhotoThumb } from './PhotoThumb';
import styles from './ObjectPhotosDrawer.module.css';

interface IObjectPhotosDrawerProps {
  open: boolean;
  /** Объект остаётся заданным и после закрытия — заголовок не мигает во время анимации. */
  object: IConstructionObject | null;
  readOnly: boolean;
  onClose: () => void;
  /** Фото добавлены/удалены — обновить список объектов (photo_count, cover_photo_id). */
  onChanged: () => void;
}

// Прозрачный пиксель, пока ни миниатюра, ни полное фото не загружены.
const BLANK_SRC = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

export const ObjectPhotosDrawer: FC<IObjectPhotosDrawerProps> = ({ open, object, readOnly, onClose, onChanged }) => {
  const { token } = antdTheme.useToken();
  const { isMobile } = useIsMobile();
  const { photos, loading, error, pending, reloadList, upload, saveCaption, remove } = useObjectPhotos(
    open && object ? object.id : null,
    onChanged,
  );

  const [previewOpen, setPreviewOpen] = useState(false);
  const [current, setCurrent] = useState(0);
  // Полные фото грузим по требованию: растёт при смене текущего кадра в просмотре.
  const [, setFullVersion] = useState(0);

  const ensureFull = useCallback(
    (index: number) => {
      for (const i of [index, index + 1, index - 1]) {
        const photo = photos[i];
        if (!photo || peekPhotoUrl(photo.id, 'full')) continue;
        // Ошибку не показываем здесь: просмотр останется на миниатюре.
        loadPhotoUrl(photo.id, 'full').then(
          () => setFullVersion((v) => v + 1),
          () => undefined,
        );
      }
    },
    [photos],
  );

  useEffect(() => {
    if (!open) setPreviewOpen(false);
  }, [open]);

  const openPreview = (index: number) => {
    setCurrent(index);
    ensureFull(index);
    setPreviewOpen(true);
  };

  const canUpload = !readOnly && photos.length + pending.length < MAX_PHOTOS_PER_OBJECT;
  const items = photos.map((p) => ({
    src: peekPhotoUrl(p.id, 'full') ?? peekPhotoUrl(p.id, 'thumb') ?? BLANK_SRC,
    alt: p.caption ?? object?.name ?? 'Фото',
  }));

  return (
    <Drawer
      open={open}
      destroyOnHidden
      onClose={onClose}
      placement={isMobile ? 'bottom' : 'right'}
      width={isMobile ? '100%' : 640}
      height="92dvh"
      title={`Фото: ${object?.name ?? ''}`}
      rootClassName={styles.drawer}
      styles={{ body: { padding: 0 } }}
    >
      <div className={styles.body} style={getObjectsCssVars(token)}>
        {!readOnly && (
          <div className={styles.upload}>
            <Upload.Dragger
              multiple
              accept="image/*"
              showUploadList={false}
              disabled={!canUpload}
              beforeUpload={(file, fileList) => {
                // beforeUpload зовётся на каждый файл; забираем всю пачку один раз.
                if (file === fileList[0]) void upload(fileList);
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
              <Button size="small" onClick={() => void reloadList()}>
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
                  onClick={() => openPreview(index)}
                >
                  <PhotoThumb photoId={photo.id} alt={photo.caption ?? object?.name ?? 'Фото'} />
                </button>
                {!readOnly && (
                  <Popconfirm
                    title="Удалить фото?"
                    okText="Удалить"
                    cancelText="Отмена"
                    okButtonProps={{ danger: true }}
                    placement="bottomRight"
                    onConfirm={() => remove(photo.id)}
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
                  onSave={(text) => saveCaption(photo.id, text)}
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
      </div>

      <Image.PreviewGroup
        items={items}
        preview={{
          visible: previewOpen,
          current,
          onVisibleChange: (visible) => setPreviewOpen(visible),
          onChange: (next) => {
            setCurrent(next);
            ensureFull(next);
          },
        }}
      />
    </Drawer>
  );
};
