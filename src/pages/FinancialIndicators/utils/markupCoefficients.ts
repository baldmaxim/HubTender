import type { MarkupStep } from '../../../lib/types';
import type { tryGetMarkupTactic } from '../../../lib/api/fi';
import type { TenderMarkupPercentageRow } from '../../../lib/api/markup';
import type { MarkupCoefficients } from '../types';

type MarkupTacticFI = Awaited<ReturnType<typeof tryGetMarkupTactic>>;

export interface SequenceParams {
  sequenceParameterKeys: Set<string>;
  sequenceNumberValues: Set<number>;
}

/**
 * Извлечение ключей параметров из JSONB поля sequences тактики наценок.
 * Перенесено из useFinancialCalculations без изменений логики.
 */
export const extractSequenceParams = (tactic: MarkupTacticFI): SequenceParams => {
  const sequenceParameterKeys = new Set<string>();
  const sequenceNumberValues = new Set<number>();
  if (tactic?.sequences) {
    console.log('=== Извлечение параметров из sequences ===');
    console.log('Загружена тактика наценок:', tactic.name);

    // sequences имеет структуру: { "мат": [MarkupStep], "раб": [MarkupStep], ... }
    // MarkupStep содержит operand1Key, operand2Key и т.д. с КЛЮЧАМИ параметров (не ID!)
    Object.values(tactic.sequences).forEach((sequenceArray: MarkupStep[]) => {
      if (Array.isArray(sequenceArray)) {
        sequenceArray.forEach((step: MarkupStep) => {
          const s = step as unknown as Record<string, unknown>;
          for (let i = 1; i <= 5; i++) {
            const keyField = `operand${i}Key`;
            const typeField = `operand${i}Type`;

            if (s[typeField] === 'markup' && s[keyField]) {
              sequenceParameterKeys.add(String(s[keyField]));
            } else if (s[typeField] === 'number' && s[keyField]) {
              sequenceNumberValues.add(parseFloat(String(s[keyField])));
            }
          }
        });
      }
    });

    console.log('Извлечено ключей параметров из sequences:', Array.from(sequenceParameterKeys));
    console.log('Числовые значения в sequences:', Array.from(sequenceNumberValues));
  }
  return { sequenceParameterKeys, sequenceNumberValues };
};

/**
 * Поиск параметров наценок по названиям/ключам и разрешение коэффициентов
 * (ручное значение тендера ?? default), плюс определение «НДС в конструкторе».
 * Перенесено из useFinancialCalculations без изменений логики.
 */
