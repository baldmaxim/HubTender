import React from 'react';
import { Space, Typography, Tooltip } from 'antd';
import type { BoqItemAudit } from '../../../types/audit';
import { getFieldDiffs, formatFieldValue, isVersionCopy } from '../utils/auditHelpers';
import { useTheme } from '../../../contexts/ThemeContext';

const { Text } = Typography;

interface AuditDiffCellProps {
  record: BoqItemAudit;
}

/**
 * Компонент для отображения измененных полей с подсветкой
 */
const AuditDiffCell: React.FC<AuditDiffCellProps> = ({ record }) => {
  const { theme } = useTheme();
  const diffs = getFieldDiffs(record);

  // Для INSERT и DELETE не показываем diff
  if (diffs.length === 0) {
    if (isVersionCopy(record)) {
      return <Text type="secondary">Перенесено из предыдущей версии; пользователь — последний, кто менял строку там</Text>;
    }

    if (record.operation_type === 'INSERT') {
      return <Text type="secondary">Элемент добавлен</Text>;
    }

    if (record.operation_type === 'DELETE') {
      return <Text type="secondary">Элемент удален</Text>;
    }

    return <Text type="secondary">-</Text>;
  }

  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      {diffs.map((diff) => (
        <div
          key={diff.field}
          style={{
            backgroundColor: theme === 'dark'
              ? 'rgba(255, 193, 7, 0.15)'
              : '#fff3cd',
            padding: '4px 8px',
            borderRadius: 4,
          }}
        >
          <Tooltip title={`Поле: ${diff.field}`}>
            <Text strong>{diff.displayName}: </Text>
          </Tooltip>
          <Text delete type="secondary">
            {formatFieldValue(diff.field, diff.oldValue, record.cost_categories_map, record.work_names_map, record.material_names_map)}
          </Text>
          {' → '}
          <Text strong>{formatFieldValue(diff.field, diff.newValue, record.cost_categories_map, record.work_names_map, record.material_names_map)}</Text>
        </div>
      ))}
    </Space>
  );
};

export default AuditDiffCell;
