export type PdSource = 'pd' | 'contract' | 'other';

export interface IPdRef {
  source: PdSource;
  /** Шифр раздела ПД (ИОС4.3, ПЗУ 1) или код папки (OV, AR); только для source='pd'. */
  section: string | null;
  doc: string;
  /** Ссылки на место: стр., п., Прил., ч., поз., листы… */
  location: string | null;
  /** Содержательный текст ссылки. */
  detail: string | null;
  raw: string;
}

export type NoteKind = 'assumption' | 'excluded' | 'normal';

export interface INotePart {
  text: string;
  kind: NoteKind;
}

export interface INoteSplit {
  title: string | null;
  parts: INotePart[];
}

/** Слова-«адреса»: скобки только из них — это location, а не detail. */
const REF_WORDS = new Set([
  'стр', 'с', 'п', 'пп', 'ч', 'часть', 'поз', 'лист', 'листы', 'листов', 'пз',
  'прил', 'приложение', 'page', 'pages', 'раздел', 'табл', 'таблица', 'рис', 'и',
]);

/** Сокращения, после точки которых предложение не заканчивается. */
const ABBREVIATIONS = new Set([
  'шт', 'поз', 'стр', 'раб', 'рез', 'прил', 'рис', 'табл', 'тыс', 'ед', 'ориент',
  'др', 'пр', 'напр', 'пп', 'коп', 'руб', 'экз', 'мин', 'макс',
]);

const ASSUMPTION_MARKERS = [
  'в справочнике нет', 'принят', 'по аналогам', '≈', 'условно',
  'ориентировочно', 'предположительно', 'нет в пд',
];

const EXCLUDED_MARKERS = [
  'не входит', 'не входят', 'отдельная позиция', 'отдельная строка',
  'отдельной позицией', 'на стороне собственника', 'вне объёма',
];

const MAX_TITLE_LENGTH = 60;

interface IScan {
  /** 0 — верхний уровень; >0 — внутри круглых скобок или «кавычек». */
  level: number[];
  balanced: boolean;
}

const scanLevels = (s: string): IScan => {
  const level: number[] = new Array<number>(s.length).fill(0);
  let parenDepth = 0;
  let quoteOpen = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoteOpen) {
      level[i] = 1;
      if (c === '»') quoteOpen = false;
    } else if (parenDepth > 0) {
      level[i] = parenDepth;
      if (c === '(') parenDepth += 1;
      else if (c === ')') parenDepth -= 1;
    } else if (c === '(') {
      parenDepth = 1;
    } else if (c === '«') {
      quoteOpen = true;
    }
  }
  return { level, balanced: parenDepth === 0 && !quoteOpen };
};

const findTopLevelGroups = (s: string): { start: number; end: number }[] => {
  const { level, balanced } = scanLevels(s);
  if (!balanced) return [];
  const groups: { start: number; end: number }[] = [];
  let i = 0;
  while (i < s.length) {
    if (level[i] === 0 && s[i] === '(') {
      let j = i + 1;
      while (j < s.length && level[j] > 0) j += 1;
      groups.push({ start: i, end: j - 1 });
      i = j;
    } else {
      i += 1;
    }
  }
  return groups;
};

/** Индекс первого «: » (или «:» в конце) на верхнем уровне. */
const findTopLevelColon = (s: string, level: number[]): number => {
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === ':' && level[i] === 0 && (i === s.length - 1 || /\s/.test(s[i + 1]))) return i;
  }
  return -1;
};

const hasContentWords = (inner: string): boolean =>
  inner
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .some((token) => /\p{L}/u.test(token) && !REF_WORDS.has(token));

const cleanLocation = (s: string): string =>
  s.replace(/[\s,;:]+$/, '').replace(/\bPages?\s*/gi, 'стр. ').trim();

const splitTail = (tail: string): { location: string | null; detail: string | null } => {
  const t = tail.replace(/^[\s,;:]+/, '').trim();
  if (!t) return { location: null, detail: null };

  const last = findTopLevelGroups(t).pop();
  if (last && last.end === t.length - 1) {
    const inner = t.slice(last.start + 1, last.end).trim();
    if (hasContentWords(inner)) {
      return { location: cleanLocation(t.slice(0, last.start)) || null, detail: inner };
    }
  }

  const { level, balanced } = scanLevels(t);
  const colon = balanced ? findTopLevelColon(t, level) : -1;
  if (colon >= 0) {
    return {
      location: cleanLocation(t.slice(0, colon)) || null,
      detail: t.slice(colon + 1).trim() || null,
    };
  }
  return { location: cleanLocation(t) || null, detail: null };
};

