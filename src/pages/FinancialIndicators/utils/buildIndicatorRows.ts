import type { getTenderInsuranceFI } from '../../../lib/api/fi';
import type { DirectCostTotals, MarkupCoefficients, FinancialCalcResult, IndicatorRow } from '../types';

type InsuranceDataFI = Awaited<ReturnType<typeof getTenderInsuranceFI>> | null;

/**
 * Сборка 18 строк таблицы финансовых показателей (с тултипами-формулами)
 * из результатов расчёта. Перенесено из useFinancialCalculations без
 * изменений логики, включая НДС-умножение строк 1-16.
 */
export const buildIndicatorRows = (
  calc: FinancialCalcResult,
  totals: DirectCostTotals,
  coeffs: MarkupCoefficients,
  insuranceData: InsuranceDataFI,
  areaSp: number,
  areaClient: number,
): IndicatorRow[] => {
  const {
    subcontractTotal,
    su10Total,
    reserveForDeliveryTotal,
    directCostsRowTotal,
    worksSu10Only,
    mechanizationCost,
    coefficient06Cost,
    mvpGsmCost,
    warrantyCost,
    worksWithMarkup,
    worksCostGrowthAmount,
    materialCostGrowthAmount,
    subcontractWorksCostGrowthAmount,
    subcontractMaterialsCostGrowthAmount,
    totalCostGrowth,
    baseForUnforeseeable,
    unforeseeableCost,
    baseForOOZ,
    overheadOwnForcesCost,
    subcontractGrowth,
    baseForSubcontractOOZ,
    overheadSubcontractCost,
    baseForOFZ,
    generalCostsCost,
    baseForProfit,
    profitOwnForcesCost,
    baseForSubcontractProfit,
    profitSubcontractCost,
    insuranceCost,
    grandTotalBeforeVAT,
    vatCost,
    grandTotal,
  } = calc;
  const {
    subcontractWorks,
    subcontractMaterials,
    subcontractWorksForGrowth,
    subcontractMaterialsForGrowth,
    works,
    materials,
    materialsComp,
    worksComp,
  } = totals;
  const {
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
  } = coeffs;

  const tableData: IndicatorRow[] = [
    {
      key: '1',
      row_number: 1,
      indicator_name: 'Прямые затраты, в т.ч.',
      coefficient: '',
      sp_cost: areaSp > 0 ? directCostsRowTotal / areaSp : 0,
      customer_cost: areaClient > 0 ? directCostsRowTotal / areaClient : 0,
      total_cost: directCostsRowTotal,
      tooltip: `Состав прямых затрат:\n` +
               `1. Субподряд: ${subcontractTotal.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `   (работы: ${subcontractWorks.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} + материалы: ${subcontractMaterials.toLocaleString('ru-RU', { maximumFractionDigits: 2 })})\n` +
               `2. Работы + Материалы СУ-10: ${su10Total.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `   (работы: ${works.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} + материалы: ${materials.toLocaleString('ru-RU', { maximumFractionDigits: 2 })})\n` +
               `3. Запас на сдачу объекта: ${reserveForDeliveryTotal.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `   (раб-комп.: ${worksComp.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} + мат-комп.: ${materialsComp.toLocaleString('ru-RU', { maximumFractionDigits: 2 })})\n` +
               `4. Служба механизации: ${mechanizationCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `5. МБП+ГСМ: ${mvpGsmCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `6. Гарантийный период: ${warrantyCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `= ${directCostsRowTotal.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.`
    },
    {
      key: '2',
      row_number: 2,
      indicator_name: 'Субподряд',
      sp_cost: areaSp > 0 ? subcontractTotal / areaSp : 0,
      customer_cost: areaClient > 0 ? subcontractTotal / areaClient : 0,
      total_cost: subcontractTotal
    },
    {
      key: '3',
      row_number: 3,
      indicator_name: 'Работы + Материалы СУ-10',
      sp_cost: areaSp > 0 ? su10Total / areaSp : 0,
      customer_cost: areaClient > 0 ? su10Total / areaClient : 0,
      total_cost: su10Total
    },
    {
      key: '4',
      row_number: 4,
      indicator_name: 'Запас материалов и работ на сдачу объекта',
      sp_cost: areaSp > 0 ? reserveForDeliveryTotal / areaSp : 0,
      customer_cost: areaClient > 0 ? reserveForDeliveryTotal / areaClient : 0,
      total_cost: reserveForDeliveryTotal,
      tooltip: `Состав запаса на сдачу объекта:\n` +
               `Работы комп.: ${worksComp.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `+ Материалы комп.: ${materialsComp.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `= ${reserveForDeliveryTotal.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.`
    },
    {
      key: '5',
      row_number: 5,
      indicator_name: 'Служба механизации',
      coefficient: mechanizationCoeff > 0 ? `${parseFloat(mechanizationCoeff.toFixed(5))}%` : '',
      sp_cost: areaSp > 0 ? mechanizationCost / areaSp : 0,
      customer_cost: areaClient > 0 ? mechanizationCost / areaClient : 0,
      total_cost: mechanizationCost,
      tooltip: `Формула: Работы СУ-10 × ${mechanizationCoeff}%\n` +
               `Расчёт: ${worksSu10Only.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} × ${mechanizationCoeff}% = ${mechanizationCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.`
    },
    {
      key: '6',
      row_number: 6,
      indicator_name: 'МБП+ГСМ',
      coefficient: mvpGsmCoeff > 0 ? `${parseFloat(mvpGsmCoeff.toFixed(5))}%` : '',
      sp_cost: areaSp > 0 ? mvpGsmCost / areaSp : 0,
      customer_cost: areaClient > 0 ? mvpGsmCost / areaClient : 0,
      total_cost: mvpGsmCost,
      tooltip: `Формула: Работы СУ-10 × ${mvpGsmCoeff}%\n` +
               `Расчёт: ${worksSu10Only.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} × ${mvpGsmCoeff}% = ${mvpGsmCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.`
    },
    {
      key: '7',
      row_number: 7,
      indicator_name: 'Гарантийный период',
      coefficient: warrantyCoeff > 0 ? `${parseFloat(warrantyCoeff.toFixed(5))}%` : '',
      sp_cost: areaSp > 0 ? warrantyCost / areaSp : 0,
      customer_cost: areaClient > 0 ? warrantyCost / areaClient : 0,
      total_cost: warrantyCost,
      tooltip: `Формула: Работы СУ-10 × ${warrantyCoeff}%\n` +
               `Расчёт: ${worksSu10Only.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} × ${warrantyCoeff}% = ${warrantyCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.`
    },
    {
      key: '8',
      row_number: 8,
      indicator_name: '1,6',
      coefficient: coefficient06 > 0 ? `${parseFloat(coefficient06.toFixed(5))}%` : '',
      sp_cost: areaSp > 0 ? coefficient06Cost / areaSp : 0,
      customer_cost: areaClient > 0 ? coefficient06Cost / areaClient : 0,
      total_cost: coefficient06Cost,
      tooltip: `Формула: (Работы ПЗ + СМ) × ${coefficient06}%\n` +
               `Работы ПЗ: ${worksSu10Only.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `+ СМ: ${mechanizationCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `= ${(worksSu10Only + mechanizationCost).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `Расчёт: ${(worksSu10Only + mechanizationCost).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} × ${coefficient06}% = ${coefficient06Cost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.`
    },
    {
      key: '9',
      row_number: 9,
      indicator_name: 'Рост стоимости',
      coefficient: [
        worksCostGrowth > 0 ? `Раб:${parseFloat(worksCostGrowth.toFixed(5))}%` : '',
        materialCostGrowth > 0 ? `Мат:${parseFloat(materialCostGrowth.toFixed(5))}%` : '',
        subcontractWorksCostGrowth > 0 ? `С.Раб:${parseFloat(subcontractWorksCostGrowth.toFixed(5))}%` : '',
        subcontractMaterialsCostGrowth > 0 ? `С.Мат:${parseFloat(subcontractMaterialsCostGrowth.toFixed(5))}%` : ''
      ].filter(Boolean).join(', '),
      sp_cost: areaSp > 0 ? totalCostGrowth / areaSp : 0,
      customer_cost: areaClient > 0 ? totalCostGrowth / areaClient : 0,
      total_cost: totalCostGrowth,
      // Промежуточные расчеты для роста стоимости
      works_su10_growth: worksCostGrowthAmount,
      materials_su10_growth: materialCostGrowthAmount,
      works_sub_growth: subcontractWorksCostGrowthAmount,
      materials_sub_growth: subcontractMaterialsCostGrowthAmount,
      tooltip: `Формула: Рост по каждой категории отдельно\n` +
               `Работы СУ-10: (Работы + 0,6к + МБП + СМ) × ${worksCostGrowth}%\n` +
               `  Работы: ${worksSu10Only.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `  + 0,6к: ${coefficient06Cost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `  + МБП: ${mvpGsmCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `  + СМ: ${mechanizationCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `  = ${worksWithMarkup.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `  Рост: ${worksWithMarkup.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} × ${worksCostGrowth}% = ${worksCostGrowthAmount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `Материалы СУ-10: ${materials.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} × ${materialCostGrowth}% = ${materialCostGrowthAmount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `Работы субподряд: ${subcontractWorksForGrowth.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} × ${subcontractWorksCostGrowth}% = ${subcontractWorksCostGrowthAmount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `  (База для роста: ${subcontractWorksForGrowth.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} из ${subcontractWorks.toLocaleString('ru-RU', { maximumFractionDigits: 2 })})\n` +
               `Материалы субподряд: ${subcontractMaterialsForGrowth.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} × ${subcontractMaterialsCostGrowth}% = ${subcontractMaterialsCostGrowthAmount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `  (База для роста: ${subcontractMaterialsForGrowth.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} из ${subcontractMaterials.toLocaleString('ru-RU', { maximumFractionDigits: 2 })})\n` +
               `Итого: ${totalCostGrowth.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.`
    },
    {
      key: '10',
      row_number: 10,
      indicator_name: 'Непредвиденные',
      coefficient: unforeseeableCoeff > 0 ? `${parseFloat(unforeseeableCoeff.toFixed(5))}%` : '',
      sp_cost: areaSp > 0 ? unforeseeableCost / areaSp : 0,
      customer_cost: areaClient > 0 ? unforeseeableCost / areaClient : 0,
      total_cost: unforeseeableCost,
      tooltip: `Формула: (Работы + 0,6к + Материалы + МБП + СМ) × ${unforeseeableCoeff}%\n` +
               `Работы: ${worksSu10Only.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `+ 0,6к: ${coefficient06Cost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `+ Материалы: ${materials.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `+ МБП: ${mvpGsmCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `+ СМ: ${mechanizationCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `= ${baseForUnforeseeable.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `Расчёт: ${baseForUnforeseeable.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} × ${unforeseeableCoeff}% = ${unforeseeableCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.`
    },
    {
      key: '11',
      row_number: 11,
      indicator_name: 'ООЗ',
      coefficient: overheadOwnForcesCoeff > 0 ? `${parseFloat(overheadOwnForcesCoeff.toFixed(5))}%` : '',
      sp_cost: areaSp > 0 ? overheadOwnForcesCost / areaSp : 0,
      customer_cost: areaClient > 0 ? overheadOwnForcesCost / areaClient : 0,
      total_cost: overheadOwnForcesCost,
      tooltip: `Формула: (Работы + 0,6к + Материалы + МБП + СМ + Рост работ + Рост материалов + Непредвиденные) × ${overheadOwnForcesCoeff}%\n` +
               `Работы + 0,6к + Материалы + МБП + СМ: ${baseForUnforeseeable.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `+ Рост работ: ${worksCostGrowthAmount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `+ Рост материалов: ${materialCostGrowthAmount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `+ Непредвиденные: ${unforeseeableCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `= ${baseForOOZ.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `Расчёт: ${baseForOOZ.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} × ${overheadOwnForcesCoeff}% = ${overheadOwnForcesCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.`
    },
    {
      key: '12',
      row_number: 12,
      indicator_name: 'ООЗ Субподряд',
      coefficient: overheadSubcontractCoeff > 0 ? `${parseFloat(overheadSubcontractCoeff.toFixed(5))}%` : '',
      sp_cost: areaSp > 0 ? overheadSubcontractCost / areaSp : 0,
      customer_cost: areaClient > 0 ? overheadSubcontractCost / areaClient : 0,
      total_cost: overheadSubcontractCost,
      tooltip: `Формула: (Субподряд ПЗ + Рост субподряда) × ${overheadSubcontractCoeff}%\n` +
               `Субподряд ПЗ: ${subcontractTotal.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `+ Рост субподряда: ${subcontractGrowth.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `  (Рост работ: ${subcontractWorksCostGrowthAmount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} + Рост мат.: ${subcontractMaterialsCostGrowthAmount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })})\n` +
               `= ${baseForSubcontractOOZ.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `Расчёт: ${baseForSubcontractOOZ.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} × ${overheadSubcontractCoeff}% = ${overheadSubcontractCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.`
    },
    {
      key: '13',
      row_number: 13,
      indicator_name: 'ОФЗ',
      coefficient: generalCostsCoeff > 0 ? `${parseFloat(generalCostsCoeff.toFixed(5))}%` : '',
      sp_cost: areaSp > 0 ? generalCostsCost / areaSp : 0,
      customer_cost: areaClient > 0 ? generalCostsCost / areaClient : 0,
      total_cost: generalCostsCost,
      tooltip: `Формула: (Работы + 0,6к + Материалы + МБП + СМ + Рост работ + Рост материалов + Непредвиденные + ООЗ) × ${generalCostsCoeff}%\n` +
               `Работы + 0,6к + Материалы + МБП + СМ + Рост + Непредв.: ${baseForOOZ.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `+ ООЗ: ${overheadOwnForcesCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `= ${baseForOFZ.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `Расчёт: ${baseForOFZ.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} × ${generalCostsCoeff}% = ${generalCostsCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.`
    },
    {
      key: '14',
      row_number: 14,
      indicator_name: 'Прибыль',
      coefficient: profitOwnForcesCoeff > 0 ? `${parseFloat(profitOwnForcesCoeff.toFixed(5))}%` : '',
      sp_cost: areaSp > 0 ? profitOwnForcesCost / areaSp : 0,
      customer_cost: areaClient > 0 ? profitOwnForcesCost / areaClient : 0,
      total_cost: profitOwnForcesCost,
      tooltip: `Формула: (Работы + 0,6к + Материалы + МБП + СМ + Рост работ + Рост материалов + Непредвиденные + ООЗ + ОФЗ) × ${profitOwnForcesCoeff}%\n` +
               `Работы + 0,6к + Материалы + МБП + СМ + Рост + Непредв. + ООЗ: ${baseForOFZ.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `+ ОФЗ: ${generalCostsCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `= ${baseForProfit.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `Расчёт: ${baseForProfit.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} × ${profitOwnForcesCoeff}% = ${profitOwnForcesCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.`
    },
    {
      key: '15',
      row_number: 15,
      indicator_name: 'Прибыль субподряд',
      coefficient: profitSubcontractCoeff > 0 ? `${parseFloat(profitSubcontractCoeff.toFixed(5))}%` : '',
      sp_cost: areaSp > 0 ? profitSubcontractCost / areaSp : 0,
      customer_cost: areaClient > 0 ? profitSubcontractCost / areaClient : 0,
      total_cost: profitSubcontractCost,
      tooltip: `Формула: (Субподряд ПЗ + Рост субподряда + ООЗ Субподряд) × ${profitSubcontractCoeff}%\n` +
               `Субподряд ПЗ + Рост: ${baseForSubcontractOOZ.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `+ ООЗ Субподряд: ${overheadSubcontractCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `= ${baseForSubcontractProfit.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
               `Расчёт: ${baseForSubcontractProfit.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} × ${profitSubcontractCoeff}% = ${profitSubcontractCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.`
    },
    {
      key: '16',
      row_number: 16,
      indicator_name: 'Страхование от судимостей',
      coefficient: '',
      sp_cost: areaSp > 0 ? insuranceCost / areaSp : 0,
      customer_cost: areaClient > 0 ? insuranceCost / areaClient : 0,
      total_cost: insuranceCost,
      tooltip: insuranceData
        ? `Квартиры: ${insuranceData.apt_price_m2} × ${insuranceData.apt_area} м²\n` +
          `Паркинг: ${insuranceData.parking_price_m2} × ${insuranceData.parking_area} м²\n` +
          `Кладовки: ${insuranceData.storage_price_m2} × ${insuranceData.storage_area} м²\n` +
          `× ${insuranceData.judicial_pct}% (судебные) × ${insuranceData.total_pct}%`
        : 'Данные страхования не заполнены',
    },
    {
      key: '17',
      row_number: 17,
      indicator_name: 'ИТОГО',
      coefficient: '',
      sp_cost: areaSp > 0 ? grandTotal / areaSp : 0,
      customer_cost: areaClient > 0 ? grandTotal / areaClient : 0,
      total_cost: grandTotal,
      is_total: true,
      is_yellow: true
    },
    {
      key: '18',
      row_number: 18,
      indicator_name: vatCoeff > 0 ? `В том числе НДС ${parseFloat(vatCoeff.toFixed(5))}%` : 'В том числе НДС',
      coefficient: vatCoeff > 0 ? `${parseFloat(vatCoeff.toFixed(5))}%` : '',
      sp_cost: areaSp > 0 ? vatCost / areaSp : 0,
      customer_cost: areaClient > 0 ? vatCost / areaClient : 0,
      total_cost: vatCost,
      tooltip: isVatInConstructor
        ? `Формула: (Сумма строк 1-14) × ${vatCoeff}%\n` +
          `Сумма без НДС: ${grandTotalBeforeVAT.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
          `Расчёт: ${grandTotalBeforeVAT.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} × ${vatCoeff}% = ${vatCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.`
        : `Формула: ИТОГО / (1 + ${vatCoeff}%) × ${vatCoeff}%\n` +
          `ИТОГО: ${grandTotal.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}\n` +
          `Расчёт: ${grandTotal.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} / (1 + ${vatCoeff}%) × ${vatCoeff}% = ${vatCost.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} руб.`
    },
  ];

  // Если НДС в конструкторе — умножаем каждую строку (1-15) на (1 + НДС%)
  // Строка 16 (ИТОГО) уже включает НДС (grandTotal), строка 17 — справочная
  if (isVatInConstructor && vatCoeff > 0) {
    const vatMultiplier = 1 + vatCoeff / 100;
    tableData.forEach(row => {
      if (row.row_number >= 1 && row.row_number <= 16) {
        row.total_cost = (row.total_cost || 0) * vatMultiplier;
        row.sp_cost = (row.sp_cost || 0) * vatMultiplier;
        row.customer_cost = (row.customer_cost || 0) * vatMultiplier;
      }
    });
  }

  return tableData;
};
