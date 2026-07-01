/**
 * Ячейка для отображения суммы перераспределения с цветом
 */

import React, { memo } from 'react';
import { formatRu2 } from '../../../../utils/format/currency';

interface RedistributionAmountCellProps {
  amount: number;
}

// Стрелки — лёгкие unicode-глифы вместо SVG-иконок @ant-design/icons: при 500+ строк
// virtual монтирует ячейку на каждую видимую строку при скролле, и парс/вставка SVG
// заметно дороже текстового глифа на мобильном CPU.
const RedistributionAmountCellBase: React.FC<RedistributionAmountCellProps> = ({ amount }) => {
  const absAmount = Math.abs(amount);
  const formattedAmount = formatRu2(absAmount);

  if (amount > 0.01) {
    // Добавление
    return (
      <span style={{ color: '#52c41a', fontWeight: 500 }}>
        <span style={{ marginRight: 4 }}>▲</span>
        +{formattedAmount}
      </span>
    );
  } else if (amount < -0.01) {
    // Вычитание
    return (
      <span style={{ color: '#ff4d4f', fontWeight: 500 }}>
        <span style={{ marginRight: 4 }}>▼</span>
        {formattedAmount}
      </span>
    );
  } else {
    // Без изменений
    return (
      <span style={{ color: '#999' }}>
        <span style={{ marginRight: 4 }}>–</span>
        0.00
      </span>
    );
  }
};

/** memo: ячейка рендерится в каждой строке таблицы; пере-рендер только при смене amount. */
export const RedistributionAmountCell = memo(RedistributionAmountCellBase);
