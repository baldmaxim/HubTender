// Чистые хелперы рассылки замечаний. Без React — проверяются
// scripts/checks/dispatchPolicy.check.mjs.
import type { QualityFinding } from '../api/quality';
import type { DispatchRecipient, DispatchResolver, DispatchResult } from '../api/telegram';

/** Предел одной отправки — совпадает с repository.MaxDispatchFindings. */
export const MAX_DISPATCH_FINDINGS = 500;

/**
 * Что можно отправить: сохранённые находки без вердикта «норма». Уже отмеченные
 * как ошибка — можно: это и есть «исправь».
 */
export function dispatchableIds(findings: QualityFinding[]): string[] {
  const ids = new Set<string>();
  for (const f of findings) {
    if (f.finding_id && f.verdict !== 'accepted') ids.add(f.finding_id);
  }
  return [...ids].slice(0, MAX_DISPATCH_FINDINGS);
}

const RESOLVER_LABEL: Record<DispatchResolver, string> = {
  item_author: 'правил строку',
  position_author: 'правил позицию',
  sender: 'автор не найден — вам',
};

/** «правил строку: 3, правил позицию: 1». */
export function resolverText(r: DispatchRecipient): string {
  return (Object.keys(RESOLVER_LABEL) as DispatchResolver[])
    .filter((k) => (r.by_resolver[k] ?? 0) > 0)
    .map((k) => `${RESOLVER_LABEL[k]}: ${r.by_resolver[k]}`)
    .join(', ');
}

/** Сколько реально уйдёт по предпросмотру. */
export function willSend(recipients: DispatchRecipient[]): number {
  return recipients.reduce((sum, r) => sum + (r.linked ? r.findings - r.already_sent : 0), 0);
}

/** Итог отправки одной строкой для уведомления. */
export function dispatchResultText(res: DispatchResult): string {
  const parts = [`Отправлено замечаний: ${res.queued} (сообщений: ${res.messages})`];
  if (res.duplicates > 0) parts.push(`уже отправлялись: ${res.duplicates}`);
  if (res.unlinked > 0) parts.push(`без Telegram: ${res.unlinked}`);
  return parts.join('; ');
}
