import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FC, ReactNode } from 'react';
import { Alert, Button, Input, Segmented, Select, Typography, message, theme as antdTheme } from 'antd';
import {
  EnvironmentOutlined,
  LayoutOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
  createConstructionObject,
  deleteConstructionObject,
  updateConstructionObject,
} from '../../lib/api/constructionObjects';
import type { IConstructionObject, IConstructionObjectInput } from '../../lib/types/types';
import { ObjectPhotosDrawer } from './components/ObjectPhotosDrawer';
import type { ObjectDrawerTab } from './components/ObjectPhotosDrawer';
import { ObjectModal } from './components/ObjectModal';
import { ObjectsKpi } from './components/ObjectsKpi';
import { ObjectsList, ObjectsListSkeleton } from './components/ObjectsList';
import { ObjectsMap } from './components/ObjectsMap';
import type { IMapFocusRequest } from './components/ObjectsMap';
import { useConstructionObjects } from './hooks/useConstructionObjects';
import { useMediaQuery } from './hooks/useMediaQuery';
import { getObjectsCssVars } from './utils/cssVars';
import { getObjectsStats } from './utils/stats';
import styles from './Objects.module.css';

type StatusFilter = 'all' | 'current' | 'archive';

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'current', label: 'В работе' },
  { value: 'archive', label: 'Построенные' },
];

type ViewMode = 'split' | 'map';

const VIEW_MODE_KEY = 'objects_view_mode';

const VIEW_OPTIONS: { value: ViewMode; label: string; icon: ReactNode }[] = [
  { value: 'split', label: 'Карта и список', icon: <LayoutOutlined /> },
  { value: 'map', label: 'Только карта', icon: <EnvironmentOutlined /> },
];

const readViewMode = (): ViewMode => {
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) === 'map' ? 'map' : 'split';
  } catch {
    return 'split';
  }
};

/** Значение фильтра «Заказчик» для объектов без заказчика (в localStorage пишется как есть). */
const NO_CUSTOMER = '__none__';
const CUSTOMER_FILTER_KEY = 'objects_customer_filter';

const readCustomerFilter = (): string | null => {
  try {
    return window.localStorage.getItem(CUSTOMER_FILTER_KEY) || null;
  } catch {
    return null;
  }
};

const customerKey = (o: IConstructionObject): string => o.customer?.trim() || NO_CUSTOMER;

interface ICustomerOption {
  value: string;
  label: string;
}

/** Заказчики с числом объектов: по алфавиту, «Без заказчика» — в конце. */
const getCustomerOptions = (objects: readonly IConstructionObject[]): ICustomerOption[] => {
  const counts = new Map<string, number>();
  for (const o of objects) counts.set(customerKey(o), (counts.get(customerKey(o)) ?? 0) + 1);
  const options = [...counts.entries()]
    .filter(([key]) => key !== NO_CUSTOMER)
    .sort(([a], [b]) => a.localeCompare(b, 'ru'))
    .map(([key, count]) => ({ value: key, label: `${key} · ${count}` }));
  const none = counts.get(NO_CUSTOMER);
  if (none) options.push({ value: NO_CUSTOMER, label: `Без заказчика · ${none}` });
  return options;
};

