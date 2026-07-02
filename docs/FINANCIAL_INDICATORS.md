# Документация страницы Финансовые показатели

## Обзор

Страница Финансовых показателей (`/financial-indicators`) предоставляет комплексный финансовый анализ строительных тендеров с 15 расчётными показателями. Включает два режима отображения (графики и таблицы), выбор тендера и возможность экспорта в Excel.

**Маршрут**: `/financial-indicators`
**Компонент**: `src/pages/FinancialIndicators/FinancialIndicators.tsx`
**Уровень доступа**: Все аутентифицированные пользователи

## Возможности

### 1. Интерфейс выбора тендера
- **Двухэтапный выбор**:
  - Выпадающий список названий тендеров (уникальные имена)
  - Селектор версии (все версии для выбранного названия)
- **Быстрый выбор карточкой**: Сетка из 6 недавних тендеров
- **Навигация назад**: Возврат к выбору тендера

### 2. 15 Финансовых показателей
Рассчитываются на основе данных СМР и тактик наценок:

**Прямые затраты**:
1. Материалы (Прямые)
2. Работы (Прямые)
3. Субподрядные материалы (Прямые)
4. Субподрядные работы (Прямые)
5. Компонентные материалы (Прямые)
6. Компонентные работы (Прямые)

**Коммерческие затраты** (с наценкой):
7. Материалы (Коммерческие)
8. Работы (Коммерческие)
9. Субподрядные материалы (Коммерческие)
10. Субподрядные работы (Коммерческие)
11. Компонентные материалы (Коммерческие)
12. Компонентные работы (Коммерческие)

**Итого**:
13. Всего материалов (все типы)
14. Всего работ (все типы)
15. Общая сумма

### 3. Два режима отображения
- **Режим графиков**: Визуальное представление с Chart.js
- **Режим таблицы**: Детальные табличные данные
- **Переключатель**: Мгновенное переключение режимов

### 4. Визуализации графиков
- **Столбчатые диаграммы**: Горизонтальное сравнение
- **Круговые диаграммы**: Разбивка пропорций
- **Подписи данных**: Значения на графиках
- **Цветовое кодирование**: Последовательная цветовая схема
- **Адаптивность**: Подстройка под размер экрана

### 5. Функция экспорта
- **Экспорт в Excel**: Все показатели в XLSX
- **Форматированный вывод**: Заголовки, границы, цвета
- **Формулы расчётов**: Встроены в ячейки
- **Отметка даты**: Включена дата экспорта

## UI Компоненты

### IndicatorsFilters
**Назначение**: Выбор тендера и управление обновлением

**Элементы**:
- Select названия тендера (ширина 300px)
- Select версии (ширина 150px)
- Кнопка обновления (перезагрузка данных)
- Индикаторы загрузки

### IndicatorsCharts
**Назначение**: Визуальное представление финансовых данных

**Типы графиков**:
1. **Сравнение прямых затрат**: Горизонтальная столбчатая диаграмма
   - Материалы vs Работы
   - Субподрядные материалы vs Работы
   - Компонентные материалы vs Работы

2. **Сравнение коммерческих затрат**: Горизонтальная столбчатая диаграмма
   - Та же структура что и прямые затраты
   - Другая цветовая схема

3. **Общая разбивка**: Круговая диаграмма
   - Итого материалов
   - Итого работ

4. **Карточка общей суммы**: Крупное отображение
   - Одно число с форматированием
   - Выразительное оформление

**Возможности**:
- Chart.js с плагином datalabels
- Адаптивный размер
- Всплывающие подсказки при наведении
- Русское форматирование чисел (пробелы как разделители тысяч)

### IndicatorsTable
**Назначение**: Табличное отображение всех показателей

**Колонки**:
1. Название показателя
2. Прямые затраты (RUB)
3. Коммерческие затраты (RUB)
4. Разница (RUB)
5. Наценка % (рассчитывается)

**Особенности строк**:
- Жирные итоги
- Цветовое кодирование категорий
- Форматирование чисел с разделителями тысяч
- Форматирование процентов (2 десятичных знака)

**Оформление**:
- Чередующаяся окраска строк
- Жирные итоговые строки
- Выравнивание чисел по правому краю
- Адаптивная ширина колонок

### TenderSelector (Начальный экран)
**Назначение**: Стартовая страница для выбора тендера

