# Анализ системы наценок и финансовых показателей

## Структура базы данных

### 1. markup_parameters (Глобальный справочник параметров наценок)
```sql
CREATE TABLE markup_parameters (
  id UUID PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,        -- Ключ параметра (например, 'vat', 'mechanization')
  label TEXT NOT NULL,               -- Название (например, 'НДС', 'Механизация')
  is_active BOOLEAN DEFAULT true,
  order_num INTEGER DEFAULT 0,
  default_value NUMERIC(5,2) DEFAULT 0,  -- Базовое значение процента (например, 22.00 для НДС)
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Назначение**: Глобальный справочник всех возможных параметров наценок (НДС, Механизация, МВП+ГСМ, ООЗ, Прибыль и т.д.)

**Ключевые поля**:
- `key` - уникальный идентификатор параметра
- `label` - название для отображения в UI
- `default_value` - базовое значение по умолчанию

---

### 2. markup_tactics (Тактики/схемы наценок)
```sql
CREATE TABLE markup_tactics (
  id UUID PRIMARY KEY,
  name TEXT,                          -- Название тактики (например, 'Базовая схема')
  sequences JSONB NOT NULL DEFAULT '{
    "мат": [],
    "раб": [],
    "суб-мат": [],
    "суб-раб": [],
    "мат-комп.": [],
    "раб-комп.": []
  }',
  base_costs JSONB NOT NULL DEFAULT '{
    "мат": 0,
    "раб": 0,
    "суб-мат": 0,
    "суб-раб": 0,
    "мат-комп.": 0,
    "раб-комп.": 0
  }',
  user_id UUID,
  is_global BOOLEAN DEFAULT false,    -- Глобальная тактика (доступна всем)
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Назначение**: Хранит настройки тактик наценок - какие параметры применяются и в каком порядке

**Структура sequences (JSONB)**:
```json
{
  "мат": [
    {
      "markup_parameter_id": "uuid_параметра_НДС",
      "order": 1
    },
    {
      "markup_parameter_id": "uuid_параметра_механизации",
      "order": 2
    }
  ],
  "раб": [...]
}
```

**ВАЖНО**: `sequences` - это JSONB поле, которое хранит массивы с ID параметров для каждого типа позиции

---

### 3. tender_markup_percentage (Проценты наценок для тендера)
```sql
CREATE TABLE tender_markup_percentage (
  id UUID PRIMARY KEY,
  tender_id UUID NOT NULL,                    -- Ссылка на тендер
  markup_parameter_id UUID NOT NULL,          -- Ссылка на параметр из справочника
  value NUMERIC(8,5) NOT NULL DEFAULT 0,      -- Значение процента для данного тендера
  created_at TIMESTAMP,
  updated_at TIMESTAMP,

  UNIQUE (tender_id, markup_parameter_id)     -- Один параметр - одно значение на тендер
);
```

**Назначение**: Хранит конкретные значения процентов наценок для каждого тендера

**Пример данных**:
```
tender_id: abc-123
markup_parameter_id: uuid_НДС
value: 22.00000

tender_id: abc-123
markup_parameter_id: uuid_Механизации
value: 15.50000
```

---

### 4. tenders (Тендеры)
```sql
CREATE TABLE tenders (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  tender_number TEXT,
  markup_tactic_id UUID,          -- Ссылка на выбранную тактику наценок
  area_sp NUMERIC,                -- Площадь по СП
  area_client NUMERIC,            -- Площадь заказчика
  ...
);
```

**Назначение**: Основная информация о тендере, включая ссылку на применяемую тактику наценок

---

## Как это работает

### Шаг 1: Настройка параметров (Страница "Проценты наценок")
1. Администратор создает глобальные параметры в `markup_parameters`
2. Для каждого параметра устанавливается базовое значение (`default_value`)

### Шаг 2: Создание тактики (Страница "Конструктор наценок")
1. Создается запись в `markup_tactics` с уникальным именем
2. В поле `sequences` (JSONB) определяется последовательность применения параметров
3. Для каждого типа позиции (мат, раб, суб-мат и т.д.) указывается:
   - Какие параметры применяются
   - В каком порядке

**Пример sequences**:
```json
{
  "мат": [
    {"markup_parameter_id": "id_механизации", "order": 1},
    {"markup_parameter_id": "id_НДС", "order": 2}
  ],
  "раб": [
    {"markup_parameter_id": "id_накладных", "order": 1},
    {"markup_parameter_id": "id_прибыли", "order": 2}
  ]
}
```

### Шаг 3: Привязка тактики к тендеру
1. В таблице `tenders` устанавливается `markup_tactic_id`
2. Тендер теперь использует выбранную тактику наценок

### Шаг 4: Установка процентов для тендера (Страница "Проценты наценок")
1. Для выбранного тендера создаются записи в `tender_markup_percentage`
2. Каждая запись связывает:
   - `tender_id` - ID тендера
   - `markup_parameter_id` - ID параметра из справочника
   - `value` - конкретное значение процента для этого тендера

---

## Проблема в useFinancialCalculations.ts

