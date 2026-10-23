import { memo, useState } from 'react';
import type { FC } from 'react';
import { Button, Dropdown, Popconfirm } from 'antd';
import type { MenuProps } from 'antd';
import { CameraOutlined, DeleteOutlined, EditOutlined, MoreOutlined } from '@ant-design/icons';
import type { IConstructionObject } from '../../../lib/types/types';
import { formatCommissioning } from '../utils/commissioning';
import { formatAreaValue } from '../utils/format';
import { OBJECT_KIND_LABELS, getObjectKind } from '../utils/objectKind';
import { STATUS_LABELS } from '../utils/status';
import { Glyph } from './Glyph';
import { PhotoThumb } from './PhotoThumb';
import styles from './ObjectCard.module.css';

interface IObjectCardProps {
  object: IConstructionObject;
  selected: boolean;
  readOnly: boolean;
  onSelect: (id: string) => void;
  /** Курсор над карточкой (только мышь) — карта подсвечивает маркер. */
  onHover: (id: string | null) => void;
  onEdit: (item: IConstructionObject) => void;
  onPhotos: (item: IConstructionObject) => void;
  onDelete: (item: IConstructionObject) => Promise<void>;
}

const MENU_ITEMS: MenuProps['items'] = [
  { key: 'edit', icon: <EditOutlined />, label: 'Изменить' },
  { key: 'photos', icon: <CameraOutlined />, label: 'Фото' },
  { key: 'delete', icon: <DeleteOutlined />, label: 'Удалить', danger: true },
];

const ObjectCardView: FC<IObjectCardProps> = ({
  object: o,
  selected,
  readOnly,
  onSelect,
  onHover,
  onEdit,
  onPhotos,
  onDelete,
}) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const kind = getObjectKind(o.name);
  const isCurrent = o.status === 'current';
  const onMap = o.latitude !== null && o.longitude !== null;
  const commissioning = formatCommissioning(o.commissioning_start_date, o.commissioning_date);

  const className = [
    styles.card,
    isCurrent ? styles.cardCurrent : styles.cardArchive,
    selected ? styles.cardSelected : '',
    o.cover_photo_id ? styles.cardHasCover : '',
  ].join(' ');

  return (
    <article
      data-row-key={o.id}
      className={className}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') onHover(o.id);
      }}
      onPointerLeave={() => onHover(null)}
    >
      {o.cover_photo_id && (
        <button
          type="button"
          className={styles.cover}
          aria-label={`Фото объекта: ${o.photo_count}`}
          onClick={() => onPhotos(o)}
        >
          <PhotoThumb photoId={o.cover_photo_id} alt={o.name} />
          <span className={styles.coverBadge}>
            <CameraOutlined />
            {o.photo_count}
          </span>
        </button>
      )}

      <div className={styles.top}>
        <span className={styles.tile}>
          <Glyph name={kind} size={22} />
        </span>
        <div className={styles.badges}>
          <span className={styles.kind}>{OBJECT_KIND_LABELS[kind]}</span>
          <div className={styles.chips}>
            <span className={styles.chip}>
              <i className={styles.chipDot} />
              {STATUS_LABELS[o.status]}
            </span>
            {!onMap && (
              <span className={styles.noMap}>
                <Glyph name="mapOff" size={13} />
                Нет на карте
              </span>
            )}
          </div>
        </div>
        {!readOnly && (
          <Popconfirm
            open={confirmOpen}
            title="Удалить объект?"
            description={o.name}
            okText="Удалить"
            cancelText="Отмена"
            okButtonProps={{ danger: true }}
            placement="bottomRight"
            onOpenChange={(open) => {
              if (!open) setConfirmOpen(false);
            }}
            onConfirm={() => {
              setConfirmOpen(false);
              void onDelete(o);
            }}
            onCancel={() => setConfirmOpen(false)}
          >
            <span className={styles.menu}>
              <Dropdown
                trigger={['click']}
                placement="bottomRight"
                menu={{
                  items: MENU_ITEMS,
                  onClick: ({ key }) => {
                    if (key === 'edit') onEdit(o);
                    else if (key === 'photos') onPhotos(o);
                    else setConfirmOpen(true);
                  },
                }}
              >
                <Button
                  type="text"
                  className={styles.menuButton}
                  icon={<MoreOutlined />}
                  aria-label={`Действия: ${o.name}`}
                />
              </Dropdown>
            </span>
          </Popconfirm>
        )}
      </div>

      <h3 className={styles.name}>
        <button
          type="button"
          className={styles.hit}
          title={o.name}
          aria-pressed={selected}
          onClick={() => onSelect(o.id)}
        >
          <span className={styles.nameText}>{o.name}</span>
        </button>
      </h3>

      {o.customer && (
        <div className={styles.row}>
          <Glyph name="briefcase" size={15} className={styles.rowIcon} />
          <span className={styles.rowText}>{o.customer}</span>
        </div>
      )}

      <div className={styles.foot}>
        <div className={styles.area}>
          {o.area === null ? (
            <span className={styles.areaEmpty}>Площадь не указана</span>
          ) : (
            <>
              {formatAreaValue(o.area)}
              <span className={styles.areaUnit}>&nbsp;м²</span>
            </>
          )}
        </div>
        <div className={styles.row}>
          <Glyph name="pin" size={15} className={styles.rowIcon} />
          <span className={styles.rowText}>{o.address}</span>
        </div>
        {commissioning && (
          <div
            className={`${styles.row} ${styles.rowLive}`}
            title={commissioning.title}
            onClick={() => onSelect(o.id)}
          >
            <Glyph name="calendar" size={15} className={styles.rowIcon} />
            <span className={styles.rowText}>Ввод: {commissioning.text}</span>
          </div>
        )}
        {o.project_name && (
          <div className={styles.row}>
            <Glyph name="file" size={15} className={styles.rowIcon} />
            <span className={styles.rowText}>Договор: {o.project_name}</span>
          </div>
        )}
        {!readOnly && !o.cover_photo_id && (
          <Button
            type="text"
            size="small"
            className={styles.photoButton}
            icon={<CameraOutlined />}
            onClick={() => onPhotos(o)}
          >
            Добавить фото
          </Button>
        )}
      </div>
    </article>
  );
};

export const ObjectCard = memo(ObjectCardView);
