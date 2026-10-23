import * as L from 'leaflet';
import type { ConstructionObjectStatus, IConstructionObject } from '../../../lib/types/types';
import { GLYPH_PATHS } from '../utils/glyphs';
import { getObjectKind } from '../utils/objectKind';
import styles from './ObjectsMap.module.css';

/** Поля, которые маркер хранит об объекте (читаются при сборке кластера и подсветке). */
export interface IObjectMarkerOptions extends L.MarkerOptions {
  objectId: string;
  objectStatus: ConstructionObjectStatus;
}

export const getMarkerOptions = (marker: L.Marker): IObjectMarkerOptions =>
  marker.options as IObjectMarkerOptions;

// Капля в системе координат 40×54: тело, круглая «монета» под значок и сам значок внутри.
const PIN_BODY =
  'M20 51C20 51 3 32.5 3 19.5 3 10.4 10.6 3 20 3s17 7.4 17 16.5C37 32.5 20 51 20 51z';
const PIN_VIEW_W = 40;
const PIN_VIEW_H = 54;
/** Объекты «в работе» чуть крупнее — отличаются не только цветом. */
const PIN_WIDTH: Record<ConstructionObjectStatus, number> = { current: 34, archive: 28 };

const createPinIcon = (o: IConstructionObject): L.DivIcon => {
  const paths = GLYPH_PATHS[getObjectKind(o.name)].map((d) => `<path d="${d}"/>`).join('');
  const html =
    `<div class="${styles.pinWrap}">` +
    `<svg class="${styles.pinSvg}" viewBox="0 0 ${PIN_VIEW_W} ${PIN_VIEW_H}" aria-hidden="true" focusable="false">` +
    `<path class="${styles.pinBody}" d="${PIN_BODY}"/>` +
    `<circle class="${styles.pinDisc}" cx="20" cy="19.5" r="11.5"/>` +
    `<svg class="${styles.pinGlyph}" x="12.5" y="12" width="15" height="15" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>` +
    `</svg></div>`;
  const width = PIN_WIDTH[o.status];
  const height = Math.round((width * PIN_VIEW_H) / PIN_VIEW_W);
  const statusClass = o.status === 'current' ? styles.pinCurrent : styles.pinArchive;
  return L.divIcon({
    className: `${styles.pinIcon} ${statusClass}`,
    html,
    iconSize: [width, height],
    iconAnchor: [width / 2, height],
    popupAnchor: [0, 4 - height],
  });
};

export const createObjectMarker = (o: IConstructionObject, latlng: L.LatLngTuple): L.Marker => {
  const options: IObjectMarkerOptions = {
    icon: createPinIcon(o),
    title: o.name,
    alt: o.name,
    riseOnHover: true,
    objectId: o.id,
    objectStatus: o.status,
  };
  return L.marker(latlng, options);
};

const MIN_SHARE = 12;
const MAX_SHARE = 88;

/** Кластер: кольцо делится на «в работе» и «построено» по долям, в центре — число объектов. */
export const createClusterIcon = (cluster: L.MarkerCluster): L.DivIcon => {
  const markers = cluster.getAllChildMarkers();
  const total = markers.length;
  const current = markers.filter((m) => getMarkerOptions(m).objectStatus === 'current').length;
  let share = Math.round((current / total) * 100);
  if (current > 0 && current < total) share = Math.min(MAX_SHARE, Math.max(MIN_SHARE, share));
  const size = total < 10 ? 40 : total < 30 ? 46 : 52;
  return L.divIcon({
    className: styles.clusterIcon,
    html:
      `<div class="${styles.cluster}" style="--share:${share}%">` +
      `<span class="${styles.clusterCount}">${total}</span></div>`,
    iconSize: [size, size],
  });
};
