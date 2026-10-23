import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { FC } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { useTheme } from '../../../contexts/ThemeContext';
import { useIsTabActive } from '../../../hooks/useIsTabActive';
import type { IConstructionObject } from '../../../lib/types/types';
import { createClusterGroup } from '../utils/clusterGroup';
import { OBJECT_KIND_ORDER, getObjectKind } from '../utils/objectKind';
import { MapLegend } from './MapLegend';
import { createClusterIcon, createObjectMarker, getMarkerOptions } from './markerIcons';
import { buildObjectPopup } from './objectPopup';
import styles from './ObjectsMap.module.css';

export interface IMapFocusRequest {
  id: string;
  nonce: number;
}

interface IObjectsMapProps {
  /** Объекты текущего фильтра (без координат на карте не рисуются). */
  objects: IConstructionObject[];
  selectedId: string | null;
  /** Карточка под курсором — маркер подсвечивается. */
  hoveredId: string | null;
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
/** Через сколько «раскрыть» кластер вручную, если приближение к маркеру не помогло. */
const REVEAL_FALLBACK_MS = 1200;

const hasCoords = (o: IConstructionObject): boolean => o.latitude !== null && o.longitude !== null;

export const ObjectsMap: FC<IObjectsMapProps> = ({ objects, selectedId, hoveredId, focus, onSelect }) => {
  const { theme } = useTheme();
  const isTabActive = useIsTabActive();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const hoveredClusterRef = useRef<HTMLElement | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const boundsRef = useRef<L.LatLngBounds | null>(null);
  const idsKeyRef = useRef<string>('');
  const needFitRef = useRef(false);

  const onSelectRef = useRef(onSelect);
  const selectedIdRef = useRef(selectedId);
  const hoveredIdRef = useRef(hoveredId);

  useEffect(() => {
    onSelectRef.current = onSelect;
    selectedIdRef.current = selectedId;
    hoveredIdRef.current = hoveredId;
  });

  /** Типы объектов на карте — для легенды. */
  const kinds = useMemo(() => {
    const present = new Set(objects.filter(hasCoords).map((o) => getObjectKind(o.name)));
    return OBJECT_KIND_ORDER.filter((kind) => present.has(kind));
  }, [objects]);

  /** Класс «выбран / под курсором» — на DOM-элементе маркера (он пересоздаётся при выходе из кластера). */
  const applyMarkerState = useCallback((marker: L.Marker) => {
    const element = marker.getElement();
    if (!element) return;
    const { objectId } = getMarkerOptions(marker);
    element.classList.toggle(styles.pinSelected, objectId === selectedIdRef.current);
    element.classList.toggle(styles.pinHover, objectId === hoveredIdRef.current);
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
    const map = L.map(el, { scrollWheelZoom: true, zoomControl: false }).setView(DEFAULT_CENTER, 9);
    // Масштаб справа внизу: сверху остаётся место под попап, слева внизу — легенда.
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    map.attributionControl.setPrefix(LEAFLET_PREFIX);
    const cluster = createClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 48,
      animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      iconCreateFunction: createClusterIcon,
      spiderLegPolylineOptions: { className: styles.spiderLeg, weight: 1.5 },
    });
    map.addLayer(cluster);
    clusterRef.current = cluster;
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
      if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      markers.clear();
    };
  }, [tryFit]);

  // Перестроение маркеров при смене набора объектов.
  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;
    cluster.clearLayers();
    markersRef.current.clear();

    const points: L.LatLngTuple[] = [];
    const markers: L.Marker[] = [];
    for (const o of objects) {
      if (o.latitude === null || o.longitude === null) continue;
      const latlng: L.LatLngTuple = [o.latitude, o.longitude];
      points.push(latlng);
      const marker = createObjectMarker(o, latlng);
      marker.bindPopup(() => buildObjectPopup(o), {
        minWidth: 240,
        maxWidth: 300, // влезает в карту шириной 360 px
        autoPanPadding: [16, 16],
      });
      marker.on('click', () => onSelectRef.current(o.id));
      marker.on('add', () => applyMarkerState(marker));
      markers.push(marker);
      markersRef.current.set(o.id, marker);
    }
    cluster.addLayers(markers);

    // Переподгонять вид только когда изменился набор видимых объектов (фильтр/поиск/загрузка),
    // а не после правки соседнего объекта или смены темы.
    const idsKey = [...markersRef.current.keys()].join('|');
    if (idsKey !== idsKeyRef.current) {
      idsKeyRef.current = idsKey;
      needFitRef.current = true;
    }
    boundsRef.current = points.length > 0 ? L.latLngBounds(points) : null;
    tryFit();
  }, [objects, applyMarkerState, tryFit]);

  // Выбранный и подсвеченный маркер: крупнее, с кольцом, поверх соседей.
  useEffect(() => {
    const cluster = clusterRef.current;
    markersRef.current.forEach((marker, id) => {
      applyMarkerState(marker);
      marker.setZIndexOffset(id === selectedId ? 1000 : id === hoveredId ? 500 : 0);
    });
    // Маркер спрятан в кластере — подсвечиваем сам кластер.
    hoveredClusterRef.current?.classList.remove(styles.clusterHover);
    hoveredClusterRef.current = null;
    const hovered = hoveredId ? markersRef.current.get(hoveredId) : undefined;
    if (cluster && hovered) {
      const parent = cluster.getVisibleParent(hovered);
      const element = parent && parent !== hovered ? parent.getElement() : undefined;
      if (element) {
        element.classList.add(styles.clusterHover);
        hoveredClusterRef.current = element;
      }
    }
  }, [selectedId, hoveredId, applyMarkerState]);

  // Вкладка keep-alive скрыта display:none → при показе пересчитать размер и подогнать вид.
  useEffect(() => {
    if (!isTabActive) return undefined;
    const frame = window.requestAnimationFrame(() => {
      mapRef.current?.invalidateSize();
      tryFit();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isTabActive, tryFit]);

  // Клик по карточке: подлететь к маркеру (выйти из кластера) и открыть попап.
  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster || !focus) return;
    const marker = markersRef.current.get(focus.id);
    if (!marker) return;
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);

    let opened = false;
    const open = () => {
      if (opened) return;
      opened = true;
      marker.openPopup();
    };
    const reveal = () => {
      cluster.zoomToShowLayer(marker, open);
      // Совпадающие координаты: на максимальном зуме кластер сам не разойдётся — раскрываем веером.
      revealTimerRef.current = window.setTimeout(() => {
        if (opened) return;
        const parent = cluster.getVisibleParent(marker);
        if (parent !== marker) (parent as L.MarkerCluster).spiderfy();
        open();
      }, REVEAL_FALLBACK_MS);
    };

    const target = marker.getLatLng();
    const zoom = Math.max(map.getZoom(), FOCUS_ZOOM);
    // flyTo в ту же точку с тем же зумом даёт NaN-кадры в Leaflet — сразу раскрываем.
    if (map.getZoom() === zoom && map.getCenter().distanceTo(target) < 1) {
      reveal();
      return;
    }
    map.once('moveend', reveal);
    map.flyTo(target, zoom, { duration: 0.8 });
  }, [focus]);

  return (
    <>
      <div className={`${styles.mapRoot} ${theme === 'dark' ? styles.dark : ''}`}>
        <div ref={containerRef} className={styles.mapCanvas} />
      </div>
      <MapLegend kinds={kinds} />
    </>
  );
};
