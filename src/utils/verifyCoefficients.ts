/**
 * Скрипт для проверки правильности расчета коэффициентов
 */

import { supabase } from '../lib/supabase';
import type { BoqItemType } from '../lib/supabase';
import { calculateMarkupResult } from './markupCalculator';
import { loadMarkupParameters } from '../services/markupTacticService';

export async function verifyCoefficients(tenderId?: string) {
  console.log('=== ПРОВЕРКА РАСЧЕТА КОЭФФИЦИЕНТОВ ===\n');

  try {
    // 1. Получаем тендер
    const tenderIdToCheck = tenderId || 'cf2d6854-2851-4692-9956-e873b147d789';

    const { data: tender } = await supabase
      .from('tenders')
      .select('id, tender_number, markup_tactic_id')
      .eq('id', tenderIdToCheck)
      .single();

    if (!tender || !tender.markup_tactic_id) {
      console.error('Тендер или тактика не найдены');
      return;
    }

    console.log(`Тендер: ${tender.tender_number}`);
    console.log(`Тактика ID: ${tender.markup_tactic_id}\n`);

    // 2. Загружаем параметры наценок для тендера
    const markupParameters = await loadMarkupParameters(tenderIdToCheck);
    console.log('Загруженные параметры наценок:');
    markupParameters.forEach((value, key) => {
      console.log(`  ${key}: ${value}%`);
    });

    // 3. Получаем тактику
    const { data: tactic } = await supabase
      .from('markup_tactics')
      .select('*')
      .eq('id', tender.markup_tactic_id)
      .single();

    if (!tactic || !tactic.sequences) {
      console.error('Тактика или последовательности не найдены');
      return;
    }

    // 4. Парсим последовательности
    const sequences = typeof tactic.sequences === 'string'
      ? JSON.parse(tactic.sequences)
      : tactic.sequences;

    console.log('\n=== РАСЧЕТ КОЭФФИЦИЕНТОВ ПО ТИПАМ ===\n');

    // Тестовые суммы для расчета
    const testAmount = 1000;
    const types = ['мат', 'раб', 'суб-мат', 'суб-раб', 'мат-комп.', 'раб-комп.'];

    const expectedCoefficients: { [key: string]: number } = {
      'раб': 2.885148,
      'мат': 1.64076,
      'суб-мат': 1.4036,
      'суб-раб': 1.4036
    };

    for (const type of types) {
      const sequence = sequences[type];

      if (!sequence || !Array.isArray(sequence)) {
        console.log(`${type}: НЕТ последовательности`);
        continue;
      }

      console.log(`\n--- ${type.toUpperCase()} ---`);

      // Выполняем расчет
      const result = calculateMarkupResult({
        baseAmount: testAmount,
        baseCost: testAmount,
        itemType: type as BoqItemType,
        markupSequence: sequence,
        markupParameters
      });

      const coefficient = result.commercialCost / testAmount;
      console.log(`Базовая сумма: ${testAmount}`);
      console.log(`Коммерческая стоимость: ${result.commercialCost.toFixed(2)}`);
      console.log(`Рассчитанный коэффициент: ${coefficient.toFixed(6)}`);

      // Проверяем соответствие ожидаемому
      const expected = expectedCoefficients[type];
      if (expected) {
        const difference = Math.abs(coefficient - expected);
        const isCorrect = difference < 0.001;
        console.log(`Ожидаемый коэффициент: ${expected}`);
        console.log(`Разница: ${difference.toFixed(6)}`);
        console.log(`Статус: ${isCorrect ? '✅ КОРРЕКТНО' : '❌ НЕКОРРЕКТНО'}`);
      }

      // Детали расчета
      console.log('\nДетали расчета:');
      console.log(`  Markup Coefficient: ${result.markupCoefficient.toFixed(6)}`);
    }

    console.log('\n=== КОНЕЦ ПРОВЕРКИ ===');

  } catch (error) {
    console.error('Ошибка:', error);
  }
}

// Экспортируем в window для удобного вызова из консоли
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).verifyCoefficients = verifyCoefficients;
  console.log('Для проверки коэффициентов выполните:');
  console.log('window.verifyCoefficients() или window.verifyCoefficients("ID_ТЕНДЕРА")');
}