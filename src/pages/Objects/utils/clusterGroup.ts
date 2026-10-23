import * as L from 'leaflet';
import 'leaflet.markercluster';

type LeafletGlobal = typeof L;

/**
 * leaflet.markercluster дописывает фабрику в глобальный `window.L`, а не в ESM-пространство имён
 * `leaflet` — берём её оттуда (в бандле это один и тот же набор классов).
 */
export const createClusterGroup = (options: L.MarkerClusterGroupOptions): L.MarkerClusterGroup => {
  const globalL = (window as unknown as { L?: LeafletGlobal }).L;
  return (globalL?.markerClusterGroup ?? L.markerClusterGroup)(options);
};
