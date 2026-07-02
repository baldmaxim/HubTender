import { TabKey } from '../types';
import type { MarkupSequences as DbMarkupSequences, BaseCosts as DbBaseCosts, MarkupStep } from '../../../../lib/supabase/types';

// Маппинг между английскими (UI) и русскими (DB) ключами
const EN_TO_RU_KEY_MAP: Record<TabKey, keyof DbMarkupSequences> = {
  'works': 'раб',
  'materials': 'мат',
  'subcontract_works': 'суб-раб',
  'subcontract_materials': 'суб-мат',
  'work_comp': 'раб-комп.',
  'material_comp': 'мат-комп.',
};

const RU_TO_EN_KEY_MAP: Record<keyof DbMarkupSequences, TabKey> = {
  'раб': 'works',
  'мат': 'materials',
  'суб-раб': 'subcontract_works',
  'суб-мат': 'subcontract_materials',
  'раб-комп.': 'work_comp',
  'мат-комп.': 'material_comp',
};

// Преобразование sequences из БД (русские ключи) в UI (английские ключи)
export function convertSequencesFromDb(dbSequences: DbMarkupSequences): Record<TabKey, MarkupStep[]> {
  const result: Record<TabKey, MarkupStep[]> = {
    works: [],
    materials: [],
    subcontract_works: [],
    subcontract_materials: [],
    work_comp: [],
    material_comp: [],
  };

  Object.entries(dbSequences).forEach(([ruKey, value]) => {
    const enKey = RU_TO_EN_KEY_MAP[ruKey as keyof DbMarkupSequences];
    if (enKey) {
      result[enKey] = value || [];
    }
  });

  return result;
}

// Преобразование sequences из UI (английские ключи) в БД (русские ключи)
export function convertSequencesToDb(uiSequences: Record<TabKey, MarkupStep[]>): DbMarkupSequences {
  const result: DbMarkupSequences = {
    'раб': [],
    'мат': [],
    'суб-раб': [],
    'суб-мат': [],
    'раб-комп.': [],
    'мат-комп.': [],
  };

  Object.entries(uiSequences).forEach(([enKey, value]) => {
    const ruKey = EN_TO_RU_KEY_MAP[enKey as TabKey];
    if (ruKey) {
      result[ruKey] = value || [];
    }
  });

  return result;
}

// Преобразование base costs из БД (русские ключи) в UI (английские ключи)
export function convertBaseCostsFromDb(dbBaseCosts: DbBaseCosts): Record<TabKey, number> {
  const result: Record<TabKey, number> = {
    works: 0,
    materials: 0,
    subcontract_works: 0,
    subcontract_materials: 0,
    work_comp: 0,
    material_comp: 0,
  };

  Object.entries(dbBaseCosts).forEach(([ruKey, value]) => {
    const enKey = RU_TO_EN_KEY_MAP[ruKey as keyof DbBaseCosts];
    if (enKey) {
      result[enKey] = value || 0;
    }
  });

  return result;
}

// Преобразование base costs из UI (английские ключи) в БД (русские ключи)
export function convertBaseCostsToDb(uiBaseCosts: Record<TabKey, number>): DbBaseCosts {
  const result: DbBaseCosts = {
    'раб': 0,
    'мат': 0,
    'суб-раб': 0,
    'суб-мат': 0,
    'раб-комп.': 0,
    'мат-комп.': 0,
  };

  Object.entries(uiBaseCosts).forEach(([enKey, value]) => {
    const ruKey = EN_TO_RU_KEY_MAP[enKey as TabKey];
    if (ruKey) {
      result[ruKey] = value || 0;
    }
  });

  return result;
}
