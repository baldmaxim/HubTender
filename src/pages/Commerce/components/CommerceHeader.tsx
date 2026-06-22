/**
 * Заголовок страницы коммерции с элементами управления
 */

import { Button, Select, Space, Typography, Tooltip, Tag } from 'antd';
import {
  FileExcelOutlined,
  ArrowLeftOutlined,
  DollarOutlined
} from '@ant-design/icons';
import type { Tender } from '../../../lib/supabase';
import type { MarkupTactic, TenderOption } from '../types';
import { useIsMobile } from '../../../hooks/useIsMobile';

const { Title, Text } = Typography;

interface CommerceHeaderProps {
  tenders: Tender[];
  selectedTenderTitle: string | null;
  selectedVersion: number | null;
  selectedTacticId: string | undefined;
  markupTactics: MarkupTactic[];
  tacticChanged: boolean;
  loading: boolean;
  calculating: boolean;
  positionsCount: number;
  onBack: () => void;
  onTenderTitleChange: (title: string) => void;
  onVersionChange: (version: number) => void;
  onTacticChange: (tacticId: string) => void;
  onApplyTactic: () => void;
  onExport: () => void;
  shouldFilterArchived?: boolean;
}

export default function CommerceHeader({
  tenders,
  selectedTenderTitle,
  selectedVersion,
  selectedTacticId,
  markupTactics,
  tacticChanged,
  loading,
  calculating,
  positionsCount,
  onBack,
  onTenderTitleChange,
  onVersionChange,
  onTacticChange,
  onApplyTactic,
  onExport,
  shouldFilterArchived = false
}: CommerceHeaderProps) {
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
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Button
        icon={<ArrowLeftOutlined />}
        type="primary"
        onClick={onBack}
        style={{
          padding: '4px 15px',
          display: 'inline-flex',
          alignItems: 'center',
          width: 'fit-content',
          backgroundColor: '#10b981',
          borderColor: '#10b981'
        }}
      >
        Назад к выбору
      </Button>
      {!isPhoneDevice && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title level={4} style={{ margin: 0 }}>
            <DollarOutlined /> Коммерция
          </Title>
        </div>
      )}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: isPhone ? 'stretch' : 'center',
          flexWrap: 'wrap',
          gap: '16px',
          flexDirection: isPhone ? 'column' : 'row',
        }}
      >
        <Space
          size="middle"
          wrap
          direction={isPhone ? 'vertical' : 'horizontal'}
          style={isPhone ? { width: '100%' } : undefined}
        >
          <div style={isPhone ? { width: '100%' } : undefined}>
            {!isPhone && <Text type="secondary" style={{ fontSize: 16, marginRight: 8 }}>Тендер:</Text>}
            <Select
              style={{ width: isPhone ? '100%' : 350, fontSize: 16 }}
              placeholder="Выберите тендер"
              value={selectedTenderTitle}
              onChange={onTenderTitleChange}
              loading={loading}
              options={getTenderTitles()}
              showSearch
              optionFilterProp="children"
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              allowClear
            />
          </div>
          <div style={isPhone ? { width: '100%' } : undefined}>
            {!isPhone && <Text type="secondary" style={{ fontSize: 16, marginRight: 8 }}>Версия:</Text>}
            <Select
              style={{ width: isPhone ? '100%' : 140 }}
              placeholder="Версия"
              value={selectedVersion}
              onChange={onVersionChange}
              loading={loading}
              disabled={!selectedTenderTitle}
              options={selectedTenderTitle ? getVersionsForTitle(selectedTenderTitle) : []}
            />
          </div>
          {/* Схема наценок и применение тактики — действия пересчёта, скрыты на телефоне (read-only) */}
          {!isPhoneDevice && (
            <div>
              <Text type="secondary" style={{ fontSize: 16, marginRight: 8 }}>Схема:</Text>
              <Select
                style={{ width: 250 }}
                placeholder="Выберите тактику наценок"
                value={selectedTacticId}
                onChange={onTacticChange}
                loading={loading}
                disabled={!selectedTenderTitle}
                options={markupTactics.map(t => ({
                  label: (
                    <span>
                      {t.name || 'Без названия'}
                      {t.is_global && <Tag color="blue" style={{ marginLeft: 8 }}>Глобальная</Tag>}
                    </span>
                  ),
                  value: t.id
                }))}
              />
            </div>
          )}
        </Space>
        <div style={isPhone ? { width: '100%' } : undefined}>
          <Space style={isPhone ? { width: '100%' } : undefined}>
            {!isPhoneDevice && tacticChanged && (
              <Tooltip title="Применить новую тактику к тендеру">
                <Button
                  type="primary"
                  danger
                  onClick={onApplyTactic}
                  loading={calculating}
                >
                  Применить тактику
                </Button>
              </Tooltip>
            )}
            {!isPhoneDevice && (
              <Tooltip title="Экспорт в Excel">
                <Button
                  block={isPhone}
                  icon={<FileExcelOutlined />}
                  onClick={onExport}
                  disabled={positionsCount === 0}
                >
                  Экспорт
                </Button>
              </Tooltip>
            )}
          </Space>
        </div>
      </div>
    </Space>
  );
}
