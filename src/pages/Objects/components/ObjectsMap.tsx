import { useCallback, useEffect, useRef } from 'react';
import type { FC } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { theme as antdTheme } from 'antd';
import { useTheme } from '../../../contexts/ThemeContext';
import { useIsTabActive } from '../../../hooks/useIsTabActive';
import type { IConstructionObject } from '../../../lib/types/types';
import { formatArea, formatDate } from '../utils/format';
import styles from '../Objects.module.css';

export interface IMapFocusRequest {
  id: string;
  nonce: number;
}

interface IObjectsMapProps {
  /** Объекты текущего фильтра (без координат на карте не рисуются). */
  objects: IConstructionObject[];
  selectedId: string | null;
  /** Запрос из списка: подлететь к маркеру и открыть попап. */
  focus: IMapFocusRequest | null;
  onSelect: (id: string) => void;
}

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const LEAFLET_PREFIX = '<a href="https://leafletjs.com">Leaflet</a>';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const DEFAULT_CENTER: L.LatLngTuple = [55.75, 37.62];
const FOCUS_ZOOM = 15;

const buildPopup = (o: IConstructionObject): HTMLElement => {
  const root = document.createElement('div');
  root.className = styles.popup;
  const add = (cls: string, text: string) => {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    root.appendChild(el);
  };
  add(styles.popupName, o.name);
  add(styles.popupRow, formatArea(o.area));
  add(styles.popupRow, o.address);
  if (o.commissioning_date) add(styles.popupRow, `Дата ввода: ${formatDate(o.commissioning_date)}`);
  if (o.project_name) add(styles.popupRow, `Договор: ${o.project_name}`);
  return root;
};

export const ObjectsMap: FC<IObjectsMapProps> = ({ objects, selectedId, focus, onSelect }) => {
  const { theme } = useTheme();
  const { token } = antdTheme.useToken();
  const isTabActive = useIsTabActive();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const objectsByIdRef = useRef<Map<string, IConstructionObject>>(new Map());
  const boundsRef = useRef<L.LatLngBounds | null>(null);
  const idsKeyRef = useRef<string>('');
  const needFitRef = useRef(false);

  const onSelectRef = useRef(onSelect);
  const selectedIdRef = useRef(selectedId);
  const colorsRef = useRef({
    current: token.colorPrimary,
    archive: token.colorInfo,
    ring: token.colorBgContainer,
    selectedRing: token.colorText,
  });

  useEffect(() => {
    onSelectRef.current = onSelect;
    selectedIdRef.current = selectedId;
    colorsRef.current = {
      current: token.colorPrimary,
      archive: token.colorInfo,
      ring: token.colorBgContainer,
      selectedRing: token.colorText,
    };
  });

  const styleFor = useCallback((o: IConstructionObject, selected: boolean): L.CircleMarkerOptions => {
    const c = colorsRef.current;
    return {
      radius: selected ? 11 : 8,
      color: selected ? c.selectedRing : c.ring,
      weight: selected ? 3 : 2,
      fillColor: o.status === 'current' ? c.current : c.archive,
      fillOpacity: 0.95,
    };
  }, []);

  /** Подгоняет вид под маркеры. Ждёт, пока контейнер получит размер (вкладка могла быть скрыта). */
  const tryFit = useCallback(() => {
    const map = mapRef.current;
    const el = containerRef.current;
    if (!map || !el || !needFitRef.current) return;
    if (el.clientWidth === 0 || el.clientHeight === 0) return;
    map.invalidateSize();
    const bounds = boundsRef.current;
    if (bounds?.isValid()) {
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: FOCUS_ZOOM, animate: false });
    }
    needFitRef.current = false;
  }, []);

  // Создание карты (один раз).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const map = L.map(el, { scrollWheelZoom: true, zoomControl: true }).setView(DEFAULT_CENTER, 9);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    map.attributionControl.setPrefix(LEAFLET_PREFIX);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const markers = markersRef.current;
    needFitRef.current = true; // новая карта (в т.ч. повторный монтаж в StrictMode) — подогнать вид

    // Размер контейнера меняется при ресайзе окна, раскладке и показе скрытой вкладки.
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      tryFit();
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      markers.clear();
    };
  }, [tryFit]);

  // Перестроение маркеров при смене объектов/цветов темы.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    markersRef.current.clear();
    objectsByIdRef.current.clear();

    const points: L.LatLngTuple[] = [];
    for (const o of objects) {
      if (o.latitude === null || o.longitude === null) continue;
      const latlng: L.LatLngTuple = [o.latitude, o.longitude];
      points.push(latlng);
      const marker = L.circleMarker(latlng, styleFor(o, o.id === selectedIdRef.current));
      marker.bindPopup(() => buildPopup(o));
      marker.on('click', () => onSelectRef.current(o.id));
      marker.addTo(layer);
      markersRef.current.set(o.id, marker);
      objectsByIdRef.current.set(o.id, o);
    }

    // Переподгонять вид только когда изменился набор видимых объектов (фильтр/поиск/загрузка),
    // а не после правки соседнего объекта или смены темы.
    const idsKey = [...markersRef.current.keys()].join('|');
    if (idsKey !== idsKeyRef.current) {
      idsKeyRef.current = idsKey;
      needFitRef.current = true;
    }
    boundsRef.current = points.length > 0 ? L.latLngBounds(points) : null;
    tryFit();
  }, [objects, token.colorPrimary, token.colorInfo, token.colorBgContainer, token.colorText, styleFor, tryFit]);

  // Подсветка выбранного маркера.
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const o = objectsByIdRef.current.get(id);
      if (!o) return;
      const selected = id === selectedId;
      marker.setStyle(styleFor(o, selected));
      if (selected) marker.bringToFront();
    });
  }, [selectedId, styleFor]);

  // Вкладка keep-alive скрыта display:none → при показе пересчитать размер и подогнать вид.
  useEffect(() => {
    if (!isTabActive) return undefined;
    const frame = window.requestAnimationFrame(() => {
      mapRef.current?.invalidateSize();
      tryFit();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isTabActive, tryFit]);

  // Клик по строке списка: подлететь к маркеру и открыть попап.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const marker = markersRef.current.get(focus.id);
    if (!marker) return;
    const target = marker.getLatLng();
    const zoom = Math.max(map.getZoom(), FOCUS_ZOOM);
    // flyTo в ту же точку с тем же зумом даёт NaN-кадры в Leaflet — просто открываем попап.
    if (map.getZoom() === zoom && map.getCenter().distanceTo(target) < 1) {
      marker.openPopup();
      return;
    }
    map.once('moveend', () => marker.openPopup());
    map.flyTo(target, zoom, { duration: 0.8 });
  }, [focus]);

  return (
    <>
      <div className={`${styles.mapRoot} ${theme === 'dark' ? styles.dark : ''}`}>
        <div ref={containerRef} className={styles.mapCanvas} />
      </div>
      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.dotCurrent}`} />
          Текущие
        </div>
        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.dotArchive}`} />
          Построенные
        </div>
      </div>
    </>
  );
};
