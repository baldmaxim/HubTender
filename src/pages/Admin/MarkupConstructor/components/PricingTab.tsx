import React from 'react';
import { Typography, Space, Select, Button, Spin, Tag, Divider, Table } from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import type { Tender, PricingDistribution, DistributionTarget } from '../../../../lib/supabase';

const { Title, Text } = Typography;

/** Вкладка «Ценообразование»: распределение затрат между материалами и
 *  работами КП для выбранного тендера. */
export const PricingTab: React.FC<{
  tenders: Tender[];
  selectedTenderId: string | null;
  onTenderChange: (tenderId: string) => void;
  pricingDistribution: PricingDistribution | null;
  loadingPricing: boolean;
  savingPricing: boolean;
  onDistributionChange: (itemType: string, targetType: 'base' | 'markup', value: DistributionTarget) => void;
  onSave: () => void;
  onReset: () => void;
}> = ({
  tenders,
  selectedTenderId,
  onTenderChange,
  pricingDistribution,
  loadingPricing,
  savingPricing,
  onDistributionChange,
  onSave,
  onReset,
}) => (
  <div style={{ padding: '24px 0' }}>
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div>
        <Title level={4} style={{ marginBottom: 8 }}>
          Распределение затрат между материалами и работами (КП)
        </Title>
        <Text type="secondary">
          Настройте, как базовые затраты и наценки распределяются между материалами и работами (КП) для выбранного тендера
        </Text>
      </div>

      <Divider style={{ margin: '8px 0' }} />

      {/* Селектор тендера и версии */}
      <div style={{ marginBottom: 24 }}>
        <Space direction="horizontal" size="large" style={{ width: '100%', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>Выберите тендер:</Text>
            <Select
              showSearch
              placeholder="Выберите тендер для настройки"
              style={{ width: '100%', minWidth: '400px' }}
              value={selectedTenderId}
              onChange={onTenderChange}
              optionFilterProp="children"
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              optionRender={(option) => {
                const tender = tenders.find((t) => t.id === option.value);
                return `${option.label} (v${tender?.version || 1})`;
              }}
              options={tenders.map((tender) => ({
                value: tender.id,
                label: `${tender.tender_number} - ${tender.title}`,
              }))}
            />
          </div>
          {selectedTenderId && (
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>Версия:</Text>
              <Select
                placeholder="Версия тендера"
                style={{ width: '120px' }}
                value={tenders.find(t => t.id === selectedTenderId)?.version || 1}
                disabled
                options={[
                  {
                    value: tenders.find(t => t.id === selectedTenderId)?.version || 1,
                    label: `v${tenders.find(t => t.id === selectedTenderId)?.version || 1}`,
                  },
                ]}
              />
            </div>
          )}
        </Space>
      </div>

      {!selectedTenderId ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Text type="secondary">Выберите тендер для настройки распределения затрат</Text>
        </div>
      ) : (
        <Spin spinning={loadingPricing}>
          <Table
            dataSource={[
              {
                key: 'basic_material',
                type: 'Основные материалы',
                description: 'Материалы типа "мат"',
                tags: [{ label: 'мат', color: 'blue' }, { label: 'основн.', color: 'orange' }],
                baseTarget: pricingDistribution?.basic_material_base_target || 'material',
                markupTarget: pricingDistribution?.basic_material_markup_target || 'work',
              },
              {
                key: 'auxiliary_material',
                type: 'Вспомогательные материалы',
                description: 'Вспомогательные материалы',
                tags: [{ label: 'мат', color: 'blue' }, { label: 'вспом', color: 'blue' }],
                baseTarget: pricingDistribution?.auxiliary_material_base_target || 'work',
                markupTarget: pricingDistribution?.auxiliary_material_markup_target || 'work',
              },
              {
                key: 'subcontract_basic_material',
                type: 'Субподрядные материалы (основные)',
                description: 'Основные субподрядные материалы типа "суб-мат"',
                tags: [{ label: 'суб-мат', color: 'cyan' }, { label: 'основн.', color: 'orange' }],
                baseTarget: pricingDistribution?.subcontract_basic_material_base_target || 'material',
                markupTarget: pricingDistribution?.subcontract_basic_material_markup_target || 'work',
              },
              {
                key: 'subcontract_auxiliary_material',
                type: 'Субподрядные материалы (вспомогательные)',
                description: 'Вспомогательные субподрядные материалы типа "суб-мат"',
                tags: [{ label: 'суб-мат', color: 'cyan' }, { label: 'вспом', color: 'blue' }],
                baseTarget: pricingDistribution?.subcontract_auxiliary_material_base_target || 'work',
                markupTarget: pricingDistribution?.subcontract_auxiliary_material_markup_target || 'work',
              },
              {
                key: 'work',
                type: 'Работы',
                description: 'Работы типа "раб" и "суб-раб"',
                tags: [{ label: 'раб', color: 'orange' }, { label: 'суб-раб', color: 'purple' }],
                baseTarget: pricingDistribution?.work_base_target || 'work',
                markupTarget: pricingDistribution?.work_markup_target || 'work',
              },
              {
                key: 'component_material',
                type: 'Материалы компании',
                description: 'Компонентные материалы типа "мат-комп."',
                tags: [{ label: 'мат-комп.', color: 'cyan' }, { label: 'основн.', color: 'orange' }],
                baseTarget: pricingDistribution?.component_material_base_target || 'work',
                markupTarget: pricingDistribution?.component_material_markup_target || 'work',
              },
              {
                key: 'component_work',
                type: 'Работы компании',
                description: 'Компонентные работы типа "раб-комп."',
                tags: [{ label: 'раб-комп.', color: 'magenta' }],
                baseTarget: pricingDistribution?.component_work_base_target || 'work',
                markupTarget: pricingDistribution?.component_work_markup_target || 'work',
              },
            ]}
            columns={[
              {
                title: 'Тип элемента',
                dataIndex: 'type',
                width: 300,
                render: (text, record) => (
                  <Space direction="vertical" size={4}>
                    <Space size={8}>
                      <Text strong>{text}</Text>
                      {record.tags && record.tags.map((tag: { label: string; color: string }) => (
                        <Tag key={tag.label} color={tag.color} style={{ fontSize: '11px' }}>
                          {tag.label}
                        </Tag>
                      ))}
                    </Space>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      {record.description}
                    </Text>
                  </Space>
                ),
              },
              {
                title: 'Базовая стоимость',
                dataIndex: 'baseTarget',
                width: 200,
                render: (value: DistributionTarget, record) => (
                  <Select
                    value={value}
                    style={{ width: '100%' }}
                    onChange={(newValue: DistributionTarget) =>
                      onDistributionChange(record.key, 'base', newValue)
                    }
                    options={[
                      { label: 'Материалы КП', value: 'material' },
                      { label: 'Работы КП', value: 'work' },
                    ]}
                  />
                ),
              },
              {
                title: 'Наценка',
                dataIndex: 'markupTarget',
                width: 200,
                render: (value: DistributionTarget, record) => (
                  <Select
                    value={value}
                    style={{ width: '100%' }}
                    onChange={(newValue: DistributionTarget) =>
                      onDistributionChange(record.key, 'markup', newValue)
                    }
                    options={[
                      { label: 'Материалы КП', value: 'material' },
                      { label: 'Работы КП', value: 'work' },
                    ]}
                  />
                ),
              },
              {
                title: 'Результат',
                key: 'result',
                render: (_, record) => {
                  const baseLabel =
                    record.baseTarget === 'material' ? 'Материалы КП' : 'Работы КП';
                  const markupLabel =
                    record.markupTarget === 'material' ? 'Материалы КП' : 'Работы КП';

                  if (baseLabel === markupLabel) {
                    return (
                      <Tag color="blue">
                        Всё → {baseLabel}
                      </Tag>
                    );
                  }

                  return (
                    <Space direction="vertical" size={0}>
                      <Tag color="green">База → {baseLabel}</Tag>
                      <Tag color="orange">Наценка → {markupLabel}</Tag>
                    </Space>
                  );
                },
              },
            ]}
            pagination={false}
            size="small"
          />

          <Divider style={{ margin: '16px 0' }} />

          <Space>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={onSave}
              loading={savingPricing}
            >
              Сохранить настройки
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={onReset}
            >
              Сбросить к значениям по умолчанию
            </Button>
          </Space>
        </Spin>
      )}
    </Space>
  </div>
);