export const resolveMarkupCoefficients = (
  tenderMarkupPercentages: TenderMarkupPercentageRow[] | null,
  { sequenceParameterKeys, sequenceNumberValues }: SequenceParams,
): MarkupCoefficients => {
  const markupParams = (tenderMarkupPercentages || [])
    .map(tmp => tmp.markup_parameter)
    .filter((p): p is NonNullable<typeof p> => p != null);

  const percentagesMap = new Map<string, number>();
  tenderMarkupPercentages?.forEach(tmp => {
    percentagesMap.set(tmp.markup_parameter_id, tmp.value);
  });

  // Извлечение ID параметров по ключам из sequences
  const sequenceParameterIds = new Set<string>();
  if (sequenceParameterKeys.size > 0) {
    const matchingParams = markupParams.filter(p =>
      sequenceParameterKeys.has(p.key)
    );

    matchingParams.forEach(p => sequenceParameterIds.add(p.id));

    console.log('Найдено параметров по ключам:', matchingParams.map(p => ({ key: p.key, label: p.label, id: p.id })));
    console.log('Извлечено ID параметров:', Array.from(sequenceParameterIds));
    console.log('===========================================');
  }

  // Получение параметров наценок
  const mechanizationParam = markupParams.find(p =>
    p.label.toLowerCase().includes('механизац') ||
    p.label.toLowerCase().includes('буринц')
  );

  const mvpGsmParam = markupParams.find(p =>
    p.label.toLowerCase().includes('мвп') ||
    p.label.toLowerCase().includes('гсм')
  );

  const warrantyParam = markupParams.find(p =>
    p.label.toLowerCase().includes('гарант')
  );

  const coefficient06Param = markupParams.find(p => {
    const name = p.label.toLowerCase();
    const key = p.key.toLowerCase();
    return name.includes('0,6') ||
           name.includes('0.6') ||
           name.includes('1,6') ||
           name.includes('1.6') ||
           (name.includes('раб') && name.includes('1')) ||
           key.includes('works_16') ||
           key.includes('works_markup');
  });

  const worksCostGrowthParam = markupParams.find(p =>
    p.label.toLowerCase().includes('рост') &&
    p.label.toLowerCase().includes('работ') &&
    !p.label.toLowerCase().includes('субподряд')
  );

  const materialCostGrowthParam = markupParams.find(p =>
    p.label.toLowerCase().includes('рост') &&
    p.label.toLowerCase().includes('материал') &&
    !p.label.toLowerCase().includes('субподряд')
  );

  const subcontractWorksCostGrowthParam = markupParams.find(p =>
    p.label.toLowerCase().includes('рост') &&
    p.label.toLowerCase().includes('работ') &&
    p.label.toLowerCase().includes('субподряд')
  );

  const subcontractMaterialsCostGrowthParam = markupParams.find(p =>
    p.label.toLowerCase().includes('рост') &&
    p.label.toLowerCase().includes('материал') &&
    p.label.toLowerCase().includes('субподряд')
  );

  const overheadOwnForcesParam = markupParams.find(p =>
    p.label.toLowerCase().includes('ооз') &&
    !p.label.toLowerCase().includes('субподряд')
  );

  const overheadSubcontractParam = markupParams.find(p =>
    p.label.toLowerCase().includes('ооз') &&
    p.label.toLowerCase().includes('субподряд')
  );

  const generalCostsParam = markupParams.find(p =>
    p.label.toLowerCase().includes('офз') ||
    (p.label.toLowerCase().includes('общ') && p.label.toLowerCase().includes('затрат'))
  );

  const profitOwnForcesParam = markupParams.find(p =>
    p.label.toLowerCase().includes('прибыль') &&
    !p.label.toLowerCase().includes('субподряд')
  );

  const profitSubcontractParam = markupParams.find(p =>
    p.label.toLowerCase().includes('прибыль') &&
    p.label.toLowerCase().includes('субподряд')
  );

  const unforeseeableParam = markupParams.find(p =>
    p.label.toLowerCase().includes('непредвид') ||
    p.label.toLowerCase().includes('непредвиден')
  );

  const vatParam = markupParams.find(p =>
    p.label.toLowerCase().includes('ндс')
  );

  // Получение коэффициентов
  const mechanizationCoeff = mechanizationParam
    ? (percentagesMap.get(mechanizationParam.id) ?? mechanizationParam.default_value)
    : 0;

  const mvpGsmCoeff = mvpGsmParam
    ? (percentagesMap.get(mvpGsmParam.id) ?? mvpGsmParam.default_value)
    : 0;

  const warrantyCoeff = warrantyParam
    ? (percentagesMap.get(warrantyParam.id) ?? warrantyParam.default_value)
    : 0;

  const coefficient06 = coefficient06Param
    ? (percentagesMap.get(coefficient06Param.id) ?? coefficient06Param.default_value)
    : 0;

  const worksCostGrowth = worksCostGrowthParam
    ? (percentagesMap.get(worksCostGrowthParam.id) ?? worksCostGrowthParam.default_value)
    : 0;

  const materialCostGrowth = materialCostGrowthParam
    ? (percentagesMap.get(materialCostGrowthParam.id) ?? materialCostGrowthParam.default_value)
    : 0;

  const subcontractWorksCostGrowth = subcontractWorksCostGrowthParam
    ? (percentagesMap.get(subcontractWorksCostGrowthParam.id) ?? subcontractWorksCostGrowthParam.default_value)
    : 0;

  const subcontractMaterialsCostGrowth = subcontractMaterialsCostGrowthParam
    ? (percentagesMap.get(subcontractMaterialsCostGrowthParam.id) ?? subcontractMaterialsCostGrowthParam.default_value)
    : 0;

  const overheadOwnForcesCoeff = overheadOwnForcesParam
    ? (percentagesMap.get(overheadOwnForcesParam.id) ?? overheadOwnForcesParam.default_value)
    : 0;

  const overheadSubcontractCoeff = overheadSubcontractParam
    ? (percentagesMap.get(overheadSubcontractParam.id) ?? overheadSubcontractParam.default_value)
    : 0;

  const generalCostsCoeff = generalCostsParam
    ? (percentagesMap.get(generalCostsParam.id) ?? generalCostsParam.default_value)
    : 0;

  const profitOwnForcesCoeff = profitOwnForcesParam
    ? (percentagesMap.get(profitOwnForcesParam.id) ?? profitOwnForcesParam.default_value)
    : 0;

  const profitSubcontractCoeff = profitSubcontractParam
    ? (percentagesMap.get(profitSubcontractParam.id) ?? profitSubcontractParam.default_value)
    : 0;

  const unforeseeableCoeff = unforeseeableParam
    ? (percentagesMap.get(unforeseeableParam.id) ?? unforeseeableParam.default_value)
    : 0;

  const vatCoeff = vatParam
    ? (percentagesMap.get(vatParam.id) ?? vatParam.default_value)
    : 0;

  // Проверка, входит ли НДС в конструктор тактики наценок
  // НДС может быть: 1) как ключ параметра 'nds_22' в sequences, или
  // 2) как числовой множитель (1 + vatCoeff/100) в шагах sequences
  let isVatInConstructor = sequenceParameterKeys.has('nds_22');
  if (!isVatInConstructor && vatCoeff > 0) {
    const expectedVatMultiplier = 1 + vatCoeff / 100;
    isVatInConstructor = [...sequenceNumberValues].some(
      v => Math.abs(v - expectedVatMultiplier) < 0.001
    );
  }

  console.log('=== DEBUG 0,6к Parameter ===');
  console.log('All markup parameters:', markupParams.map(p => ({
    key: p.key,
    label: p.label,
    default_value: p.default_value
  })));
  console.log('Found 0,6к parameter:', coefficient06Param ? {
    key: coefficient06Param.key,
    label: coefficient06Param.label,
    default_value: coefficient06Param.default_value,
    manual_value: percentagesMap.get(coefficient06Param.id)
  } : 'NOT FOUND');
  console.log('Final coefficient06 value:', coefficient06);

  return {
    mechanizationCoeff,
    mvpGsmCoeff,
    warrantyCoeff,
    coefficient06,
    worksCostGrowth,
    materialCostGrowth,
    subcontractWorksCostGrowth,
    subcontractMaterialsCostGrowth,
    overheadOwnForcesCoeff,
    overheadSubcontractCoeff,
    generalCostsCoeff,
    profitOwnForcesCoeff,
    profitSubcontractCoeff,
    unforeseeableCoeff,
    vatCoeff,
    isVatInConstructor,
  };
};
