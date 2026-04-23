/**
 * Компонент выбора тендера для просмотра затрат
 */

import React from 'react';
import { Card, Select, Typography, Row, Col, Tag } from 'antd';
import type { Tender } from '../../../../lib/supabase';
import type { TenderOption } from '../hooks/useCostData';
import { getVersionColorByTitle } from '../../../../utils/versionColor';

const { Title, Text } = Typography;

interface TenderSelectionProps {
  tenders: Tender[];
  selectedTenderTitle: string | null;
  selectedVersion: number | null;
  getTenderTitles: () => TenderOption[];
  getVersionsForTitle: (title: string) => { value: number; label: string }[];
  onTenderTitleChange: (title: string) => void;
  onVersionChange: (version: number) => void;
  onTenderSelect: (tenderId: string, title: string, version: number) => void;
  shouldFilterArchived?: boolean;
}

const TenderSelection: React.FC<TenderSelectionProps> = ({
  tenders,
  selectedTenderTitle,
  selectedVersion,
  getTenderTitles,
  getVersionsForTitle,
  onTenderTitleChange,
  onVersionChange,
  onTenderSelect,
}) => {
  return (
    <div style={{ margin: '-16px', padding: '24px' }}>
      <Card bordered={false} style={{ height: '100%' }}>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <Title level={4} style={{ marginBottom: 24 }}>
            Затраты на строительство
          </Title>
          <Text type="secondary" style={{ fontSize: 16, marginBottom: 24, display: 'block' }}>
            Выберите тендер для просмотра затрат
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
            options={getTenderTitles()}
            size="large"
          />

          {selectedTenderTitle && (
            <Select
              style={{ width: 200, marginBottom: 32, marginLeft: 16 }}
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
              <Row gutter={[16, 16]} justify="center">
                {tenders.filter(t => !t.is_archived).slice(0, 6).map((tender) => (
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
                      onClick={() => {
                        onTenderSelect(tender.id, tender.title, tender.version || 1);
                      }}
                      onAuxClick={(e) => {
                        if (e.button === 1) {
                          e.preventDefault();
                          window.open(`/costs?tenderId=${tender.id}`, '_blank');
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
    </div>
  );
};

export default TenderSelection;
