import type { FC } from 'react';
import { Button, Empty, Popconfirm, Space, Table, Tooltip } from 'antd';
import type { TableColumnsType } from 'antd';
import { DeleteOutlined, EditOutlined, EyeInvisibleOutlined } from '@ant-design/icons';
import type { IConstructionObject } from '../../../lib/types/types';
import { formatArea, formatAreaValue, formatDate } from '../utils/format';
import styles from '../Objects.module.css';

interface IObjectsListProps {
  objects: IConstructionObject[];
  selectedId: string | null;
  loading: boolean;
  /** Телефон: карточки вместо таблицы (на телефоне правка недоступна — как на «Текущих объектах»). */
  cards: boolean;
  readOnly: boolean;
  /** Контейнер со скроллом (десктоп) — для залипающей шапки таблицы. */
  scrollContainer: HTMLElement | null;
  onSelect: (id: string) => void;
  onEdit: (item: IConstructionObject) => void;
  onDelete: (item: IConstructionObject) => Promise<void>;
}

const hasCoords = (o: IConstructionObject): boolean => o.latitude !== null && o.longitude !== null;

const NoMapMark: FC = () => (
  <Tooltip title="Нет на карте">
    <EyeInvisibleOutlined className={styles.noMapIcon} aria-label="Нет на карте" />
  </Tooltip>
);

export const ObjectsList: FC<IObjectsListProps> = ({
  objects,
  selectedId,
  loading,
  cards,
  readOnly,
  scrollContainer,
  onSelect,
  onEdit,
  onDelete,
}) => {
  if (cards) {
    if (objects.length === 0) return <Empty description="Нет объектов" />;
    return (
      <div className={styles.cards}>
        {objects.map((o, index) => (
          <div
            key={o.id}
            data-row-key={o.id}
            role="button"
            tabIndex={0}
            className={`${styles.card} ${o.id === selectedId ? styles.cardSelected : ''}`}
            onClick={() => onSelect(o.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSelect(o.id);
            }}
          >
            <div className={styles.cardName}>
              {!hasCoords(o) && <NoMapMark />}
              {index + 1}. {o.name}
            </div>
            <div className={styles.cardMeta}>{formatArea(o.area)}</div>
            <div className={styles.cardMeta}>{o.address}</div>
            {o.commissioning_date && (
              <div className={styles.cardMeta}>Дата ввода: {formatDate(o.commissioning_date)}</div>
            )}
          </div>
        ))}
      </div>
    );
  }

  const columns: TableColumnsType<IConstructionObject> = [
    {
      title: '№',
      key: 'index',
      width: 44,
      render: (_v, _o, index) => index + 1,
    },
    {
      title: 'Название',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, o) => (
        <span>
          {!hasCoords(o) && <NoMapMark />}
          {name}
        </span>
      ),
    },
    {
      title: 'Площадь, м²',
      dataIndex: 'area',
      key: 'area',
      width: 104,
      align: 'right',
      render: (area: number | null) => formatAreaValue(area),
    },
    {
      title: 'Адрес',
      dataIndex: 'address',
      key: 'address',
    },
  ];

  // Даты ввода пока не заполнены — колонку показываем, когда появится хотя бы одна.
  if (objects.some((o) => o.commissioning_date)) {
    columns.push({
      title: 'Дата ввода',
      dataIndex: 'commissioning_date',
      key: 'commissioning_date',
      width: 100,
      render: (value: string | null) => formatDate(value),
    });
  }

  if (!readOnly) {
    columns.push({
      title: '',
      key: 'actions',
      width: 76,
      render: (_v, o) => (
        <Space size={4} onClick={(e) => e.stopPropagation()}>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            aria-label="Изменить"
            onClick={() => onEdit(o)}
          />
          <Popconfirm
            title="Удалить объект?"
            description={o.name}
            okText="Удалить"
            cancelText="Отмена"
            okButtonProps={{ danger: true }}
            onConfirm={() => onDelete(o)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label="Удалить" />
          </Popconfirm>
        </Space>
      ),
    });
  }

  return (
    <Table<IConstructionObject>
      size="small"
      rowKey="id"
      loading={loading}
      columns={columns}
      dataSource={objects}
      pagination={false}
      sticky={scrollContainer ? { getContainer: () => scrollContainer } : false}
      locale={{ emptyText: <Empty description="Нет объектов" /> }}
      rowClassName={(o) => `${styles.row} ${o.id === selectedId ? styles.selectedRow : ''}`}
      onRow={(o) => ({ onClick: () => onSelect(o.id) })}
    />
  );
};
