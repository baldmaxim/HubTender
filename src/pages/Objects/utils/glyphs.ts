import type { ObjectKind } from './objectKind';

export type GlyphName = ObjectKind | 'pin' | 'briefcase' | 'calendar' | 'file' | 'mapOff';

/** Контуры значков 24×24 (рисуются штрихом currentColor). */
export const GLYPH_PATHS: Record<GlyphName, readonly string[]> = {
  // Жилой: башня с окнами.
  residential: [
    'M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17',
    'M3 21h18',
    'M9.5 7.5h1.5M13 7.5h1.5M9.5 11.5h1.5M13 11.5h1.5M9.5 15.5h1.5M13 15.5h1.5',
    'M10.5 21v-2.5h3V21',
  ],
  // Школа: академическая шапка.
  school: ['M2 9l10-5 10 5-10 5z', 'M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5', 'M22 9v6'],
  // Детский сад: мишка.
  kindergarten: [
    'M12 8a6 6 0 1 1 0 12 6 6 0 0 1 0-12z',
    'M6.5 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
    'M17.5 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
    'M9.5 13h.01M14.5 13h.01',
    'M10 16.5c1 1 3 1 4 0',
  ],
  // МФК: высокая башня и низкий блок.
  mfc: [
    'M3 21h18',
    'M5 21V4h7v17',
    'M12 21V11h7v10',
    'M8 8h1.5M8 12h1.5M8 16h1.5',
    'M15 15h1.5M15 18h1.5',
  ],
  // Коммерческий (банк, ЦОД, офис): здание с колоннами.
  commercial: ['M3 9l9-5 9 5z', 'M5 21h14', 'M6 12v6M10 12v6M14 12v6M18 12v6'],
  // Паркинг: буква P в квадрате.
  parking: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M9.5 17V7H13a3 3 0 0 1 0 6H9.5',
  ],
  pin: ['M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z', 'M12 7.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z'],
  // Заказчик.
  briefcase: [
    'M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z',
    'M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
    'M3 13h18',
  ],
  calendar: [
    'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    'M4 10h16M8 3v4M16 3v4',
  ],
  // Договор.
  file: ['M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z', 'M14 3v5h5', 'M9 13h6M9 17h6'],
  mapOff: ['M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z', 'M3 3l18 18'],
};

/** Значок строкой SVG — для маркеров и попапов Leaflet (строка статична, данных пользователя нет). */
export const glyphSvg = (name: GlyphName, size: number, className = ''): string =>
  `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
  `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
  `aria-hidden="true" focusable="false">${GLYPH_PATHS[name].map((d) => `<path d="${d}"/>`).join('')}</svg>`;
