import { useEffect, useRef } from 'react';
import type { FC } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { IGeoPoint } from '../utils/geocode';
import styles from '../Objects.module.css';

interface IPointPickerMapProps {
  point: IGeoPoint | null;
  /** Растёт, когда точку нужно показать в центре (после поиска по адресу). */
  centerNonce: number;
  onChange: (point: IGeoPoint) => void;
}

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const LEAFLET_PREFIX = '<a href="https://leafletjs.com">Leaflet</a>';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const DEFAULT_CENTER: L.LatLngTuple = [55.75, 37.62];

/** Мини-карта выбора точки: клик ставит/переносит маркер, маркер перетаскивается. */
export const PointPickerMap: FC<IPointPickerMapProps> = ({ point, centerNonce, onChange }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const pointRef = useRef(point);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    pointRef.current = point;
    onChangeRef.current = onChange;
  });

  // Создание карты (один раз за открытие модалки).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const initial = pointRef.current;
    const map = L.map(el, { scrollWheelZoom: true }).setView(
      initial ? [initial.lat, initial.lng] : DEFAULT_CENTER,
      initial ? 15 : 9,
    );
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    map.attributionControl.setPrefix(LEAFLET_PREFIX);
    map.on('click', (e: L.LeafletMouseEvent) => {
      onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    mapRef.current = map;

    // Модалка анимируется и может иметь нулевой размер в момент создания карты.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(el);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // Маркер следует за точкой.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!point) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const latlng: L.LatLngTuple = [point.lat, point.lng];
    if (markerRef.current) {
      markerRef.current.setLatLng(latlng);
      return;
    }
    const marker = L.marker(latlng, {
      draggable: true,
      icon: L.divIcon({ className: styles.pin, iconSize: [22, 22], iconAnchor: [11, 11] }),
    });
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      onChangeRef.current({ lat: p.lat, lng: p.lng });
    });
    marker.addTo(map);
    markerRef.current = marker;
  }, [point]);

  // Показать найденную по адресу точку в центре.
  useEffect(() => {
    const target = pointRef.current;
    if (centerNonce === 0 || !target) return;
    mapRef.current?.setView([target.lat, target.lng], 16);
  }, [centerNonce]);

  return (
    <div className={styles.pickerWrap}>
      <div ref={containerRef} className={styles.pickerMap} />
    </div>
  );
};