const Objects: FC = () => {
  const { token } = antdTheme.useToken();
  const { user } = useAuth();
  const { isMobile } = useIsMobile();
  // Как на «Текущих объектах»: генеральный директор и телефоны — только просмотр.
  const readOnly = user?.role_code === 'general_director' || isMobile;
  // Карта и список рядом, у каждого свой скролл.
  const isSplit = useMediaQuery('(min-width: 1280px)');

  const { objects, loading, error, reload } = useConstructionObjects();
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [customerFilter, setCustomerFilter] = useState<string | null>(readCustomerFilter);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focus, setFocus] = useState<IMapFocusRequest | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<IConstructionObject | null>(null);
  const [photosObject, setPhotosObject] = useState<IConstructionObject | null>(null);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<ObjectDrawerTab>('photos');
  const [listPane, setListPane] = useState<HTMLDivElement | null>(null);
  const mapPaneRef = useRef<HTMLDivElement | null>(null);

  const customerOptions = useMemo(() => getCustomerOptions(objects), [objects]);

  // Сохранённый заказчик мог исчезнуть из данных — тогда фильтр не действует (пока данные не загружены, держим как есть).
  const activeCustomer =
    customerFilter !== null && (objects.length === 0 || customerOptions.some((x) => x.value === customerFilter))
      ? customerFilter
      : null;

  const handleCustomer = useCallback((value: string | null | undefined) => {
    const next = value ?? null;
    setCustomerFilter(next);
    try {
      if (next === null) window.localStorage.removeItem(CUSTOMER_FILTER_KEY);
      else window.localStorage.setItem(CUSTOMER_FILTER_KEY, next);
    } catch {
      // хранилище недоступно — выбор просто не запомнится
    }
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return objects.filter(
      (o) =>
        (filter === 'all' || o.status === filter) &&
        (activeCustomer === null || customerKey(o) === activeCustomer) &&
        (q === '' || o.name.toLowerCase().includes(q) || o.address.toLowerCase().includes(q)),
    );
  }, [objects, filter, activeCustomer, search]);

  const mapOnly = viewMode === 'map';

  const handleViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // хранилище недоступно — вид просто не запомнится
    }
  }, []);

  const stats = useMemo(() => getObjectsStats(filtered), [filtered]);

  // Клик по маркеру: подсветка и прокрутка списка к строке (только когда список — отдельная панель
  // со своим скроллом; иначе прокрутка страницы увела бы карту с экрана).
  const handleMapSelect = useCallback((id: string) => setSelectedId(id), []);

  useEffect(() => {
    if (!isSplit || mapOnly || !selectedId || !listPane) return;
    listPane
      .querySelector(`[data-row-key="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [isSplit, mapOnly, selectedId, listPane]);

  // Клик по карточке: карта летит к маркеру и открывает попап.
  const handleListSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      setFocus((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
      // Карта над списком — вернуть её в видимую область.
      if (!isSplit && !mapOnly) mapPaneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
    [isSplit, mapOnly],
  );

  const handleAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const handleEdit = useCallback((item: IConstructionObject) => {
    setEditing(item);
    setModalOpen(true);
  }, []);

  const openDrawer = useCallback((item: IConstructionObject, tab: ObjectDrawerTab) => {
    setPhotosObject(item);
    setDrawerTab(tab);
    setPhotosOpen(true);
  }, []);

  const handlePhotos = useCallback((item: IConstructionObject) => openDrawer(item, 'photos'), [openDrawer]);
  const handleDocuments = useCallback((item: IConstructionObject) => openDrawer(item, 'documents'), [openDrawer]);

  const handleSave = async (input: IConstructionObjectInput, id?: string): Promise<boolean> => {
    try {
      if (id) {
        await updateConstructionObject(id, input);
        message.success('Объект обновлён');
      } else {
        await createConstructionObject(input);
        message.success('Объект добавлен');
      }
      await reload();
      return true;
    } catch (e) {
      console.error('Error saving construction object:', e);
      message.error('Ошибка сохранения объекта');
      return false;
    }
  };

  const handleDelete = useCallback(
    async (item: IConstructionObject): Promise<void> => {
      try {
        await deleteConstructionObject(item.id);
        message.success('Объект удалён');
        setSelectedId((prev) => (prev === item.id ? null : prev));
        setHoveredId(null);
        await reload();
      } catch (e) {
        console.error('Error deleting construction object:', e);
        message.error('Ошибка удаления объекта');
      }
    },
    [reload],
  );

  const initialLoading = loading && objects.length === 0;

  return (
    <div className={styles.page} style={getObjectsCssVars(token)}>
      <div className={styles.header}>
        <Typography.Title level={4} className={styles.title}>
          Объекты
        </Typography.Title>
        <div className={styles.toolbar}>
          <Segmented<StatusFilter>
            className={styles.filter}
            options={FILTER_OPTIONS}
            value={filter}
            onChange={setFilter}
          />
          <Select<string>
            className={styles.customer}
            showSearch
            allowClear
            placeholder="Заказчик"
            aria-label="Заказчик"
            value={activeCustomer ?? undefined}
            options={customerOptions}
            optionFilterProp="label"
            popupMatchSelectWidth={360}
            onChange={handleCustomer}
          />
          <Segmented<ViewMode>
            className={styles.viewSwitch}
            options={VIEW_OPTIONS}
            value={viewMode}
            onChange={handleViewMode}
            aria-label="Вид страницы"
          />
          <div className={styles.search}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Поиск по названию или адресу"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {!readOnly && (
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
              Добавить объект
            </Button>
          )}
        </div>
      </div>

      <ObjectsKpi stats={stats} />

      {error && (
        <Alert
          type="error"
          showIcon
          message="Не удалось загрузить объекты"
          description={error}
          action={
            <Button size="small" onClick={() => void reload()}>
              Повторить
            </Button>
          }
        />
      )}

      <div className={`${styles.body} ${mapOnly ? styles.bodyMapOnly : ''}`}>
        <div ref={mapPaneRef} className={styles.mapPane}>
          <ObjectsMap
            objects={filtered}
            selectedId={selectedId}
            hoveredId={hoveredId}
            focus={focus}
            onSelect={handleMapSelect}
            onDocuments={handleDocuments}
          />
        </div>
        <div ref={setListPane} className={styles.listPane} hidden={mapOnly}>
          {initialLoading ? (
            <ObjectsListSkeleton />
          ) : (
            <ObjectsList
              objects={filtered}
              selectedId={selectedId}
              loading={loading}
              readOnly={readOnly}
              onSelect={handleListSelect}
              onHover={setHoveredId}
              onEdit={handleEdit}
              onPhotos={handlePhotos}
              onDocuments={handleDocuments}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>

      <ObjectPhotosDrawer
        open={photosOpen}
        object={photosObject}
        initialTab={drawerTab}
        readOnly={readOnly}
        onClose={() => setPhotosOpen(false)}
        onChanged={() => void reload()}
      />

      <ObjectModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
};

export default Objects;
