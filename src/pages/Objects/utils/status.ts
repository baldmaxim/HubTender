import type { ConstructionObjectStatus } from '../../../lib/types/types';

export const STATUS_LABELS: Record<ConstructionObjectStatus, string> = {
  current: 'В работе',
  archive: 'Построен',
};
