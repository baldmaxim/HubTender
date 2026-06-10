import { Select, Button, Space, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useIsMobile } from '../../../hooks/useIsMobile';

const { Text } = Typography;
import type { Tender } from '../../../lib/supabase';

interface IndicatorsFiltersProps {
  tenders: Tender[];
  selectedTenderTitle: string;
  selectedVersion: number | null;
  loading: boolean;
  onTenderTitleChange: (title: string) => void;
  onVersionChange: (version: number) => void;
  onRefresh: () => void;
  /** Только просмотр — скрывает кнопку «Обновить» (Генеральный директор) */
  readOnly?: boolean;
}

export const IndicatorsFilters: React.FC<IndicatorsFiltersProps> = ({
  tenders,
  selectedTenderTitle,
  selectedVersion,
  loading,
  onTenderTitleChange,
  onVersionChange,
  onRefresh,
  readOnly,
}) => {
  const { isPhone } = useIsMobile();

  const getTenderTitles = () => {
    const uniqueTitles = new Map<string, { value: string; label: string }>();
    tenders.forEach(tender => {
      if (!uniqueTitles.has(tender.title)) {
        uniqueTitles.set(tender.title, {
          value: tender.title,
          label: tender.title,
        });
      }
    });
    return Array.from(uniqueTitles.values());
  };

  const getVersionsForTitle = (title: string) => {
    return tenders
      .filter(t => t.title === title)
      .map(t => ({
        value: t.version || 1,
        label: `Версия ${t.version || 1}`,
      }));
  };

  return (
    <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <Space size="small" style={{ width: isPhone ? '100%' : undefined }}>
        <Text type="secondary">Тендер:</Text>
        <Select
          style={{ width: isPhone ? '100%' : 300 }}
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
        />
      </Space>
      {selectedTenderTitle && (
        <Space size="small">
          <Text type="secondary">Версия:</Text>
          <Select
            style={{ width: isPhone ? 140 : 150 }}
            placeholder="Выберите версию"
            value={selectedVersion}
            onChange={onVersionChange}
            options={getVersionsForTitle(selectedTenderTitle)}
          />
        </Space>
      )}
      {!readOnly && (
        <Button icon={<ReloadOutlined />} onClick={onRefresh}>
          Обновить
        </Button>
      )}
    </div>
  );
};
