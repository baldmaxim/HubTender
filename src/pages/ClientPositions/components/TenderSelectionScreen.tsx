import React from 'react';
import { Card, Select, Row, Col, Typography, Tag } from 'antd';
import type { Tender } from '../../../lib/supabase';
import { getVersionColorByTitle } from '../../../utils/versionColor';

const { Title, Text } = Typography;

interface TenderOption {
  value: string;
  label: string;
  clientName: string;
}

interface TenderSelectionScreenProps {
  tenders: Tender[];
  selectedTenderTitle: string | null;
  selectedVersion: number | null;
  tenderTitles: TenderOption[];
  versions: { value: number; label: string }[];
  onTenderTitleChange: (title: string) => void;
  onVersionChange: (version: number) => void;
  onTenderCardClick: (tender: Tender) => void;
  shouldFilterArchived?: boolean;
}

export const TenderSelectionScreen: React.FC<TenderSelectionScreenProps> = ({
  tenders,
  selectedTenderTitle,
  selectedVersion,
  tenderTitles,
  versions,
  onTenderTitleChange,
  onVersionChange,
  onTenderCardClick,
}) => {
  return (
    <Card bordered={false} style={{ height: '100%' }}>
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <Title level={3} style={{ marginBottom: 24 }}>
          Позиции заказчика
        </Title>
        <Text type="secondary" style={{ fontSize: 16, marginBottom: 24, display: 'block' }}>
          Выберите тендер для просмотра позиций
        </Text>
        <Select
          className="tender-select"
          style={{ width: 400, marginBottom: 32 }}
          placeholder="Выберите тендер"
          value={selectedTenderTitle}
          onChange={onTenderTitleChange}
          showSearch
          optionFilterProp="children"
          filterOption={(input, option) =>
            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
          options={tenderTitles}
          size="large"
        />

        {selectedTenderTitle && (
          <Select
            style={{ width: 200, marginBottom: 32, marginLeft: 16 }}
            placeholder="Выберите версию"
            value={selectedVersion}
            onChange={onVersionChange}
            options={versions}
            size="large"
          />
        )}

        {tenders.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
              Или выберите из списка:
            </Text>
            <Row gutter={[16, 16]} justify="center">
              {tenders.filter(t => !t.is_archived).slice(0, 6).map(tender => (
                <Col key={tender.id}>
                  <Card
                    hoverable
                    style={{
                      width: 200,
                      textAlign: 'center',
                      cursor: 'pointer',
                      borderColor: '#10b981',
                      borderWidth: 1,
                    }}
                    onClick={() => onTenderCardClick(tender)}
                    onAuxClick={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        window.open(`/positions?tender=${tender.id}&title=${encodeURIComponent(tender.title)}&version=${tender.version || 1}`, '_blank');
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
};
