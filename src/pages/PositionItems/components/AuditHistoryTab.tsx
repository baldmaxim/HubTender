import React, { useState } from 'react';
import { Card, Space } from 'antd';
import AuditFilters from './AuditFilters';
import AuditHistoryTable from './AuditHistoryTable';
import type { AuditFilters as Filters } from '../../../types/audit';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useTheme } from '../../../contexts/ThemeContext';
import { LandscapeTableOverlay } from '../../../components/responsive/LandscapeTableOverlay';

interface AuditHistoryTabProps {
  positionId: string | undefined;
}

/**
 * Вкладка истории изменений BOQ items
 */
const AuditHistoryTab: React.FC<AuditHistoryTabProps> = ({ positionId }) => {
  const [filters, setFilters] = useState<Filters>({});
  const { isPhoneDevice, isLandscapePhone } = useIsMobile();
  const { theme } = useTheme();

  // Ландшафт телефона — таблица истории во весь экран с масштабированием
  if (isLandscapePhone) {
    return (
      <LandscapeTableOverlay theme={theme} width={1200}>
        <AuditHistoryTable positionId={positionId} filters={filters} readOnly plain />
      </LandscapeTableOverlay>
    );
  }

  return (
    <Card styles={{ body: { padding: 0 } }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div style={{ padding: '24px 24px 0' }}>
          <AuditFilters filters={filters} onChange={setFilters} />
        </div>
        <AuditHistoryTable positionId={positionId} filters={filters} readOnly={isPhoneDevice} />
      </Space>
    </Card>
  );
};

export default AuditHistoryTab;
