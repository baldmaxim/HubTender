/**
 * Компонент выбора тендера для коммерции
 */

import { Card, Select, Typography, Row, Col, Tag } from 'antd';
import { DollarOutlined } from '@ant-design/icons';
import type { Tender } from '../../../lib/types';
import type { TenderOption } from '../types';
import { getVersionColorByTitle } from '../../../utils/versionColor';
import { useIsMobile } from '../../../hooks/useIsMobile';

const { Title, Text } = Typography;

interface TenderSelectorProps {
  tenders: Tender[];
  selectedTenderTitle: string | null;
  selectedVersion: number | null;
  onTenderTitleChange: (title: string) => void;
  onVersionChange: (version: number) => void;
  onTenderSelect: (tenderId: string, title: string, version: number) => void;
  shouldFilterArchived?: boolean;
}

export default function TenderSelector({
  tenders,
  selectedTenderTitle,
  selectedVersion,
  onTenderTitleChange,
  onVersionChange,
  onTenderSelect,
  shouldFilterArchived = false
}: TenderSelectorProps) {
  const { isPhone, isPhoneDevice } = useIsMobile();
  // Получение уникальных наименований тендеров
  const getTenderTitles = (): TenderOption[] => {
    const uniqueTitles = new Map<string, TenderOption>();

    const filteredTenders = shouldFilterArchived
      ? tenders.filter(t => !t.is_archived)
      : tenders;

    filteredTenders.forEach(tender => {
      if (!uniqueTitles.has(tender.title)) {
        uniqueTitles.set(tender.title, {
          value: tender.title,
          label: tender.title,
          clientName: tender.client_name,
        });
      }
    });

    return Array.from(uniqueTitles.values());
  };

  // Получение версий для выбранного наименования тендера
  const getVersionsForTitle = (title: string): { value: number; label: string }[] => {
    const filtered = shouldFilterArchived
      ? tenders.filter(tender => tender.title === title && !tender.is_archived)
      : tenders.filter(tender => tender.title === title);

    return filtered
      .map(tender => ({
        value: tender.version || 1,
        label: `Версия ${tender.version || 1}`,
      }))
      .sort((a, b) => b.value - a.value);
  };

  return (
    <Card bordered={false} style={{ height: '100%' }}>
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <Title level={3} style={{ marginBottom: 24 }}>
          <DollarOutlined /> Форма КП
        </Title>
        <Text type="secondary" style={{ fontSize: 16, marginBottom: 24, display: 'block' }}>
          Выберите тендер для просмотра коммерческих стоимостей
        </Text>
        <Select
          className="tender-select"
          style={{ width: isPhone ? '100%' : 400, marginBottom: isPhone ? 16 : 32 }}
          placeholder="Выберите тендер"
          value={selectedTenderTitle}
          onChange={onTenderTitleChange}
          showSearch
          optionFilterProp="children"
          filterOption={(input, option) =>
            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
          options={getTenderTitles()}
          size="large"
        />

        {selectedTenderTitle && (
          <Select
            style={{
              width: isPhone ? '100%' : 200,
              marginBottom: 32,
              marginLeft: isPhone ? 0 : 16,
            }}
            placeholder="Выберите версию"
            value={selectedVersion}
            onChange={onVersionChange}
            options={getVersionsForTitle(selectedTenderTitle)}
            size="large"
          />
        )}

        {tenders.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
              Или выберите из списка:
            </Text>
            <Row gutter={isPhoneDevice ? [8, 8] : [16, 16]} justify="center">
              {tenders.filter(t => !t.is_archived).slice(0, 6).map(tender => (
                <Col key={tender.id}>
                  <Card
                    hoverable
                    style={{
                      width: isPhoneDevice ? 160 : 200,
                      textAlign: 'center',
                      cursor: 'pointer',
                      borderColor: '#10b981',
                      borderWidth: 1,
                    }}
                    onClick={() => onTenderSelect(tender.id, tender.title, tender.version || 1)}
                    onAuxClick={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        window.open(`/commerce?tenderId=${tender.id}`, '_blank');
                      }
                    }}
                  >
                    <div style={{ marginBottom: 8 }}>
                      <Tag color="#10b981">{tender.tender_number}</Tag>
                    </div>
                    <div style={{
                      marginBottom: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexWrap: 'nowrap',
                      gap: 4
                    }}>
                      <Text strong style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 140
                      }}>
                        {tender.title}
                      </Text>
                      <Tag color={getVersionColorByTitle(tender.version, tender.title, tenders)} style={{ flexShrink: 0, margin: 0 }}>v{tender.version || 1}</Tag>
                    </div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {tender.client_name}
                    </Text>
                  </Card>
                </Col>
              ))}
            </Row>
          </div>
        )}
      </div>
    </Card>
  );
}