const FALLBACK = (source: PdSource, raw: string): IPdRef => ({
  source, section: null, doc: raw, location: null, detail: null, raw,
});

/** Разбор строки-ссылки на ПД/договор. Текст не теряется: не разобрали — всё в doc. */
export const parsePdRef = (raw: string): IPdRef => {
  const text = raw.trim();
  let source: PdSource = 'other';
  let rest = text;
  if (/^PD\//i.test(text)) {
    source = 'pd';
    rest = text.slice(3);
  } else if (/^contract\//i.test(text)) {
    source = 'contract';
    rest = text.slice(9);
  }
  if (source === 'other' || !rest.trim()) return FALLBACK(source, raw);

  let doc: string;
  let section: string | null = null;
  let tail: string;

  const md = /^(.*?)\.md(?![\p{L}\p{N}])(.*)$/su.exec(rest);
  if (md) {
    const segments = md[1].split('/');
    const file = segments[segments.length - 1];
    tail = md[2];
    const cleaned = file
      .replace(/_results$/, '')
      .replace(/_ver\d+(?:_\(\d+\))?$/, '')
      .trim();
    if (!cleaned) return FALLBACK(source, raw);
    doc = cleaned.replace(/_/g, ' ');
    if (source === 'pd') {
      const cipher = /^.*?[-_]П[-_](.+)$/u.exec(cleaned);
      if (cipher) {
        section = cipher[1].replace(/_/g, ' ').trim();
        doc = section;
      } else if (segments.length > 1) {
        section = segments[0] || null;
      }
    }
  } else {
    const m = /^(\S+)([\s\S]*)$/.exec(rest.trim());
    if (!m) return FALLBACK(source, raw);
    let token = m[1];
    tail = m[2];
    const num = /^\p{L}+\.$/u.test(token) ? /^\s+(№?\d+)([\s\S]*)$/u.exec(tail) : null;
    if (num) {
      token = `${token} ${num[1]}`;
      tail = num[2];
    }
    const segments = token.replace(/[,;:]+$/, '').split('/');
    doc = segments[segments.length - 1];
    if (source === 'pd' && segments.length > 1) section = segments[0] || null;
    if (!doc) return FALLBACK(source, raw);
  }

  const { location, detail } = splitTail(tail);
  return { source, section, doc, location, detail, raw };
};

const isAbbreviationDot = (s: string, dotIndex: number): boolean => {
  let k = dotIndex;
  while (k > 0 && /\p{L}/u.test(s[k - 1])) k -= 1;
  const word = s.slice(k, dotIndex).toLowerCase();
  if (word.length === 1) return true; // «т.», «п.», «с.», «д.»
  return ABBREVIATIONS.has(word);
};

/** Деление на предложения по «. » / «; » верхнего уровня. */
const splitSentences = (s: string): string[] => {
  const { level } = scanLevels(s);
  const out: string[] = [];
  let from = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (level[i] !== 0 || i + 1 >= s.length || !/\s/.test(s[i + 1])) continue;
    let boundary = false;
    if (s[i] === ';') {
      boundary = true;
    } else if (s[i] === '.') {
      const next = s.slice(i + 1).trimStart()[0];
      boundary = next !== undefined && /[\p{Lu}\p{N}…]/u.test(next) && !isAbbreviationDot(s, i);
    }
    if (boundary) {
      out.push(s.slice(from, i + 1));
      from = i + 1;
    }
  }
  out.push(s.slice(from));
  return out;
};

const classify = (text: string): NoteKind => {
  const lower = text.toLowerCase();
  if (ASSUMPTION_MARKERS.some((m) => lower.includes(m))) return 'assumption';
  if (EXCLUDED_MARKERS.some((m) => lower.includes(m))) return 'excluded';
  return 'normal';
};

/** Разбор пояснения: заголовок (до «: », если короткий) + предложения с типом. */
export const splitNote = (note: string): INoteSplit => {
  const text = note.trim();
  if (!text) return { title: null, parts: [] };

  let title: string | null = null;
  let body = text;
  const { level, balanced } = scanLevels(text);
  const colon = balanced ? findTopLevelColon(text, level) : -1;
  if (colon > 0 && colon <= MAX_TITLE_LENGTH && colon < text.length - 1) {
    const head = text.slice(0, colon).trim();
    if (head && splitSentences(head).length === 1) {
      title = head;
      body = text.slice(colon + 1);
    }
  }

  const parts = splitSentences(body)
    .map((p) => p.trim().replace(/[.;]+$/, '').trim())
    .filter((p) => p.length > 0)
    .map((p) => ({ text: p, kind: classify(p) }));
  return { title, parts };
};
