import React from 'react';
import { Card, Typography, Select, Row, Col } from 'antd';
import type { Tender } from '../../../lib/types';
import { TenderTileCard } from '../../../components/TenderTileCard';
import { useIsMobile } from '../../../hooks/useIsMobile';

const { Title, Text } = Typography;

interface ITenderPickerProps {
  tenders: Tender[];
  selectedTenderTitle: string | null;
  selectedVersion: number | null;
  titleOptions: { value: string; label: string }[];
  versionOptions: { value: number; label: string }[];
  onTitleChange: (title: string) => void;
  onVersionChange: (version: number) => void;
  onPickTender: (tender: Tender) => void;
}

/** Экран выбора тендера (пока тендер не выбран): селекты наименования/версии и плитки. */
export const TenderPicker: React.FC<ITenderPickerProps> = ({
  tenders,
  selectedTenderTitle,
  selectedVersion,
  titleOptions,
  versionOptions,
  onTitleChange,
  onVersionChange,
  onPickTender,
}) => {
  const { isPhone, isPhoneDevice } = useIsMobile();

  return (
    <Card bordered={false} style={{ height: '100%' }}>
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        {/* На телефоне заголовок уже есть в шапке (pageTitle) — здесь не дублируем. */}
        {!isPhoneDevice && (
          <Title level={4} style={{ marginBottom: 24 }}>
            Проценты наценок
          </Title>
        )}
        <Text type="secondary" style={{ fontSize: 16, marginBottom: 24, display: 'block' }}>
          Выберите тендер для корректирования процентов
        </Text>
        <Select
          className="tender-select"
          style={{ width: isPhone ? '100%' : 400, maxWidth: '100%', marginBottom: 32 }}
          placeholder="Выберите тендер"
          value={selectedTenderTitle}
          onChange={onTitleChange}
          showSearch
          optionFilterProp="children"
          filterOption={(input, option) =>
            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
          options={titleOptions}
          size="large"
        />

        {selectedTenderTitle && (
          <Select
            style={{ width: isPhone ? '100%' : 200, maxWidth: '100%', marginBottom: 32, marginLeft: isPhone ? 0 : 16 }}
            placeholder="Выберите версию"
            value={selectedVersion}
            onChange={onVersionChange}
            options={versionOptions}
            size="large"
          />
        )}

        {/* Быстрый выбор через карточки */}
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
                    onClick={() => onPickTender(tender)}
                    deepLinkUrl={`/admin/markup?tenderId=${tender.id}`}
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
