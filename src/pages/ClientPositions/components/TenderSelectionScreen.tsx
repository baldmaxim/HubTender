import React from 'react';
import { Card, Select, Row, Col, Typography } from 'antd';
import type { Tender } from '../../../lib/types';
import { TenderTileCard } from '../../../components/TenderTileCard';
import { useIsMobile } from '../../../hooks/useIsMobile';

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
  const { isPhone, isPhoneDevice } = useIsMobile();
  return (
    <Card bordered={false} style={{ height: '100%' }}>
      <div style={{ textAlign: 'center', padding: isPhone ? '24px 12px' : '40px 20px' }}>
        {/* На телефоне заголовок уже есть в шапке (pageTitle) — здесь не дублируем. */}
        {!isPhoneDevice && (
          <Title level={3} style={{ marginBottom: 24 }}>
            Позиции заказчика
          </Title>
        )}
        <Text type="secondary" style={{ fontSize: 16, marginBottom: 24, display: 'block' }}>
          Выберите тендер для просмотра позиций
        </Text>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          justifyContent: 'center',
          maxWidth: 616,
          margin: '0 auto 32px',
        }}>
          <Select
            className="tender-select"
            style={{ flex: '1 1 280px', maxWidth: 400, width: '100%' }}
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
              style={{ flex: '1 1 160px', maxWidth: 200, width: '100%' }}
              placeholder="Выберите версию"
              value={selectedVersion}
              onChange={onVersionChange}
              options={versions}
              size="large"
            />
          )}
        </div>

        {tenders.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
              Или выберите из списка:
            </Text>
            <Row gutter={isPhoneDevice ? [8, 8] : [16, 16]} justify="center">
              {tenders.filter(t => !t.is_archived).slice(0, 6).map(tender => (
                <Col key={tender.id}>
                  <TenderTileCard
                    tender={tender}
                    allTenders={tenders}
                    onClick={() => onTenderCardClick(tender)}
                    deepLinkUrl={`/positions?tenderId=${tender.id}`}
                  />
                </Col>
              ))}
            </Row>
          </div>
        )}
      </div>
    </Card>
  );
};