**Элементы**:
- Заголовок: "Финансовые показатели"
- Текст инструкций
- Select названия тендера (400px)
- Select версии (200px)
- Карточки быстрого выбора (6 тендеров)
  - Тег номера тендера
  - Название и версия тендера
  - Имя заказчика

## Рабочие процессы пользователя

### Выбор тендера
1. Попадание на страницу (тендер не выбран)
2. Отображение интерфейса выбора
3. Вариант А: Использование выпадающих списков
   - Выбор названия тендера
   - Выбор версии
   - Просмотр показателей
4. Вариант Б: Использование карточек
   - Клик на карточку тендера
   - Немедленный просмотр показателей

### Переключение режимов отображения
1. На странице показателей
2. Клик на вкладку "Графики" для графиков
3. Клик на вкладку "Таблица" для таблицы
4. Данные те же, представление другое

### Обновление данных
1. Клик на кнопку обновления в фильтрах
2. Повторная загрузка данных из БД
3. Пересчёт показателей
4. Обновление графиков/таблицы

### Изменение тендера
1. Использование выпадающих списков для выбора другого тендера/версии

### Экспорт в Excel
_Примечание: Функция экспорта будет реализована_
1. Клик на кнопку "Export"
2. Загрузка файла Excel
3. Открытие для просмотра форматированных показателей

## Модель данных

### Основной источник данных
Данные агрегируются из нескольких таблиц:
- `boq_items`: Все элементы СМР для тендера
- `client_positions`: Связи позиций
- `tenders`: Информация о тендере
- `markup_tactics`: Расчёты наценок
- `markup_parameters`: Коэффициенты наценок

### Запрос агрегации
```sql
SELECT
  -- Прямые затраты
  SUM(CASE WHEN boq_item_type = 'мат' THEN initial_price * quantity ELSE 0 END) AS materials_direct,
  SUM(CASE WHEN boq_item_type = 'раб' THEN initial_price * quantity ELSE 0 END) AS works_direct,
  SUM(CASE WHEN boq_item_type = 'суб-мат' THEN initial_price * quantity ELSE 0 END) AS sub_materials_direct,
  SUM(CASE WHEN boq_item_type = 'суб-раб' THEN initial_price * quantity ELSE 0 END) AS sub_works_direct,
  SUM(CASE WHEN boq_item_type = 'мат-комп.' THEN initial_price * quantity ELSE 0 END) AS comp_materials_direct,
  SUM(CASE WHEN boq_item_type = 'раб-комп.' THEN initial_price * quantity ELSE 0 END) AS comp_works_direct,

  -- Коммерческие затраты
  SUM(CASE WHEN boq_item_type = 'мат' THEN calculated_price * quantity ELSE 0 END) AS materials_commercial,
  SUM(CASE WHEN boq_item_type = 'раб' THEN calculated_price * quantity ELSE 0 END) AS works_commercial,
  SUM(CASE WHEN boq_item_type = 'суб-мат' THEN calculated_price * quantity ELSE 0 END) AS sub_materials_commercial,
  SUM(CASE WHEN boq_item_type = 'суб-раб' THEN calculated_price * quantity ELSE 0 END) AS sub_works_commercial,
  SUM(CASE WHEN boq_item_type = 'мат-комп.' THEN calculated_price * quantity ELSE 0 END) AS comp_materials_commercial,
  SUM(CASE WHEN boq_item_type = 'раб-комп.' THEN calculated_price * quantity ELSE 0 END) AS comp_works_commercial

FROM boq_items bi
JOIN client_positions cp ON bi.client_position_id = cp.id
WHERE cp.tender_id = $1
```

## API Endpoints (Supabase)

### Получение финансовых показателей
```typescript
const { data, error } = await supabase
  .rpc('calculate_financial_indicators', {
    tender_id: selectedTenderId
  });

// Возвращает:
interface FinancialIndicators {
  materials_direct: number;
  works_direct: number;
  sub_materials_direct: number;
  sub_works_direct: number;
  comp_materials_direct: number;
  comp_works_direct: number;
  materials_commercial: number;
  works_commercial: number;
  sub_materials_commercial: number;
  sub_works_commercial: number;
  comp_materials_commercial: number;
  comp_works_commercial: number;
}
```

### Получение тендеров
```typescript
const { data: tenders } = await supabase
  .from('tenders')
  .select('*')
  .order('created_at', { ascending: false });
```

## Расчёты

### Итого материалов
```typescript
const totalMaterialsDirect =
  data.materials_direct +
  data.sub_materials_direct +
  data.comp_materials_direct;

const totalMaterialsCommercial =
  data.materials_commercial +
  data.sub_materials_commercial +
  data.comp_materials_commercial;
```

