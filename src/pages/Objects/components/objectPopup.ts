import type { IConstructionObject } from '../../../lib/types/types';
import { loadPhotoUrl } from '../utils/photoCache';
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

/** Обложка попапа: рамка 16:9 с серым фоном, картинка подгружается при открытии. */
const buildCover = (o: IConstructionObject, photoId: string): HTMLElement => {
  const cover = el('div', styles.popupCover);
  const img = document.createElement('img');
  img.className = styles.popupCoverImg;
  img.alt = o.name;
  img.draggable = false;
  loadPhotoUrl(photoId, 'thumb').then(
    (url) => {
      img.src = url;
      cover.append(img);
    },
    () => undefined, // без обложки попап остаётся рабочим
  );
  return cover;
};

/** Мини-карточка объекта для попапа маркера. */
export const buildObjectPopup = (o: IConstructionObject): HTMLElement => {
  const kind = getObjectKind(o.name);
  const isCurrent = o.status === 'current';

  const root = el('div', styles.popup);
  if (o.cover_photo_id) root.append(buildCover(o, o.cover_photo_id));

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
  return root;
};
