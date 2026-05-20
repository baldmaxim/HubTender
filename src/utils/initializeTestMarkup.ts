/**
 * Утилита-сидер тестовых данных для расчёта коммерческих стоимостей
 * (используется кнопкой "Инициализация тестовых данных" на странице Commerce).
 * Все вызовы идут через Go BFF.
 */

import { fetchTenders } from '../lib/api/tenders';
import {
  createMarkupTactic,
  createMarkupParameter,
  insertTenderMarkupPercentages,
  listActiveMarkupParameters,
  setTenderMarkupTacticId,
} from '../lib/api/markup';

export async function initializeTestMarkup(tenderId?: string): Promise<string | undefined> {
  console.log('=== Инициализация тестовых данных для наценок ===');

  try {
    if (!tenderId) {
      const tenders = await fetchTenders();
      if (!tenders || tenders.length === 0) {
        console.error('Нет тендеров в БД!');
        return;
      }
      const first = tenders[0];
      tenderId = first.id;
      console.log(`Используем тендер: ${first.tender_number ?? first.id}`);
    }

    console.log('\n1. Создаём тестовую тактику наценок...');

    const tactic = await createMarkupTactic({
      name: 'Тестовая тактика 20%',
      sequences: {
        'раб':       [{ name: 'Наценка 20%', baseIndex: -1, action1: 'multiply', operand1Type: 'number', operand1Key: 1.2 }],
        'мат':       [{ name: 'Наценка 25%', baseIndex: -1, action1: 'multiply', operand1Type: 'number', operand1Key: 1.25 }],
        'суб-раб':   [{ name: 'Наценка 15%', baseIndex: -1, action1: 'multiply', operand1Type: 'number', operand1Key: 1.15 }],
        'суб-мат':   [{ name: 'Наценка 18%', baseIndex: -1, action1: 'multiply', operand1Type: 'number', operand1Key: 1.18 }],
        'раб-комп.': [{ name: 'Наценка 10%', baseIndex: -1, action1: 'multiply', operand1Type: 'number', operand1Key: 1.1 }],
        'мат-комп.': [{ name: 'Наценка 12%', baseIndex: -1, action1: 'multiply', operand1Type: 'number', operand1Key: 1.12 }],
      },
      base_costs: { 'раб': 0, 'мат': 0, 'суб-раб': 0, 'суб-мат': 0, 'раб-комп.': 0, 'мат-комп.': 0 },
      is_global: false,
    });

    console.log(`✓ Создана тактика: ${tactic.id}`);

    console.log('\n2. Привязываем тактику к тендеру...');
    await setTenderMarkupTacticId(tenderId, tactic.id);
    console.log('✓ Тактика привязана к тендеру');

    console.log('\n3. Параметры наценок...');
    const existingParams = await listActiveMarkupParameters();

    if (existingParams.length === 0) {
      const basicParams = [
        { key: 'overhead',  label: 'Накладные расходы',  default_value: 15, is_active: true, order_num: 1 },
        { key: 'profit',    label: 'Прибыль',            default_value: 10, is_active: true, order_num: 2 },
        { key: 'risk',      label: 'Риски',              default_value: 5,  is_active: true, order_num: 3 },
        { key: 'transport', label: 'Транспорт',          default_value: 3,  is_active: true, order_num: 4 },
        { key: 'storage',   label: 'Складирование',      default_value: 2,  is_active: true, order_num: 5 },
      ];

      for (const p of basicParams) {
        await createMarkupParameter(p);
      }

      const refreshed = await listActiveMarkupParameters();
      console.log(`✓ Создано параметров: ${refreshed.length}`);

      const tenderParams = refreshed
        .filter((p) => basicParams.some((bp) => bp.key === p.key))
        .map((p) => ({
          tender_id: tenderId!,
          markup_parameter_id: p.id,
          value: p.default_value ?? 0,
        }));

      if (tenderParams.length > 0) {
        await insertTenderMarkupPercentages(tenderParams);
        console.log('✓ Параметры привязаны к тендеру');
      }
    } else {
      console.log('Параметры уже существуют в БД');
    }

    console.log('\n=== Инициализация завершена ===');
    console.log('Теперь можно нажать кнопку "Пересчитать" на странице Коммерция');

    return tactic.id;
  } catch (error) {
    console.error('Ошибка инициализации:', error);
  }
}

// Экспортируем для использования в консоли браузера
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).initializeTestMarkup = initializeTestMarkup;
}
