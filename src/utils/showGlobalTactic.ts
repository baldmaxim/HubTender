/**
 * Отображение структуры глобальной (базовой) схемы наценок
 */

import { supabase } from '../lib/supabase';
import type { MarkupStep, MarkupTactic } from '../lib/supabase';

export async function showGlobalTactic() {
  console.log('=== СТРУКТУРА ГЛОБАЛЬНОЙ (БАЗОВОЙ) СХЕМЫ НАЦЕНОК ===\n');

  try {
    // 1. Получаем глобальную тактику
    const { data: globalTactic, error } = await supabase
      .from('markup_tactics')
      .select('*')
      .eq('is_global', true)
      .single();

    if (error || !globalTactic) {
      console.error('Глобальная тактика не найдена!', error);

      // Проверим "Базовую схему" по имени
      const { data: baseTactic } = await supabase
        .from('markup_tactics')
        .select('*')
        .eq('name', 'Базовая схема')
        .single();

      if (baseTactic) {
        console.log('Найдена "Базовая схема" по имени (но не помечена как глобальная)');
        displayTactic(baseTactic);
      }
      return;
    }

    displayTactic(globalTactic);

  } catch (error) {
    console.error('Ошибка:', error);
  }
}

function displayTactic(tactic: MarkupTactic) {
  console.log(`Название: ${tactic.name}`);
  console.log(`ID: ${tactic.id}`);
  console.log(`Глобальная: ${tactic.is_global ? 'ДА' : 'НЕТ'}`);
  console.log(`Создана: ${new Date(tactic.created_at).toLocaleString('ru-RU')}`);
  console.log('\n');

  // Парсим последовательности
  const sequences = typeof tactic.sequences === 'string'
    ? JSON.parse(tactic.sequences)
    : tactic.sequences;

  const types = ['мат', 'раб', 'суб-мат', 'суб-раб', 'мат-комп.', 'раб-комп.'];

  console.log('=== ПОСЛЕДОВАТЕЛЬНОСТИ РАСЧЁТА ===\n');

  for (const type of types) {
    console.log(`\n--- ${type.toUpperCase()} ---`);
    const sequence = sequences[type];

    if (!sequence || !Array.isArray(sequence) || sequence.length === 0) {
      console.log('  ❌ Последовательность пустая или отсутствует');
      continue;
    }

    console.log(`  Количество шагов: ${sequence.length}`);
    console.log('  Формула расчёта:');

    sequence.forEach((step: MarkupStep, index: number) => {
      console.log(`\n  Шаг ${index + 1}: "${step.name || 'Без названия'}"`);

      // База для расчёта
      if (step.baseIndex === -1) {
        console.log('    База: ПРЯМЫЕ ЗАТРАТЫ (total_amount из boq_items)');
      } else if (step.baseIndex >= 0) {
        console.log(`    База: Результат шага ${step.baseIndex + 1}`);
      }

      // Первая операция
      console.log(`    Операция: ${getOperationDescription(step.action1, step.operand1Type, step.operand1Key)}`);

      // Вторая операция (если есть)
      if (step.action2) {
        console.log(`    Доп. операция: ${getOperationDescription(step.action2, step.operand2Type, step.operand2Key)}`);
      }

      // Третья операция (если есть)
      if (step.action3) {
        console.log(`    Доп. операция 2: ${getOperationDescription(step.action3, step.operand3Type, step.operand3Key)}`);
      }

      // Четвёртая операция (если есть)
      if (step.action4) {
        console.log(`    Доп. операция 3: ${getOperationDescription(step.action4, step.operand4Type, step.operand4Key)}`);
      }

      // Пятая операция (если есть)
      if (step.action5) {
        console.log(`    Доп. операция 4: ${getOperationDescription(step.action5, step.operand5Type, step.operand5Key)}`);
      }
    });

    // Показываем итоговую формулу
    console.log('\n  📊 Итоговая формула:');
    const formula = buildFormula(sequence);
    console.log(`    ${formula}`);
  }

  // Показываем используемые параметры
  console.log('\n\n=== ИСПОЛЬЗУЕМЫЕ ПАРАМЕТРЫ ===\n');
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
    console.log('✅ Не используются параметры из БД (только числовые значения)');
  } else {
    console.log('Параметры, требующиеся из таблицы tender_markup_percentage:');
    usedParams.forEach(param => {
      console.log(`  • ${param}`);
    });
  }
}

function getOperationDescription(action: string, operandType: string, operandKey: string | number | undefined): string {
  const actionMap: { [key: string]: string } = {
    'multiply': 'умножить на',
    'divide': 'разделить на',
    'add': 'прибавить',
    'subtract': 'вычесть'
  };

  const actionText = actionMap[action] || action;

  if (operandType === 'number') {
    return `${actionText} ${operandKey} (число)`;
  } else if (operandType === 'markup') {
    return `${actionText} ${operandKey}% (параметр из БД)`;
  } else if (operandType === 'step') {
    return `${actionText} результат шага ${typeof operandKey === 'number' ? operandKey + 1 : operandKey}`;
  }

  return `${actionText} ${operandKey}`;
}

function buildFormula(sequence: MarkupStep[]): string {
  if (!sequence || sequence.length === 0) return 'Пустая формула';

  let formula = 'ПРЯМЫЕ_ЗАТРАТЫ';

  sequence.forEach((step: MarkupStep) => {
    const op = getOperatorSymbol(step.action1);
    const value = getOperandDisplay(step.operand1Type, step.operand1Key);

    if (op === '*' || op === '/') {
      formula = `(${formula}) ${op} ${value}`;
    } else {
      formula = `${formula} ${op} ${value}`;
    }

    // Дополнительные операции
    if (step.action2) {
      const op2 = getOperatorSymbol(step.action2);
      const value2 = getOperandDisplay(step.operand2Type, step.operand2Key);
      formula = `${formula} ${op2} ${value2}`;
    }
  });

  return formula;
}

function getOperatorSymbol(action: string): string {
  const symbols: { [key: string]: string } = {
    'multiply': '*',
    'divide': '/',
    'add': '+',
    'subtract': '-'
  };
  return symbols[action] || action;
}

function getOperandDisplay(type: string, key: string | number | undefined): string {
  if (type === 'number') {
    return String(key);
  } else if (type === 'markup') {
    return `[${key}%]`;
  } else if (type === 'step') {
    return `[Шаг${typeof key === 'number' ? key + 1 : key}]`;
  }
  return String(key);
}

// Экспортируем в window
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).showGlobalTactic = showGlobalTactic;
  console.log('Для отображения глобальной схемы выполните:');
  console.log('window.showGlobalTactic()');
}