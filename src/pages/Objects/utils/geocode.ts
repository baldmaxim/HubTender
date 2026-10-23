export interface IGeoPoint {
  lat: number;
  lng: number;
}

interface INominatimItem {
  lat: string;
  lon: string;
}

/** Поиск адреса в Nominatim (OSM) прямо из браузера. null — адрес не найден. */
export const geocodeAddress = async (address: string): Promise<IGeoPoint | null> => {
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ru&accept-language=ru&q=' +
    encodeURIComponent(address);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nominatim: HTTP ${res.status}`);
  const items = (await res.json()) as INominatimItem[];
  const first = items[0];
  if (!first) return null;
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

/** Координаты в БД — до 6 знаков после запятой (~10 см). */
export const roundCoord = (value: number): number => Number(value.toFixed(6));
