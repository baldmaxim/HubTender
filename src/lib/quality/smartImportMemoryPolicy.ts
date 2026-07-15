// Этап 2.3: pure-политика UI памяти умного импорта (§11-12, §19).
// Без зависимостей от env/API — модуль тестируется автономно.
// Server response остаётся единственным authority: helpers только отображают.
import type {
  SmartAnalyzeMemory, SmartMapping, SmartPreviewRow, SmartProfileSuggestion,
} from '../api/boqSmartImport';

// ─── Профили (§11) ───────────────────────────────────────────────────────────

export function profileStatusDisplay(status: string): { label: string; color: string } {
  switch (status) {
    case 'usable': return { label: 'готов к применению', color: 'green' };
    case 'requires_review': return { label: 'требует проверки', color: 'orange' };
    case 'inactive': return { label: 'отключён', color: 'default' };
    default: return { label: status, color: 'default' };
  }
}

/** §5/§19.1-2: один профиль — предложение; несколько — обязательный выбор. */
export function profileChoiceState(memory: SmartAnalyzeMemory | undefined): {
  mode: 'none' | 'one' | 'multiple';
  profiles: SmartProfileSuggestion[];
} {
  if (!memory || memory.profile_match === 'none' || !(memory.profiles?.length)) {
    return { mode: 'none', profiles: [] };
  }
  return {
    mode: memory.profile_match === 'multiple' ? 'multiple' : 'one',
    profiles: memory.profiles ?? [],
  };
}

/** §19.5: mapping отличается от применённого профиля (badge «Изменено»). */
export function mappingDiffersFromProfile(
  memory: SmartAnalyzeMemory | undefined,
  overrides: Record<string, string>,
): boolean {
  if (!memory || memory.applied_profile_status !== 'applied') return false;
  const fromProfile = new Set(memory.applied_fields ?? []);
  for (const field of Object.keys(overrides)) {
    if (!fromProfile.has(field)) return true; // пользователь переопределил/добавил
  }
  return false;
}

/** §9/§19.6-7: когда можно предлагать сохранение/обновление профиля. */
export function profileSaveEligibility(
  memory: SmartAnalyzeMemory | undefined,
): { canSaveNew: boolean; canUpdateApplied: boolean } {
  const applied = memory?.applied_profile_status === 'applied';
  return { canSaveNew: true, canUpdateApplied: applied };
}

export const PROFILE_APPLIED_BADGE = 'Из сохранённого профиля';
export const PROFILE_CHANGED_BADGE = 'Изменено относительно профиля';
export const PROFILE_REQUIRES_REVIEW_TEXT =
  'Профиль сохранён в другой версии сопоставления — проверьте поля и пересохраните его после успешного импорта.';

/** Поля mapping, пришедшие из профиля (source-метка сервера, §5). */
export function profileSourcedFields(mapping: SmartMapping[]): string[] {
  return mapping.filter((m) => m.source === 'saved_profile').map((m) => m.target_field);
}

// ─── Aliases (§11) ───────────────────────────────────────────────────────────

export const ALIAS_BADGE_TEXT = 'Подтверждено вами ранее';

/** §19.9: badge для строки, разрешённой alias'ом. */
export function aliasBadge(row: SmartPreviewRow): { aliasId: string; label: string; savedAt?: string; useCount: number } | null {
  const p = row.alias_provenance;
  if (!p || p.match_method !== 'user_approved_alias') return null;
  return { aliasId: p.alias_id, label: p.source_label || ALIAS_BADGE_TEXT, savedAt: p.saved_at, useCount: p.use_count };
}

/** §19.16-17: конфликт/недоступность alias блокируют строку (server issues). */
export function aliasIssueState(issues: { code: string }[]): {
  hasConflict: boolean; hasUnavailableTarget: boolean; hasStale: boolean;
} {
  let hasConflict = false; let hasUnavailableTarget = false; let hasStale = false;
  for (const i of issues) {
    if (i.code === 'NOMENCLATURE_ALIAS_CONFLICT') hasConflict = true;
    if (i.code === 'NOMENCLATURE_ALIAS_TARGET_UNAVAILABLE') hasUnavailableTarget = true;
    if (i.code === 'NOMENCLATURE_ALIAS_REQUIRES_REVIEW') hasStale = true;
  }
  return { hasConflict, hasUnavailableTarget, hasStale };
}

// ─── Remember-семантика (§7/§19.12-15) ───────────────────────────────────────

/** Default remember СТРОГО false; UI не переключает его сам. */
export const REMEMBER_DEFAULT = false;

export const REMEMBER_LABEL = 'Запомнить для следующих импортов';
export const REMEMBER_BULK_LABEL = 'Запомнить подтверждённые соответствия';

/** §19.15: bulk-подтверждение НЕ подразумевает запоминание. */
export function bulkConfirmRemembers(explicitOptIn: boolean): boolean {
  return explicitOptIn === true;
}

// ─── Memory summary (§14/§19.18) ─────────────────────────────────────────────

export const MEMORY_SAVE_FAILED_TEXT =
  'Импорт выполнен успешно, но сохранить настройки/соответствия не удалось — их можно сохранить при следующем импорте.';

export function memorySummaryText(mem: {
  mapping_profile: { applied: boolean; profile_name?: string; saved: boolean; updated: boolean };
  nomenclature: { approved_alias_matches: number; aliases_saved: number };
} | undefined): string {
  if (!mem) return '';
  const parts: string[] = [];
  if (mem.mapping_profile.applied && mem.mapping_profile.profile_name) {
    parts.push(`профиль «${mem.mapping_profile.profile_name}»`);
  }
  if (mem.mapping_profile.saved) parts.push('профиль сохранён');
  if (mem.mapping_profile.updated) parts.push('профиль обновлён');
  if (mem.nomenclature.approved_alias_matches > 0) {
    parts.push(`по сохранённым соответствиям: ${mem.nomenclature.approved_alias_matches}`);
  }
  if (mem.nomenclature.aliases_saved > 0) {
    parts.push(`запомнено соответствий: ${mem.nomenclature.aliases_saved}`);
  }
  return parts.join(' · ');
}

/** §19.18: сбой памяти не меняет успешность импорта в UI. */
export function importSucceededDespiteMemoryFailure(mem: { memory_saved: boolean; warnings: string[] } | undefined): boolean {
  if (!mem) return false;
  return !mem.memory_saved && mem.warnings.includes('IMPORT_MEMORY_SAVE_FAILED');
}

// ─── Management (§12/§19.20-21) ──────────────────────────────────────────────

export function deactivateConfirmText(kind: 'profile' | 'alias', name: string): string {
  return kind === 'profile'
    ? `Отключить профиль «${name}»? Он перестанет предлагаться при анализе; импорт данных не изменится.`
    : `Забыть соответствие «${name}»? Строки перестанут сопоставляться автоматически; импорт данных не изменится.`;
}

/** §19.22: источники решений не смешиваются — каждый со своим label. */
export function matchSourceLabel(source: 'exact' | 'alias' | 'ai' | 'manual'): string {
  switch (source) {
    case 'exact': return 'Точное совпадение';
    case 'alias': return ALIAS_BADGE_TEXT;
    case 'ai': return 'AI + инженер';
    case 'manual': return 'Выбрано вручную';
  }
}
