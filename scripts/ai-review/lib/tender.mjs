/**
 * Данные тендера из портала: выбор тендера, правила, находки, позиции, строки расчёта
 * и адаптеры в модель lib/payload.mjs. Сетевая часть принимает объект portal из lib/portal.mjs.
 */

import { ConfigError } from './env.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIONS_PAGE = 200;
const MAX_PAGES = 1000;

// --- выбор тендера -----------------------------------------------------------

const describeTender = (t) =>
  `${String(t.tender_number ?? '').trim()}${t.version ? ` v${t.version}` : ''} «${t.title ?? ''}» (${t.id})`;

const toTender = (t) => ({
  id: t.id,
  number: String(t.tender_number ?? '').trim(),
  version: t.version ?? null,
  title: t.title ?? '',
});

/**
 * Тендер по аргументу командной строки: uuid, «256» (последняя версия) или «256v3».
 * @param {{ get: Function }} portal
 * @param {string} arg
 * @returns {Promise<{ id: string, number: string, version: number | null, title: string }>}
 */
export const resolveTender = async (portal, arg) => {
  const text = String(arg ?? '').trim();
  if (!text) throw new ConfigError('Не указан тендер: номер (256), номер с версией (256v3) или uuid');

  if (UUID_RE.test(text)) {
    const all = await portal.get('/api/v1/tenders/brief');
    const found = (Array.isArray(all) ? all : []).find((t) => String(t.id).toLowerCase() === text.toLowerCase());
    if (!found) throw new ConfigError(`Тендер с id ${text} не найден в портале`);
    return toTender(found);
  }

  // Сначала весь аргумент как номер (на случай номера, оканчивающегося на «v<число>»), затем «<номер>v<версия>».
  const attempts = [{ number: text, version: null }];
  const split = /^(.+?)v(\d+)$/i.exec(text);
  if (split) attempts.push({ number: split[1].trim(), version: Number(split[2]) });

  let lastCandidates = [];
  for (const { number, version } of attempts) {
    const list = await portal.get('/api/v1/tenders/brief', { search: number });
    const exact = (Array.isArray(list) ? list : []).filter((t) => String(t.tender_number ?? '').trim() === number);
    lastCandidates = Array.isArray(list) ? list : [];
    if (exact.length === 0) continue;

    if (version !== null) {
      const same = exact.filter((t) => t.version === version);
      if (same.length === 1) return toTender(same[0]);
      if (same.length === 0) {
        const versions = exact.map((t) => t.version ?? '—').join(', ');
        throw new ConfigError(`У тендера ${number} нет версии ${version}. Есть версии: ${versions}`);
      }
      throw new ConfigError(`Версию ${version} тендера ${number} нашли несколько раз, укажите uuid:\n  ${same.map(describeTender).join('\n  ')}`);
    }

    const top = Math.max(...exact.map((t) => t.version ?? -1));
    const latest = exact.filter((t) => (t.version ?? -1) === top);
    if (latest.length === 1) return toTender(latest[0]);
    throw new ConfigError(`Тендер ${number} неоднозначен, укажите uuid:\n  ${latest.map(describeTender).join('\n  ')}`);
  }

  const hint = lastCandidates.slice(0, 10).map(describeTender);
  throw new ConfigError(
    `Тендер «${text}» не найден по номеру.${hint.length > 0 ? `\nПохожие:\n  ${hint.join('\n  ')}` : ''}`,
  );
};

// --- загрузка ----------------------------------------------------------------

/**
 * Каталог правил: Map код → { code, title, severity, status, summary }.
 * @param {{ get: Function }} portal
 */
export const loadRules = async (portal) => {
  const list = await portal.get('/api/v1/quality/rules');
  const rules = new Map();
  for (const r of Array.isArray(list) ? list : []) {
    rules.set(r.Code, {
      code: r.Code,
      title: r.Title ?? '',
      severity: r.Severity ?? '',
      status: r.Status ?? '',
      summary: r.Summary ?? '',
    });
  }
  return rules;
};

/**
 * Отчёт «Проверки данных» как есть. query дополняет параметры запроса (open_only, rule, …).
 * @param {{ get: Function }} portal
 * @param {string} tenderId
 * @param {Record<string, string | number | undefined>} [query]
 */
export const loadQuality = async (portal, tenderId, query = {}) => {
  const data = await portal.get(`/api/v1/tenders/${tenderId}/quality`, query);
  return {
    findings: Array.isArray(data?.findings) ? data.findings : [],
    errors: Array.isArray(data?.errors) ? data.errors : [],
    generatedAt: data?.generated_at ?? null,
  };
};

/**
 * Открытые находки (всегда open_only=1).
 * @param {{ get: Function }} portal
 * @param {string} tenderId
 * @param {{ rules?: string[], onlyNew?: boolean, refresh?: boolean }} [opts]
 * @returns {Promise<{ findings: any[], errors: Array<{ rule_code: string, message: string }>, generatedAt: string | null }>}
 */
export const loadFindings = (portal, tenderId, { rules, onlyNew = false, refresh = false } = {}) =>
  loadQuality(portal, tenderId, {
    open_only: 1,
    only_new: onlyNew ? 1 : undefined,
    rule: rules && rules.length > 0 ? rules.join(',') : undefined,
    refresh: refresh ? 1 : undefined,
  });

