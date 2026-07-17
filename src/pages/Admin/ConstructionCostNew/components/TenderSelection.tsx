/**
 * Компонент выбора тендера для просмотра затрат
 */

import React from 'react';
import { Card, Select, Typography, Row, Col } from 'antd';
import type { Tender } from '../../../../lib/types';
import type { TenderOption } from '../hooks/useCostData';
import { TenderTileCard } from '../../../../components/TenderTileCard';
import { useIsMobile } from '../../../../hooks/useIsMobile';

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
  const { isPhone, isPhoneDevice } = useIsMobile();
  return (
    <div style={{ margin: '-16px', padding: '24px' }}>
      <Card bordered={false} style={{ height: '100%' }}>
        <div style={{ textAlign: 'center', padding: isPhone ? '24px 8px' : '40px 20px' }}>
          {/* На телефоне заголовок уже есть в шапке (pageTitle) — здесь не дублируем. */}
          {!isPhoneDevice && (
            <Title level={4} style={{ marginBottom: 24 }}>
              Затраты на строительство
            </Title>
          )}
          <Text type="secondary" style={{ fontSize: 16, marginBottom: 24, display: 'block' }}>
            Выберите тендер для просмотра затрат
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
              style={{ width: isPhone ? '100%' : 200, marginBottom: 32, marginLeft: isPhone ? 0 : 16 }}
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
                {tenders.filter(t => !t.is_archived).slice(0, 6).map((tender) => (
                  <Col key={tender.id}>
                    <TenderTileCard
                      tender={tender}
                      allTenders={tenders}
                      onClick={() => onTenderSelect(tender.id, tender.title, tender.version || 1)}
                      deepLinkUrl={`/costs?tenderId=${tender.id}`}
                    />
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
