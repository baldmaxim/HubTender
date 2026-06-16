import React, { useState, useRef, useEffect } from 'react';
import { Popover, Modal, Input } from 'antd';
import type { InputRef } from 'antd';
import { CalculatorOutlined } from '@ant-design/icons';

interface CalculatorWidgetProps {
  /** На мобильных (<992px) калькулятор открывается модалкой по центру сверху. */
  isMobileLayout: boolean;
  isPhone: boolean;
}

/** Форматирование чисел с разрядами для отображения выражения. */
const formatCalcDisplay = (value: string): string => {
  // Разбиваем выражение на части (числа и операторы, включая ^ и sqrt)
  const parts = value.split(/([+\-*/()^]|sqrt)/);

  return parts
    .map((part) => {
      // Пропускаем операторы и пустые строки
      if (/^[+\-*/()^]\s*$/.test(part) || part === '' || part === 'sqrt') return part;

      // Убираем существующие пробелы
      const clean = part.replace(/\s/g, '');

      // Проверяем, является ли это числом
      if (/^-?\d+,?\d*$/.test(clean)) {
        const [integer, decimal] = clean.split(',');
        // Форматируем целую часть с пробелами
        const formattedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        return decimal !== undefined ? `${formattedInteger},${decimal}` : formattedInteger;
      }

      return part;
    })
    .join('');
};

export const CalculatorWidget: React.FC<CalculatorWidgetProps> = ({ isMobileLayout, isPhone }) => {
  const [calcValue, setCalcValue] = useState('0');
  const [calcOpen, setCalcOpen] = useState(false);
  const calcInputRef = useRef<InputRef>(null);

  // Функции калькулятора
  const handleCalcClick = (value: string) => {
    if (value === '=') {
      try {
        // Убираем пробелы и заменяем запятые на точки для вычислений
        let evalValue = calcValue.replace(/\s/g, '').replace(/,/g, '.');
        // Заменяем ^ на ** для возведения в степень
        evalValue = evalValue.replace(/\^/g, '**');
        // Обрабатываем sqrt как функцию
        evalValue = evalValue.replace(/sqrt\(([^)]+)\)/g, 'Math.sqrt($1)');
        const result = eval(evalValue);
        const resultStr = String(result).replace('.', ',');
        setCalcValue(resultStr);
      } catch {
        setCalcValue('Ошибка');
      }
    }
  };

  const handleCalcInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    // Разрешаем цифры, операторы, запятую, ^, и буквы для sqrt
    if (/^[0-9+\-*/.(),^sqrtа-яА-ЯёЁ\s]*$/.test(newValue) || newValue === '') {
      // Убираем все пробелы для проверки
      const cleanValue = newValue.replace(/\s/g, '');
      const cleanCurrentValue = calcValue.replace(/\s/g, '');

      // Если текущее значение "0" и пользователь вводит что-то
      if (cleanCurrentValue === '0' && cleanValue.length > 0) {
        // Если новое значение начинается с цифры (не оператора)
        if (/^[0-9]/.test(cleanValue)) {
          // Убираем все начальные и конечные нули, кроме случая "0,"
          const withoutZero = cleanValue.replace(/^0+|0+$/g, '').replace(/^$/, '0');
          setCalcValue(withoutZero);
        } else {
          // Если начинается с оператора, сохраняем как есть
          setCalcValue(cleanValue);
        }
      } else {
        setCalcValue(newValue || '0');
      }
    }
  };

  // Обработка клавиатурных событий для калькулятора
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!calcOpen) return;

      const key = e.key;
      if (key === 'Enter') {
        e.preventDefault();
        handleCalcClick('=');
      } else if (key === 'Escape') {
        e.preventDefault();
        setCalcValue('0');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcOpen, calcValue]);

  const content = (
    <div style={{ width: '100%' }}>
      <Input
        ref={calcInputRef}
        value={formatCalcDisplay(calcValue)}
        onChange={handleCalcInputChange}
        placeholder="Введите выражение..."
        style={{
          marginBottom: '8px',
          fontSize: '18px',
          textAlign: 'right',
          fontWeight: 'bold',
        }}
        onPressEnter={() => handleCalcClick('=')}
      />
      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>
        Операции: +, -, *, /, ^(степень), sqrt(x)
      </div>
      <div style={{ fontSize: '11px', color: '#888' }}>Enter — вычислить, Esc — очистить</div>
    </div>
  );

  const icon = (
    <CalculatorOutlined
      style={{
        fontSize: isPhone ? '20px' : '24px',
        cursor: 'pointer',
        color: '#1890ff',
        fontWeight: 'bold',
      }}
    />
  );

  if (isMobileLayout) {
    return (
      <>
        <span onClick={() => setCalcOpen(true)}>{icon}</span>
        <Modal
          title="Калькулятор"
          open={calcOpen}
          onCancel={() => setCalcOpen(false)}
          footer={null}
          width="92vw"
          style={{ top: 24, maxWidth: 380 }}
          styles={{ body: { paddingTop: 8 } }}
        >
          {content}
        </Modal>
      </>
    );
  }

  return (
    <Popover
      content={<div style={{ width: 300 }}>{content}</div>}
      title="Калькулятор"
      trigger="click"
      open={calcOpen}
      onOpenChange={setCalcOpen}
      placement="bottomRight"
    >
      {icon}
    </Popover>
  );
};

export default CalculatorWidget;
