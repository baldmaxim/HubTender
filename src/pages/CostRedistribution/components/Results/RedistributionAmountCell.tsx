/**
 * Ячейка для отображения суммы перераспределения с цветом
 */

import React, { memo } from 'react';
import { ArrowUpOutlined, ArrowDownOutlined, MinusOutlined } from '@ant-design/icons';
import { formatRu2 } from '../../../../utils/format/currency';

interface RedistributionAmountCellProps {
  amount: number;
}

const RedistributionAmountCellBase: React.FC<RedistributionAmountCellProps> = ({ amount }) => {
  const absAmount = Math.abs(amount);
  const formattedAmount = formatRu2(absAmount);

  if (amount > 0.01) {
    // Добавление
    return (
      <span style={{ color: '#52c41a', fontWeight: 500 }}>
        <ArrowUpOutlined style={{ marginRight: 4 }} />
        +{formattedAmount}
      </span>
    );
  } else if (amount < -0.01) {
    // Вычитание
    return (
      <span style={{ color: '#ff4d4f', fontWeight: 500 }}>
        <ArrowDownOutlined style={{ marginRight: 4 }} />
        {formattedAmount}
      </span>
    );
  } else {
    // Без изменений
    return (
      <span style={{ color: '#999' }}>
        <MinusOutlined style={{ marginRight: 4 }} />
        0.00
      </span>
    );
  }
};

/** memo: ячейка рендерится в каждой строке таблицы; пере-рендер только при смене amount. */
export const RedistributionAmountCell = memo(RedistributionAmountCellBase);