### Ошибочный код (строки 81-84):
```typescript
const { data: markupSequences } = await supabase
  .from('markup_sequences')  // ❌ ТАБЛИЦЫ НЕ СУЩЕСТВУЕТ!
  .select('markup_parameter_id')
  .eq('markup_tactic_id', tender.markup_tactic_id);
```

### ПРОБЛЕМА:
Таблицы `markup_sequences` **НЕ СУЩЕСТВУЕТ** в базе данных!

### ЧТО ДОЛЖНО БЫТЬ:
Последовательности параметров хранятся в поле `sequences` (JSONB) таблицы `markup_tactics`

### Правильный код:
```typescript
// 1. Загрузить тактику наценок
const { data: tactic, error: tacticError } = await supabase
  .from('markup_tactics')
  .select('sequences')
  .eq('id', tender.markup_tactic_id)
  .single();

if (tacticError) {
  console.error('Ошибка загрузки тактики:', tacticError);
}

// 2. Извлечь ID параметров из sequences (JSONB)
// sequences имеет структуру: { "мат": [...], "раб": [...], ... }
const allSequenceIds = new Set<string>();

if (tactic?.sequences) {
  // Проходим по всем типам позиций (мат, раб, суб-мат и т.д.)
  Object.values(tactic.sequences).forEach((sequenceArray: any) => {
    if (Array.isArray(sequenceArray)) {
      sequenceArray.forEach((item: any) => {
        if (item.markup_parameter_id) {
          allSequenceIds.add(item.markup_parameter_id);
        }
      });
    }
  });
}

// 3. Проверить, есть ли НДС в конструкторе
const isVatInConstructor = vatParam ? allSequenceIds.has(vatParam.id) : false;
```

---

## Почему не происходит пересчет при изменении markup_tactic_id

### Текущая ситуация:
1. ✅ Есть Realtime подписка на изменения в таблице `tenders`
2. ✅ При изменении тендера вызывается `fetchFinancialIndicators(selectedTenderId)`
3. ❌ **НО**: код пытается загрузить данные из несуществующей таблицы `markup_sequences`

### Что происходит:
1. Пользователь меняет `markup_tactic_id` в тендере (выбирает другую схему наценок)
2. Срабатывает Realtime событие UPDATE
3. Вызывается `fetchFinancialIndicators()`
4. Код пытается сделать запрос к `markup_sequences` - **ЗАПРОС ПАДАЕТ С ОШИБКОЙ**
5. Переменная `markupSequences` остается `undefined` или `null`
6. Расчеты выполняются с неверными данными или вообще не выполняются

---

## Решение

### 1. Исправить загрузку sequences:
```typescript
// Вместо:
const { data: markupSequences } = await supabase
  .from('markup_sequences')  // ❌ НЕ СУЩЕСТВУЕТ
  .select('markup_parameter_id')
  .eq('markup_tactic_id', tender.markup_tactic_id);

// Использовать:
const { data: tacticData, error: tacticLoadError } = await supabase
  .from('markup_tactics')
  .select('sequences')
  .eq('id', tender.markup_tactic_id)
  .single();

// Извлечь ID параметров из JSONB
const sequenceParameterIds = new Set<string>();
if (tacticData?.sequences) {
  Object.values(tacticData.sequences).forEach((seqArray: any) => {
    if (Array.isArray(seqArray)) {
      seqArray.forEach((item: any) => {
        if (item.markup_parameter_id) {
          sequenceParameterIds.add(item.markup_parameter_id);
        }
      });
    }
  });
}
```

### 2. Использовать полученные данные для проверки:
```typescript
const isVatInConstructor = vatParam ? sequenceParameterIds.has(vatParam.id) : false;
```

---

## Логика зависимостей

```
1. markup_parameters (справочник параметров)
   ↓
2. markup_tactics.sequences (JSONB: какие параметры используются)
   ↓
3. tenders.markup_tactic_id (какая тактика применяется к тендеру)
   ↓
4. tender_markup_percentage (конкретные значения процентов для тендера)
   ↓
5. useFinancialCalculations (расчет финансовых показателей)
```

**Ключевые моменты**:
- `markup_parameters` определяет **ЧТО можно использовать** (НДС, Механизация, и т.д.)
- `markup_tactics.sequences` определяет **КАК и В КАКОМ ПОРЯДКЕ** применяются параметры
- `tender_markup_percentage` определяет **КОНКРЕТНЫЕ ЗНАЧЕНИЯ** для каждого тендера
- `useFinancialCalculations` использует эти данные для **РАСЧЕТА ИТОГОВ**

---

## Выводы

1. ❌ **Критическая ошибка**: Запрос к несуществующей таблице `markup_sequences`
2. ✅ **Правильная структура**: Данные хранятся в JSONB поле `markup_tactics.sequences`
3. ✅ **Realtime работает**: Подписка на изменения тендера функционирует корректно
4. ❌ **Расчеты не обновляются**: Из-за ошибки в запросе данных из sequences

**Необходимо**: Исправить useFinancialCalculations.ts для корректной загрузки sequences из JSONB поля.
