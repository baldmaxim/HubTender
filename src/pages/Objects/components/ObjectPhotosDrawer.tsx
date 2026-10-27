import { useState } from 'react';
import type { FC } from 'react';
import { Drawer, Tabs, theme as antdTheme } from 'antd';
import { useIsMobile } from '../../../hooks/useIsMobile';
import type { IConstructionObject } from '../../../lib/types/types';
import { useObjectDocuments } from '../hooks/useObjectDocuments';
import { useObjectPhotos } from '../hooks/useObjectPhotos';
import { getObjectsCssVars } from '../utils/cssVars';
import { ObjectDocumentsTab } from './ObjectDocumentsTab';
import { ObjectPhotosTab } from './ObjectPhotosTab';
import styles from './ObjectPhotosDrawer.module.css';

export type ObjectDrawerTab = 'photos' | 'documents';

interface IObjectPhotosDrawerProps {
  open: boolean;
  /** Объект остаётся заданным и после закрытия — заголовок не мигает во время анимации. */
  object: IConstructionObject | null;
  /** Вкладка, на которой окно открывается. */
  initialTab: ObjectDrawerTab;
  readOnly: boolean;
  onClose: () => void;
  /** Фото или документы изменились — обновить список объектов (photo_count, cover_photo_id, document_count). */
  onChanged: () => void;
}

interface IDrawerContentProps {
  object: IConstructionObject;
  initialTab: ObjectDrawerTab;
  readOnly: boolean;
  onChanged: () => void;
}

/** Содержимое окна объекта: Drawer уничтожает его при закрытии, поэтому вкладка и blob URL сбрасываются. */
const DrawerContent: FC<IDrawerContentProps> = ({ object, initialTab, readOnly, onChanged }) => {
  const { token } = antdTheme.useToken();
  const [tab, setTab] = useState<ObjectDrawerTab>(initialTab);
  const photosState = useObjectPhotos(object.id, onChanged);
  const docsState = useObjectDocuments(object.id, onChanged);

  // Пока списки не загрузились — числа из карточки объекта.
  const photoCount = photosState.loading && photosState.photos.length === 0 ? object.photo_count : photosState.photos.length;
  const documentCount =
    docsState.loading && docsState.documents.length === 0 ? object.document_count : docsState.documents.length;

  return (
    <div className={styles.body} style={getObjectsCssVars(token)}>
      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as ObjectDrawerTab)}
        className={styles.tabs}
        items={[
          {
            key: 'photos',
            label: `Фото · ${photoCount}`,
            children: (
              <ObjectPhotosTab
                objectName={object.name}
                photos={photosState.photos}
                loading={photosState.loading}
                error={photosState.error}
                pending={photosState.pending}
                readOnly={readOnly}
                onReload={() => void photosState.reloadList()}
                onUpload={photosState.upload}
                onSaveCaption={photosState.saveCaption}
                onRemove={photosState.remove}
              />
            ),
          },
          {
            key: 'documents',
            label: `Документы · ${documentCount}`,
            children: (
              <ObjectDocumentsTab
                documents={docsState.documents}
                loading={docsState.loading}
                error={docsState.error}
                pending={docsState.pending}
                readOnly={readOnly}
                onReload={() => void docsState.reloadList()}
                onUpload={docsState.upload}
                onSave={docsState.save}
                onRemove={docsState.remove}
              />
            ),
          },
        ]}
      />
    </div>
  );
};

export const ObjectPhotosDrawer: FC<IObjectPhotosDrawerProps> = ({
  open,
  object,
  initialTab,
  readOnly,
  onClose,
  onChanged,
}) => {
  const { isMobile } = useIsMobile();

  return (
    <Drawer
      open={open}
      destroyOnHidden
      onClose={onClose}
      placement={isMobile ? 'bottom' : 'right'}
      width={isMobile ? '100%' : 640}
      height="92dvh"
      title={object?.name ?? ''}
      rootClassName={styles.drawer}
      styles={{ body: { padding: 0 } }}
    >
      {object && <DrawerContent object={object} initialTab={initialTab} readOnly={readOnly} onChanged={onChanged} />}
    </Drawer>
  );
};
