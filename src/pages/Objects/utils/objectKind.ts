/** Тип объекта для значка и подписи. Определяется по названию — в БД типа нет. */
export type ObjectKind = 'residential' | 'school' | 'kindergarten' | 'mfc' | 'commercial' | 'parking';

export const OBJECT_KIND_LABELS: Record<ObjectKind, string> = {
  residential: 'Жилой',
  school: 'Школа',
  kindergarten: 'Детский сад',
  mfc: 'МФК',
  commercial: 'Коммерческий',
  parking: 'Паркинг',
};

/** Порядок типов в легенде. */
export const OBJECT_KIND_ORDER: readonly ObjectKind[] = [
  'residential',
  'mfc',
  'commercial',
  'school',
  'kindergarten',
  'parking',
];

interface IKindRule {
  kind: ObjectKind;
  test: RegExp;
}

// Порядок важен: «Школа с автостоянкой» — школа, а не паркинг. Жилой — тип по умолчанию.
const SPECIAL_RULES: readonly IKindRule[] = [
  { kind: 'school', test: /школ|классов|гимнази|лице[йяю]/i },
  { kind: 'kindergarten', test: /детск[а-яё]*\s+сад|детсад|(?:^|[^а-яё])доу(?![а-яё])/i },
  { kind: 'mfc', test: /мфк|мфц|многофункциональн/i },
  {
    kind: 'commercial',
    test: /банк|(?:^|[^а-яё])цод(?![а-яё])|обработки\s+данных|офис|бизнес-?центр|торгов|гостиниц|отел[ьяю]/i,
  },
  { kind: 'parking', test: /автостоянк|паркинг|парковк|гараж/i },
];

const RESIDENTIAL = /жил|(?:^|[^а-яё])жк(?![а-яё])|дом|квартир|апартамент/i;

// «Главное существительное» — часть названия до первого « с / и / на …», запятой или скобки:
// «Жилые дома с подземной автостоянкой и детскими садами» → «Жилые дома» (жилой, а не паркинг).
const HEAD_END = /\s(?:с|со|и|на|для|к|при|в)\s|[,(:;«"]/i;

const getHead = (name: string): string => {
  const end = name.search(HEAD_END);
  return end > 0 ? name.slice(0, end) : name;
};

export const getObjectKind = (name: string): ObjectKind => {
  const head = getHead(name);
  for (const rule of SPECIAL_RULES) {
    if (rule.test.test(head)) return rule.kind;
  }
  if (RESIDENTIAL.test(head)) return 'residential';
  // Голова не опознана («Комплекс зданий …») — ищем по всему названию, жилой — по умолчанию.
  for (const rule of SPECIAL_RULES) {
    if (rule.test.test(name)) return rule.kind;
  }
  return 'residential';
};
