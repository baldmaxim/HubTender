import * as L from 'leaflet';
import type { IConstructionObject } from '../../../lib/types/types';
import { formatCommissioning } from '../utils/commissioning';
import { formatArea } from '../utils/format';
import { glyphSvg } from '../utils/glyphs';
import type { GlyphName } from '../utils/glyphs';
import { OBJECT_KIND_LABELS, getObjectKind } from '../utils/objectKind';
import { STATUS_LABELS } from '../utils/status';
import styles from './ObjectsMap.module.css';

const el = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Строка «значок + текст». Значок — статичная SVG-строка, текст — только через textContent. */
const row = (glyph: GlyphName, text: string, title?: string): HTMLElement => {
  const node = el('div', styles.popupRow);
  const icon = el('span', styles.popupRowIcon);
  icon.innerHTML = glyphSvg(glyph, 16);
  const label = el('span', styles.popupRowText, text);
  if (title) node.title = title;
  node.append(icon, label);
  return node;
};

const CAROUSEL_HOST_ATTR = 'data-carousel-host';

/** Контейнер карусели фото: React-портал монтирует в него PopupCarousel (см. ObjectsMap). */
const buildCarouselHost = (multi: boolean): HTMLElement => {
  const host = el('div', multi ? `${styles.popupCarousel} ${styles.popupCarouselMulti}` : styles.popupCarousel);
  host.setAttribute(CAROUSEL_HOST_ATTR, '');
  // Свайп и колесо внутри карусели не должны двигать и масштабировать карту.
  L.DomEvent.disableClickPropagation(host);
  L.DomEvent.disableScrollPropagation(host);
  return host;
};

export const findCarouselHost = (popupContent: HTMLElement): HTMLElement | null =>
  popupContent.querySelector<HTMLElement>(`[${CAROUSEL_HOST_ATTR}]`);

/** Строка-ссылка «Документы: N» — открывает окно объекта на вкладке документов. */
const documentsLink = (count: number, onClick: () => void): HTMLElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = styles.popupLink;
  const icon = el('span', styles.popupRowIcon);
  icon.innerHTML = glyphSvg('file', 16);
  button.append(icon, el('span', styles.popupRowText, `Документы: ${count}`));
  button.addEventListener('click', onClick);
  return button;
};

export interface IObjectPopupOptions {
  onOpenDocuments: (o: IConstructionObject) => void;
}

/** Мини-карточка объекта для попапа маркера. */
export const buildObjectPopup = (o: IConstructionObject, options: IObjectPopupOptions): HTMLElement => {
  const kind = getObjectKind(o.name);
  const isCurrent = o.status === 'current';

  const root = el('div', styles.popup);
  if (o.cover_photo_id && o.photo_count > 0) root.append(buildCarouselHost(o.photo_count > 1));

  const head = el('div', styles.popupHead);
  const tile = el('span', `${styles.popupTile} ${isCurrent ? styles.tileCurrent : styles.tileArchive}`);
  tile.innerHTML = glyphSvg(kind, 20);
  const caption = el('div', styles.popupCaption);
  const chip = el('span', `${styles.chip} ${isCurrent ? styles.chipCurrent : styles.chipArchive}`);
  chip.append(el('i', styles.chipDot), document.createTextNode(STATUS_LABELS[o.status]));
  caption.append(el('span', styles.popupKind, OBJECT_KIND_LABELS[kind]), chip);
  head.append(tile, caption);
  root.append(head, el('div', styles.popupName, o.name));

  if (o.customer) root.append(row('briefcase', o.customer));

  const area = el('div', styles.popupArea, formatArea(o.area));
  root.append(area, row('pin', o.address));

  const commissioning = formatCommissioning(o.commissioning_start_date, o.commissioning_date);
  if (commissioning) root.append(row('calendar', `Ввод: ${commissioning.text}`, commissioning.title));
  if (o.project_name) root.append(row('file', `Договор: ${o.project_name}`));
  if (o.document_count > 0) root.append(documentsLink(o.document_count, () => options.onOpenDocuments(o)));
  return root;
};