### Итого работ
```typescript
const totalWorksDirect =
  data.works_direct +
  data.sub_works_direct +
  data.comp_works_direct;

const totalWorksCommercial =
  data.works_commercial +
  data.sub_works_commercial +
  data.comp_works_commercial;
```

### Общие суммы
```typescript
const spTotal = totalMaterialsDirect + totalWorksDirect; // Прямые
const customerTotal = totalMaterialsCommercial + totalWorksCommercial; // Коммерческие
```

### Процент наценки
```typescript
function calculateMarkup(direct: number, commercial: number): number {
  if (direct === 0) return 0;
  return ((commercial - direct) / direct) * 100;
}

// Пример: Прямые = 1000000, Коммерческие = 1200000
// Наценка = ((1200000 - 1000000) / 1000000) * 100 = 20%
```

## Конфигурация Chart.js

### Настройка столбчатой диаграммы
```typescript
const chartConfig = {
  type: 'bar',
  data: {
    labels: ['Материалы', 'Работы'],
    datasets: [
      {
        label: 'Прямые затраты',
        data: [materialsDirect, worksDirect],
        backgroundColor: '#3b82f6',
      },
      {
        label: 'Коммерческие затраты',
        data: [materialsCommercial, worksCommercial],
        backgroundColor: '#10b981',
      },
    ],
  },
  options: {
    indexAxis: 'y', // Горизонтальные столбцы
    responsive: true,
    plugins: {
      datalabels: {
        anchor: 'end',
        align: 'right',
        formatter: (value) => formatNumber(value),
        color: '#000',
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            return `${context.dataset.label}: ${formatNumber(context.raw)} руб.`;
          },
        },
      },
    },
  },
};
```

### Настройка круговой диаграммы
```typescript
const pieConfig = {
  type: 'pie',
  data: {
    labels: ['Материалы', 'Работы'],
    datasets: [
      {
        data: [totalMaterials, totalWorks],
        backgroundColor: ['#3b82f6', '#10b981'],
      },
    ],
  },
  options: {
    responsive: true,
    plugins: {
      datalabels: {
        formatter: (value, context) => {
          const total = context.dataset.data.reduce((a, b) => a + b, 0);
          const percent = ((value / total) * 100).toFixed(1);
          return `${percent}%`;
        },
        color: '#fff',
        font: { weight: 'bold', size: 14 },
      },
      legend: {
        position: 'bottom',
      },
    },
  },
};
```

## Форматирование чисел

### Русский формат (пробелы)
```typescript
function formatNumber(value: number | undefined): string {
  if (value === undefined) return '';
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// Примеры:
// 1234567 → "1 234 567"
// 1000000.5 → "1 000 001"
```

### Формат процентов
```typescript
function formatPercent(value: number): string {
  return value.toFixed(2) + '%';
}

// Примеры:
// 20.5 → "20.50%"
// 15 → "15.00%"
```

## Управление состоянием

### Состояние компонента
```typescript
interface FinancialIndicatorsState {
  tenders: Tender[];
  selectedTenderId: string | null;
  selectedTenderTitle: string;
  selectedVersion: number | null;
  loading: boolean;
  activeTab: 'table' | 'charts';
  data: FinancialIndicators | null;
  spTotal: number;
  customerTotal: number;
}
```

### Пользовательский хук: useFinancialData
```typescript
interface UseFinancialDataReturn {
  tenders: Tender[];
  loading: boolean;
  data: FinancialIndicators | null;
  spTotal: number;
  customerTotal: number;
  loadTenders: () => Promise<void>;
  fetchFinancialIndicators: (tenderId: string) => Promise<void>;
}
```

## Структура таблицы

### Строки таблицы
```typescript
interface TableRow {
  key: string;
  indicator: string;
  directCost: number;
  commercialCost: number;
  difference: number;
  markupPercent: number;
  isBold?: boolean; // Для итоговых строк
}

const rows: TableRow[] = [
  {
    key: '1',
    indicator: 'Материалы',
    directCost: data.materials_direct,
    commercialCost: data.materials_commercial,
    difference: data.materials_commercial - data.materials_direct,
    markupPercent: calculateMarkup(data.materials_direct, data.materials_commercial),
  },
  // ... остальные строки
  {
    key: 'total',
    indicator: 'ИТОГО',
    directCost: spTotal,
    commercialCost: customerTotal,
    difference: customerTotal - spTotal,
    markupPercent: calculateMarkup(spTotal, customerTotal),
    isBold: true,
  },
];
```