/** Все позиции тендера (страницами по 200, пока приходит next_cursor). */
export const loadPositions = async (portal, tenderId) => {
  const all = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await portal.get(`/api/v1/tenders/${tenderId}/positions`, { limit: POSITIONS_PAGE, cursor }, { raw: true });
    all.push(...(Array.isArray(res?.data) ? res.data : []));
    const next = res?.next_cursor;
    if (!next || next === cursor) return all;
    cursor = next;
  }
  throw new Error(`позиции тендера: больше ${MAX_PAGES} страниц, остановка`);
};

/** Все строки расчёта тендера одним запросом. */
export const loadRows = async (portal, tenderId) => {
  const rows = await portal.get(`/api/v1/tenders/${tenderId}/boq-items-full`);
  return Array.isArray(rows) ? rows : [];
};

// --- адаптеры ----------------------------------------------------------------

/** Число/строка → строка, null/undefined → ''. */
const str = (v) => (v === null || v === undefined ? '' : String(v));

/** Округление суммы до 2 знаков → строка. */
const money = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const num = Number(v);
  if (!Number.isFinite(num)) return String(v);
  return String(Math.round((num + Number.EPSILON) * 100) / 100);
};

/** Порядок строк как в Go: sort_number по возрастанию (null в конце), затем created_at, затем id. */
export const compareRows = (a, b) => {
  const sa = a.sort_number ?? Infinity;
  const sb = b.sort_number ?? Infinity;
  if (sa !== sb) return sa < sb ? -1 : 1;
  const ca = str(a.created_at);
  const cb = str(b.created_at);
  if (ca !== cb) return ca < cb ? -1 : 1;
  return str(a.id) < str(b.id) ? -1 : str(a.id) > str(b.id) ? 1 : 0;
};

/** Строка boq-items-full → Row из payload.mjs. */
export const adaptRow = (row) => {
  const cat = row.detail_cost_categories;
  return {
    id: row.id,
    type: str(row.boq_item_type),
    name: str(row.work_names?.name ?? row.material_names?.name),
    unit: str(row.unit_code),
    quantity: str(row.quantity),
    conversionCoefficient: str(row.conversion_coefficient),
    consumptionCoefficient: str(row.consumption_coefficient),
    unitRate: str(row.unit_rate),
    currency: str(row.currency_type),
    total: money(row.total_amount),
    parentWorkId: str(row.parent_work_item_id),
    costCategory: [cat?.cost_categories?.name, cat?.name, cat?.location].filter(Boolean).join(' / '),
    description: str(row.description),
  };
};

/**
 * Строки по позициям: Map client_position_id → Row[] в порядке расчёта.
 * @param {any[]} rawRows
 */
export const groupRowsByPosition = (rawRows) => {
  const byPosition = new Map();
  for (const raw of rawRows) {
    const list = byPosition.get(raw.client_position_id) ?? [];
    list.push(raw);
    byPosition.set(raw.client_position_id, list);
  }
  const result = new Map();
  for (const [id, list] of byPosition) result.set(id, list.sort(compareRows).map(adaptRow));
  return result;
};

/** Позиция портала + её строки → Position из payload.mjs. */
export const adaptPosition = (position, rows = []) => ({
  id: position.id,
  itemNo: str(position.item_no ?? '') || str(position.position_number),
  customerName: str(position.work_name),
  unit: str(position.unit_code),
  customerVolume: str(position.volume),
  gpVolume: str(position.manual_volume),
  gpNote: str(position.manual_note),
  clientNote: str(position.client_note),
  rows,
});

/**
 * Находка портала → Finding из payload.mjs (+ служебные поля).
 * @param {any} finding
 * @param {{ rules?: Map<string, { summary: string }>, rowPositionById?: Map<string, string> }} [ctx]
 */
export const adaptFinding = (finding, { rules, rowPositionById } = {}) => {
  // Позиция как в ссылке портала; нет — позиция строки находки (item_id, а у находки по строке — её entity_id).
  let positionId = finding.position_id ?? (finding.entity_type === 'client_position' ? finding.entity_id : null);
  const rowId = finding.item_id ?? (finding.entity_type === 'boq_item' ? finding.entity_id : null);
  if (!positionId && rowId) positionId = rowPositionById?.get(rowId) ?? null;
  const rule = rules?.get(finding.rule_code);
  return {
    id: finding.finding_id ?? `${finding.rule_code}|${finding.entity_id}`,
    ruleCode: str(finding.rule_code),
    ruleTitle: str(finding.rule_title),
    ruleSummary: rule?.summary || str(finding.summary),
    detail: str(finding.detail),
    entityType: str(finding.entity_type),
    entityId: str(finding.entity_id),
    itemId: finding.item_id ?? undefined,
    positionId: positionId ?? undefined,
    fingerprint: str(finding.fingerprint),
    moneyDelta: finding.money_delta ?? null,
    positionNumber: finding.position_number ?? null,
    itemNoApi: finding.item_no ?? null,
  };
};

/**
 * Ссылка на строку расчёта в портале; null, если у находки нет позиции.
 * Правило как findingLink в src/lib/quality/findingsPolicy.ts.
 * @param {string} baseUrl
 * @param {string} tenderId
 * @param {{ positionId?: string, itemId?: string, entityType?: string, entityId?: string }} finding
 */
export const findingLink = (baseUrl, tenderId, finding) => {
  const positionId = finding.positionId ?? (finding.entityType === 'client_position' ? finding.entityId : null);
  if (!positionId) return null;
  const params = new URLSearchParams({ tenderId, positionId });
  const itemId = finding.itemId ?? (finding.entityType === 'boq_item' ? finding.entityId : null);
  if (itemId) params.set('itemId', itemId);
  return `${baseUrl}/positions/${positionId}/items?${params.toString()}`;
};
