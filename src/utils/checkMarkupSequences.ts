/**
 * Проверка структуры последовательностей наценок в тактике
 */

import { supabase } from '../lib/supabase';
import type { MarkupStep } from '../lib/supabase';

export async function checkMarkupSequences(tenderId?: string) {
  console.log('=== ПРОВЕРКА ПОСЛЕДОВАТЕЛЬНОСТЕЙ НАЦЕНОК ===\n');

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

    // 2. Получаем тактику с последовательностями
    const { data: tactic } = await supabase
      .from('markup_tactics')
      .select('*')
      .eq('id', tender.markup_tactic_id)
      .single();

    if (!tactic || !tactic.sequences) {
      console.error('Тактика или последовательности не найдены');
      return;
    }

    // 3. Парсим последовательности
    const sequences = typeof tactic.sequences === 'string'
      ? JSON.parse(tactic.sequences)
      : tactic.sequences;

    console.log('СТРУКТУРА ПОСЛЕДОВАТЕЛЬНОСТЕЙ:\n');

    const types = ['мат', 'раб', 'суб-мат', 'суб-раб', 'мат-комп.', 'раб-комп.'];

    for (const type of types) {
      console.log(`\n${type}:`);
      const sequence = sequences[type];

      if (!sequence || !Array.isArray(sequence)) {
        console.log('  ❌ НЕТ последовательности');
        continue;
      }

      console.log(`  Количество шагов: ${sequence.length}`);

      sequence.forEach((step: MarkupStep, index: number) => {
        console.log(`\n  Шаг ${index + 1}:`);
        console.log(`    baseIndex: ${step.baseIndex}`);
        console.log(`    action1: ${step.action1}`);
        console.log(`    operand1Type: ${step.operand1Type}`);
        console.log(`    operand1Key: ${step.operand1Key}`);

        if (step.operand1Type === 'markup') {
          console.log(`    ⚠️ Тип "markup" требует параметр "${step.operand1Key}" в Map параметров`);
        } else if (step.operand1Type === 'number') {
          console.log(`    ✓ Тип "number" использует прямое значение: ${step.operand1Key}`);
        }

        // Проверяем дополнительные операции
        if (step.action2) {
          console.log(`    action2: ${step.action2}`);
          console.log(`    operand2Type: ${step.operand2Type}`);
          console.log(`    operand2Key: ${step.operand2Key}`);
        }
      });
    }

    console.log('\n\nПРОВЕРКА СООТВЕТСТВИЯ ПАРАМЕТРОВ:');
    console.log('Доступные параметры в Map:');
    const availableParams = [
      'mechanization_service',
      'mbp_gsm',
      'warranty_period',
      'works_16_markup',
      'works_cost_growth',
      'material_cost_growth',
      'subcontract_works_cost_growth',
      'subcontract_materials_cost_growth',
      'contingency_costs',
      'overhead_own_forces',
      'overhead_subcontract',
      'general_costs_without_subcontract',
      'profit_own_forces',
      'profit_subcontract'
    ];

    availableParams.forEach(param => {
      console.log(`  - ${param}`);
    });

    // Проверяем, какие параметры используются в последовательностях
    console.log('\nИспользуемые параметры в последовательностях:');
    const usedParams = new Set<string>();

    for (const type of types) {
      const sequence = sequences[type];
      if (!sequence || !Array.isArray(sequence)) continue;

      sequence.forEach((step: MarkupStep) => {
        if (step.operand1Type === 'markup' && step.operand1Key != null) usedParams.add(String(step.operand1Key));
        if (step.operand2Type === 'markup' && step.operand2Key != null) usedParams.add(String(step.operand2Key));
        if (step.operand3Type === 'markup' && step.operand3Key != null) usedParams.add(String(step.operand3Key));
        if (step.operand4Type === 'markup' && step.operand4Key != null) usedParams.add(String(step.operand4Key));
        if (step.operand5Type === 'markup' && step.operand5Key != null) usedParams.add(String(step.operand5Key));
      });
    }

    if (usedParams.size === 0) {
      console.log('  ✓ Параметры типа "markup" не используются (только числа)');
    } else {
      usedParams.forEach(param => {
        const exists = availableParams.includes(param);
        console.log(`  ${exists ? '✓' : '❌'} ${param}`);
      });
    }

    console.log('\n=== КОНЕЦ ПРОВЕРКИ ===');

  } catch (error) {
    console.error('Ошибка:', error);
  }
}

// Экспортируем в window
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).checkMarkupSequences = checkMarkupSequences;
  console.log('Для проверки последовательностей выполните:');
  console.log('window.checkMarkupSequences() или window.checkMarkupSequences("ID_ТЕНДЕРА")');
}