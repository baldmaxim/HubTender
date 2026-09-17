// Чистые хелперы ИИ-разбора находок. Без React — проверяются
// scripts/checks/aiTriagePolicy.check.mjs.
import type { QualityFinding } from '../api/quality';
import type { AIAgreement, AIAssessment, AIAvailability, AILabel } from '../api/verificationAI';

/** Роли, которым сервер открывает настройки ИИ-разбора (handlers.AIAdminRoles). */
export const AI_SETTINGS_ROLES = ['administrator', 'developer'] as const;

export function canEditAISettings(roleCode: string | null | undefined): boolean {
  return !!roleCode && (AI_SETTINGS_ROLES as readonly string[]).includes(roleCode);
}

export function labelDisplay(label: AILabel): { text: string; color: string } {
  switch (label) {
    case 'likely_error':
      return { text: 'ИИ: похоже на ошибку', color: 'red' };
    case 'likely_ok':
      return { text: 'ИИ: похоже на норму', color: 'green' };
    default:
      return { text: 'ИИ: не уверен', color: 'default' };
  }
}

/**
 * Оценки по id находки. Устаревшие (данные изменились после оценки) не
 * показываются: они относятся к другим значениям строки.
 */
export function currentAssessments(list: AIAssessment[] | null | undefined): Map<string, AIAssessment> {
  const out = new Map<string, AIAssessment>();
  for (const a of list ?? []) {
    if (a.current) out.set(a.finding_id, a);
  }
  return out;
}

/** Находки, которые можно принять как норму по оценке ИИ: без вердикта инженера. */
export function aiOkToAccept(findings: QualityFinding[], byFinding: Map<string, AIAssessment>): QualityFinding[] {
  return findings.filter(
    (f) => f.verdict === null && !!f.finding_id && byFinding.get(f.finding_id)?.label === 'likely_ok',
  );
}

const LABEL_ORDER: Record<AILabel | 'none', number> = { likely_error: 0, unsure: 1, none: 2, likely_ok: 3 };

/**
 * Порядок и фильтр внутри группы: сначала «похоже на ошибку», «похоже на норму» —
 * в конце или скрыта. Исходный порядок внутри одной метки сохраняется.
 */
export function arrangeFindings(
  findings: QualityFinding[],
  byFinding: Map<string, AIAssessment>,
  hideLikelyOk: boolean,
): QualityFinding[] {
  const label = (f: QualityFinding): AILabel | 'none' =>
    (f.finding_id && byFinding.get(f.finding_id)?.label) || 'none';
  return findings
    .map((f, i) => ({ f, i, l: label(f) }))
    .filter(({ f, l }) => !(hideLikelyOk && l === 'likely_ok' && f.verdict === null))
    .sort((a, b) => LABEL_ORDER[a.l] - LABEL_ORDER[b.l] || a.i - b.i)
    .map(({ f }) => f);
}

export interface AICounts {
  assessed: number;
  error: number;
  ok: number;
  unsure: number;
}

export function countLabels(findings: QualityFinding[], byFinding: Map<string, AIAssessment>): AICounts {
  const c: AICounts = { assessed: 0, error: 0, ok: 0, unsure: 0 };
  for (const f of findings) {
    const a = f.finding_id ? byFinding.get(f.finding_id) : undefined;
    if (!a) continue;
    c.assessed += 1;
    if (a.label === 'likely_error') c.error += 1;
    else if (a.label === 'likely_ok') c.ok += 1;
    else c.unsure += 1;
  }
  return c;
}

export function availabilityText(a: AIAvailability): string | null {
  switch (a) {
    case 'disabled':
      return 'ИИ-разбор выключен в настройках';
    case 'tender_not_in_pilot':
      return 'Тендер не входит в пилот ИИ-разбора';
    case 'not_configured':
      return 'Подключение к модели не настроено';
    default:
      return null;
  }
}

/** Доля совпадений с инженером среди однозначных оценок; null — сравнивать не с чем. */
export function agreementRate(a: AIAgreement): number | null {
  const decided = a.error_agreed + a.error_missed + a.ok_agreed + a.ok_missed;
  return decided === 0 ? null : (a.error_agreed + a.ok_agreed) / decided;
}

/** «r3.conversion_coefficient» → «строка 3 · коэффициент перевода». */
export function evidenceLabel(ref: string): string {
  const [owner, field] = ref.split('.', 2);
  const FIELD: Record<string, string> = {
    customer_name: 'наименование заказчика',
    customer_volume: 'кол-во заказчика',
    gp_volume: 'кол-во ГП',
    gp_note: 'примечание ГП',
    client_note: 'примечание заказчика',
    item_no: '№ позиции',
    unit: 'ед. изм.',
    type: 'тип',
    name: 'наименование',
    quantity: 'количество',
    conversion_coefficient: 'коэф. перевода',
    consumption_coefficient: 'коэф. расхода',
    unit_rate: 'цена',
    currency: 'валюта',
    total: 'сумма',
    bound_to_work: 'привязка к работе',
    cost_category: 'категория затрат',
    description: 'описание',
    detail: 'находка',
  };
  const who = owner?.startsWith('r')
    ? `строка ${owner.slice(1)}`
    : owner === 'p1'
      ? 'позиция'
      : owner?.startsWith('f')
        ? 'находка'
        : owner;
  return `${who} · ${FIELD[field ?? ''] ?? field}`;
}