## Оптимизация производительности

### Мемоизированные расчёты
```typescript
const calculations = useMemo(() => {
  if (!data) return null;

  const totalMaterialsDirect = data.materials_direct +
    data.sub_materials_direct +
    data.comp_materials_direct;

  // ... все расчёты

  return { totalMaterialsDirect, totalMaterialsCommercial, /* ... */ };
}, [data]);
```

### Мемоизация графиков
```typescript
const chartData = useMemo(() => {
  if (!data) return null;
  return {
    // ... конфигурация графика
  };
}, [data, formatNumber]);
```

## Формат экспорта в Excel

### Структура листа
```
A1: "Финансовые показатели"
A2: [Название тендера]
A3: "Дата: [Текущая дата]"

A5: "Показатель"
B5: "Прямые затраты"
C5: "Коммерческие затраты"
D5: "Разница"
E5: "Наценка %"

A6: "Материалы"
B6: [формула =SUM(...)]
...
```

### Оформление ячеек
- **Заголовки**: Жирные, центрированные, цвет заливки
- **Числа**: Разделитель тысяч, 2 десятичных знака
- **Проценты**: Формат процента
- **Итоги**: Жирные, верхняя граница
- **Границы**: Все ячейки

## Обработка ошибок

### Тендер не выбран
```typescript
if (!selectedTenderId) {
  return <TenderSelector />;
}
```

### Состояние загрузки
```typescript
<Spin spinning={loading}>
  {/* Графики/Таблица */}
</Spin>
```

### Ошибки получения данных
```typescript
try {
  const { data, error } = await supabase.rpc('calculate_financial_indicators');
  if (error) throw error;
  setData(data);
} catch (error) {
  console.error('Error fetching indicators:', error);
  message.error('Ошибка загрузки финансовых показателей');
}
```

### Нет доступных данных
```typescript
if (!data || spTotal === 0) {
  return (
    <Empty
      description="Нет данных для выбранного тендера"
      image={Empty.PRESENTED_IMAGE_SIMPLE}
    />
  );
}
```

## Цветовая схема

### Цвета графиков
- **Прямые затраты**: Синий (#3b82f6)
- **Коммерческие затраты**: Зелёный (#10b981)
- **Материалы**: Синий (#3b82f6)
- **Работы**: Зелёный (#10b981)
- **Субподряд**: Оранжевый (#f59e0b)
- **Компоненты**: Фиолетовый (#8b5cf6)

### Цвета таблицы
- **Заголовок**: Светло-серый фон
- **Итоговые строки**: Жирный текст, верхняя граница
- **Чередующиеся строки**: Зебра-раскраска

## Связанные страницы

- **[Коммерция](COMMERCE_PAGE.md)**: Коммерческие расчёты на уровне позиций
- **[Позиции заказчика](CLIENT_POSITIONS.md)**: Источник данных СМР
- **[Дашборд](DASHBOARD_DESIGN_SYSTEM.md)**: Обзор тендеров

## Скриншоты

_Скриншоты будут размещены здесь, показывающие:_
1. Экран выбора тендера
2. Режим графиков со столбчатыми диаграммами
3. Разбивка круговой диаграммы
4. Табличный режим со всеми показателями
5. Фильтры и элементы управления
6. Образец экспорта Excel

## Технические примечания

### Регистрация плагина Chart.js
```typescript
import ChartDataLabels from 'chartjs-plugin-datalabels';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  ChartDataLabels // Требуется для подписей данных
);
```

### Русская локализация
```typescript
import dayjs from 'dayjs';
import 'dayjs/locale/ru';

dayjs.locale('ru');
```

### Адаптивные графики
Графики автоматически изменяют размер в зависимости от контейнера:
```typescript
<div style={{ height: '400px', marginBottom: '24px' }}>
  <Bar data={chartData} options={chartOptions} />
</div>
```

## Будущие улучшения

- [ ] Реализация экспорта в Excel
- [ ] Экспорт в PDF с графиками
- [ ] Историческое сравнение (несколько тендеров)
- [ ] Анализ трендов во времени
- [ ] Сравнение бюджета с фактическими данными
- [ ] Определение пользовательских показателей
- [ ] Детализация показателей до позиций
- [ ] Email отчёты
- [ ] Запланированные экспорты
- [ ] Виджеты дашборда для ключевых показателей
