// Чистые хелперы страницы «Проверка данных»: к какой сущности относится находка
// и готов ли тендер к сборке формы КП.
//
// Здесь нет React и нет запросов — модуль проверяется скриптом
// scripts/checks/findingsPolicy.check.mjs без DOM.
import type { QualityFinding, QualityRule } from '../api/quality';

/**
 * Ссылка на строку расчёта для находки.
 *
 * Тип сущности приходит с сервера (фронтматтер правила). Открыть можно только
 * позицию: маршрут строк BOQ адресуется id позиции, а не id строки.
 */
export function findingLink(finding: QualityFinding): string | null {
  return finding.entity_type === 'client_position'
    ? `/positions/${finding.entity_id}/items`
    : null;
}

/** Сколько активных (не принятых) находок появилось после отметки проверки. */
export function countNewActive(findings: QualityFinding[]): number {
  return findings.filter((f) => f.is_new && f.verdict !== 'accepted').length;
}

/** Проверка, входящая в готовность формы КП. */
export interface ProposalCheckSpec {
  code: string;
  label: string;
}

/**
 * Что именно проверяется перед сборкой формы КП — ручной чек-лист, переложенный
 * на коды каталога. Правило X (Кол-во ГП = объёму заказчика) сюда не входит: по
 * замеру это обычная практика — треть всех позиций базы.
 */
export const PROPOSAL_CHECKS: ProposalCheckSpec[] = [
  { code: 'U', label: 'Кол-во ГП во всех расценённых позициях' },
  { code: 'H', label: 'Кол-во ГП у позиций со строками без денег' },
  { code: 'V', label: 'Обоснование у нерасценённых позиций' },
];

export type ProposalCheckStatus = 'ok' | 'findings' | 'not_checked';

export interface ProposalCheckResult extends ProposalCheckSpec {
  count: number;
  status: ProposalCheckStatus;
}

export interface ProposalReadiness {
  checks: ProposalCheckResult[];
  /** Сколько активных находок мешают сборке. */
  findingsCount: number;
  /** Сколько проверок из чек-листа сейчас выключены в каталоге. */
  notCheckedCount: number;
  ready: boolean;
}

/**
 * Готовность к сборке формы КП.
 *
 * Отсутствие находок само по себе ничего не значит: выключенное правило
 * (`status: draft`) не выполняется и тоже не даёт находок. Поэтому статус
 * проверки берётся из каталога, а не выводится из пустого списка — иначе карточка
 * рапортовала бы «готов» ровно там, где проверка не запускалась.
 *
 * Пустой каталог означает, что он ещё не загружен: тогда статус неизвестен и
 * проверка помечается как невыполненная, а не как пройденная.
 */
export function computeProposalReadiness(
  findings: QualityFinding[],
  rules: QualityRule[],
): ProposalReadiness {
  const active = new Set(rules.filter((r) => r.Status === 'active').map((r) => r.Code));
  const known = new Set(rules.map((r) => r.Code));

  const counts = new Map<string, number>();
  for (const f of findings) {
    if (f.verdict === 'accepted') continue;
    counts.set(f.rule_code, (counts.get(f.rule_code) ?? 0) + 1);
  }

  const checks = PROPOSAL_CHECKS.map<ProposalCheckResult>((spec) => {
    const count = counts.get(spec.code) ?? 0;
    if (count > 0) return { ...spec, count, status: 'findings' };
    const isActive = known.size > 0 && active.has(spec.code);
    return { ...spec, count: 0, status: isActive ? 'ok' : 'not_checked' };
  });

  const findingsCount = checks.reduce((sum, c) => sum + c.count, 0);
  const notCheckedCount = checks.filter((c) => c.status === 'not_checked').length;

  return {
    checks,
    findingsCount,
    notCheckedCount,
    ready: findingsCount === 0 && notCheckedCount === 0,
  };
}
