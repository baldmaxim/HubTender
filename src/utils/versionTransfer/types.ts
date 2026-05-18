// Типы version-transfer, нужные UI VersionMatch. Чистые типы, без runtime.
// (Логика, которая раньше их продюсила, выполняется серверным
// executeVersionTransfer — Go BFF; клиентские модули удалены.)

import type { ClientPosition } from '../../lib/supabase';

/** Результат переноса одной дополнительной работы. */
export interface AdditionalWorkTransfer {
  additionalPosition: ClientPosition;
  originalParentId: string;
  newParentId: string | null;
  alternativeParentId?: string;
  reason: 'parent_matched' | 'parent_deleted_found_alternative' | 'no_parent_found';
  success: boolean;
  error?: string;
}
