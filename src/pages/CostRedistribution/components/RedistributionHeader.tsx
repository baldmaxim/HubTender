/**
 * Заголовок страницы перераспределения с фильтрами
 */

import React from 'react';
import { Card, Row, Col, Select, Typography, Space, Statistic, Button, Tag } from 'antd';
import { DownloadOutlined, LoadingOutlined } from '@ant-design/icons';
import type { Tender } from '../../../lib/supabase';
import type { MarkupTactic } from '../hooks';
import { AnimatedNumber, SuccessCheck } from '../../../components/transitions';
import { useIsMobile } from '../../../hooks/useIsMobile';

const { Title } = Typography;

// Один модульный Intl.NumberFormat для всех Statistic в шапке —
// раньше на каждый ре-рендер создавалась новая regex-замена inline.
const RU_INTEGER_FORMAT = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 0,
});
const formatRuInteger = (value: number | string) =>
  RU_INTEGER_FORMAT.format(Math.round(Number(value)));

interface RedistributionHeaderProps {
  tenders: Tender[];
  selectedTenderId: string | undefined;
  onTenderChange: (tenderId: string) => void;
  markupTactics: MarkupTactic[];
  selectedTacticId: string | undefined;
  onTacticChange: (tacticId: string) => void;
  loading?: boolean;
  totals?: {
    totalMaterials: number;
    totalWorks: number;
    total: number;
  };
  insuranceTotal?: number;
  hasResults?: boolean;
  onExport?: () => void;
  saving?: boolean;
  savedRecently?: boolean;
}

export const RedistributionHeader: React.FC<RedistributionHeaderProps> = ({
  tenders,
  selectedTenderId,
  onTenderChange,
  markupTactics,
  selectedTacticId,
  onTacticChange,
  loading = false,
  totals,
  insuranceTotal = 0,
  hasResults = false,
  onExport,
  saving = false,
  savedRecently = false,
}) => {
  const { isPhone, isPhoneDevice } = useIsMobile();

  // Компактный блок «подпись над числом» с подписью в одну строку — для телефона и десктопа.
  const renderStat = (title: string, value: number, color?: string) => (
    <div style={{ padding: isPhone ? '0 4px' : '0 12px', textAlign: 'center' }}>
      <Statistic
        title={<span style={{ whiteSpace: 'nowrap', fontSize: isPhone ? 11 : undefined }}>{title}</span>}
        value={value}
        precision={0}
        formatter={(v) => <AnimatedNumber value={formatRuInteger(v as number | string)} />}
        valueStyle={{ fontSize: isPhone ? 16 : 18, ...(color ? { color, fontWeight: 600 } : {}) }}
      />
    </div>
  );

  return (
    <Card
      style={{ marginBottom: isPhone ? 8 : 16 }}
      styles={{ body: { padding: isPhone ? '6px 12px' : 24 } }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={isPhone ? 8 : 'middle'}>
        {/* Пустую верхнюю строку на телефоне не рендерим — иначе зазор над фильтром. */}
        {(!isPhoneDevice || saving || savedRecently) && (
          <Space align="center" size="middle">
            {!isPhoneDevice && (
              <Title level={2} style={{ margin: 0 }}>
                Перераспределение стоимости работ
              </Title>
            )}
            {saving && (
              <Tag icon={<LoadingOutlined />} color="processing">
                Сохраняется…
              </Tag>
            )}
            {!saving && savedRecently && (
              <Space align="center" size={4}>
                <SuccessCheck show size={18} color="#10b981" strokeWidth={5} />
                <Tag color="success">Сохранено</Tag>
              </Space>
            )}
          </Space>
        )}

        <Row gutter={16} align="middle">
          <Col xs={24} sm={12} lg={4}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
              Тендер:
            </label>
            <Select
              style={{ width: '100%' }}
              placeholder="Выберите тендер"
              value={selectedTenderId}
              onChange={onTenderChange}
              loading={loading}
              showSearch
              optionFilterProp="children"
            >
              {tenders.map((tender) => (
                <Select.Option key={tender.id} value={tender.id}>
                  {tender.title} (v{tender.version})
                </Select.Option>
              ))}
            </Select>
          </Col>

          <Col xs={24} sm={12} lg={4}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
              Схема наценок:
            </label>
            <Select
              style={{ width: '100%' }}
              placeholder="Выберите схему наценок"
              value={selectedTacticId}
              onChange={onTacticChange}
              disabled={!selectedTenderId}
              loading={loading}
              showSearch
              optionFilterProp="children"
            >
              {markupTactics.map((tactic) => (
                <Select.Option key={tactic.id} value={tactic.id}>
                  {tactic.name}
                  {tactic.is_global && ' (глобальная)'}
                </Select.Option>
              ))}
            </Select>
          </Col>

          {totals && (
            <Col
              xs={24}
              lg={16}
              style={
                isPhone
                  ? { display: 'flex', flexDirection: 'column', gap: 8 }
                  : {
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'flex-end',
                      gap: 24,
                      alignItems: 'center',
                    }
              }
            >
              {isPhone ? (
                <>
                  {/* Телефон: 4 итога в 2 строки, подпись над числом, без «включено в работы и итог». */}
                  <div style={{ display: 'flex', justifyContent: 'space-around', gap: 8 }}>
                    {renderStat('Итого материалы', totals.totalMaterials)}
                    {renderStat('Итого работы', totals.totalWorks)}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-around', gap: 8 }}>
                    {renderStat('Итого', totals.total, '#10b981')}
                    {insuranceTotal > 0 &&
                      renderStat('Страхование от судимостей', insuranceTotal, '#10b981')}
                  </div>
                </>
              ) : (
                <>
                  {renderStat('Итого материалы', totals.totalMaterials)}
                  {renderStat('Итого работы', totals.totalWorks)}
                  {renderStat('Итого', totals.total, '#10b981')}
                  {insuranceTotal > 0 && (
                    <div style={{ padding: '0 12px', textAlign: 'center', borderLeft: '2px solid #10b981' }}>
                      <Statistic
                        title="Страхование от судимостей"
                        value={insuranceTotal}
                        precision={0}
                        formatter={(value) => <AnimatedNumber value={formatRuInteger(value as number | string)} />}
                        valueStyle={{ color: '#10b981', fontWeight: 600, fontSize: 18 }}
                      />
                    </div>
                  )}
                  {hasResults && onExport && !isPhoneDevice && (
                    <Button
                      type="primary"
                      icon={<DownloadOutlined />}
                      onClick={onExport}
                      size="large"
                      style={{ marginLeft: 12 }}
                    >
                      Экспорт в Excel
                    </Button>
                  )}
                </>
              )}
            </Col>
          )}
        </Row>
      </Space>
    </Card>
  );
};
