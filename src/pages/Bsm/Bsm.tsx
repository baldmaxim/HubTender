import { useState } from 'react';
import { Card, Table, Select, Tabs, Input, message, Button, Typography, Space } from 'antd';
import { SearchOutlined, FileExcelOutlined, ArrowLeftOutlined, LinkOutlined } from '@ant-design/icons';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useTheme } from '../../contexts/ThemeContext';
import { LandscapeTableOverlay } from '../../components/responsive/LandscapeTableOverlay';
import { useBsmData } from './hooks/useBsmData';
import { buildBsmColumns } from './components/bsmColumns';
import { BsmTenderSelectionScreen } from './components/BsmTenderSelectionScreen';
import { BsmCardList } from './components/BsmCardList';
import { exportBsmToExcel } from './utils/bsmExport';
import { isMaterial } from './utils/bsmStyles';

const { Title, Text } = Typography;

const Bsm: React.FC = () => {
  const { isPhone, isLandscapePhone, isMobile, isPhoneDevice } = useIsMobile();
  const { theme: currentTheme } = useTheme();
  const readOnly = isMobile || isLandscapePhone;

  const [searchText, setSearchText] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'materials' | 'works'>('all');
  const [selectedExpense, setSelectedExpense] = useState<string | null>(null);

  const {
    tenders,
    allItems,
    loading,
    selectedTenderId,
    selectedTenderTitle,
    selectedVersion,
    setSelectedTenderId,
    setSelectedTenderTitle,
    setSelectedVersion,
    getTenderTitles,
    getVersionsForTitle,
    handleTenderTitleChange,
    handleVersionChange,
    fetchBoqItems,
    handleUpdateQuoteLink,
    handleApplyQuoteLinks,
  } = useBsmData();

  // Уникальные затраты для фильтра (сортируем, '—' в конец)
  const expenseOptions = (() => {
    const unique = new Set<string>();
    allItems.forEach(item => { if (item.expense_label) unique.add(item.expense_label); });
    return Array.from(unique)
      .sort((a, b) => {
        if (a === '—') return 1;
        if (b === '—') return -1;
        return a.localeCompare(b, 'ru');
      })
      .map(label => ({ value: label, label }));
  })();

  const getFilteredItems = (filterType: 'all' | 'materials' | 'works') => {
    let filtered = allItems;
    if (filterType === 'materials') {
      filtered = filtered.filter(item => isMaterial(item.boq_item_type));
    } else if (filterType === 'works') {
      filtered = filtered.filter(item => !isMaterial(item.boq_item_type));
    }
    if (selectedExpense) {
      filtered = filtered.filter(item => item.expense_label === selectedExpense);
    }
    if (searchText) {
      filtered = filtered.filter(item => item.name.toLowerCase().includes(searchText.toLowerCase()));
    }
    return filtered;
  };

  const filteredItems = getFilteredItems(activeTab);
  const columns = buildBsmColumns(handleUpdateQuoteLink, readOnly);

  const handleExportToExcel = () => {
    const ok = exportBsmToExcel(filteredItems, selectedTenderTitle);
    if (ok) {
      message.success('Данные успешно экспортированы');
    } else {
      message.warning('Нет данных для экспорта');
    }
  };

  const tabItems = [
    { key: 'all', label: `Общее (${allItems.length})` },
    { key: 'materials', label: `Материалы (${allItems.filter(item => isMaterial(item.boq_item_type)).length})` },
    { key: 'works', label: `Работы (${allItems.filter(item => !isMaterial(item.boq_item_type)).length})` },
  ];

  // Экран выбора тендера
  if (!selectedTenderId) {
    return (
      <BsmTenderSelectionScreen
        tenders={tenders}
        selectedTenderTitle={selectedTenderTitle}
        selectedVersion={selectedVersion}
        getTenderTitles={getTenderTitles}
        getVersionsForTitle={getVersionsForTitle}
        onTenderTitleChange={handleTenderTitleChange}
        onVersionChange={handleVersionChange}
        onTenderSelect={(tender) => {
          setSelectedTenderTitle(tender.title);
          setSelectedVersion(tender.version || 1);
          setSelectedTenderId(tender.id);
          fetchBoqItems(tender.id);
        }}
      />
    );
  }

  const renderTable = (fitToScreen: boolean) => (
    <Table
      bordered
      dataSource={filteredItems}
      columns={columns}
      rowKey="id"
      loading={loading}
      pagination={false}
      scroll={fitToScreen ? undefined : { x: 'max-content', y: 'calc(100dvh - 450px)' }}
      size="middle"
    />
  );

  // Поиск/фильтр: на телефоне над вкладками full-width, на десктопе — в tabBarExtraContent
  const filterControls = (phone: boolean) => (
    <Space direction={phone ? 'vertical' : 'horizontal'} style={phone ? { width: '100%' } : undefined}>
      {!isPhoneDevice && (
        <Button icon={<LinkOutlined />} onClick={handleApplyQuoteLinks} disabled={!selectedTenderId} type="default">
          Проставить ссылки
        </Button>
      )}
      <Button icon={<FileExcelOutlined />} onClick={handleExportToExcel} disabled={!selectedTenderId} block={phone}>
        Экспорт в Excel
      </Button>
      <Select
        placeholder="Фильтр по затрате..."
        style={{ width: phone ? '100%' : 280 }}
        value={selectedExpense}
        onChange={(val) => setSelectedExpense(val)}
        allowClear
        showSearch
        optionFilterProp="label"
        filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
        options={expenseOptions}
      />
      <Input
        placeholder="Поиск по наименованию..."
        prefix={<SearchOutlined />}
        style={{ width: phone ? '100%' : 250 }}
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        allowClear
      />
    </Space>
  );

  const headerNode = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Button
        icon={<ArrowLeftOutlined />}
        type="primary"
        onClick={() => {
          setSelectedTenderId(null);
          setSelectedTenderTitle(null);
          setSelectedVersion(null);
        }}
        style={{ padding: '4px 15px', display: 'inline-flex', alignItems: 'center', width: 'fit-content', backgroundColor: '#10b981', borderColor: '#10b981' }}
      >
        Назад к выбору
      </Button>
      {!isPhoneDevice && (
        <Title level={4} style={{ margin: 0 }}>Базовая Стоимость Материалов и Работ</Title>
      )}
      <Space size="middle" wrap direction={isPhone ? 'vertical' : 'horizontal'} style={isPhone ? { width: '100%' } : undefined}>
        <Space size="small" style={isPhone ? { width: '100%' } : undefined}>
          {!isPhone && <Text type="secondary" style={{ fontSize: 16 }}>Тендер:</Text>}
          <Select
            className="tender-select"
            placeholder="Выберите тендер"
            style={{ width: isPhone ? '100%' : 350, fontSize: 16 }}
            value={selectedTenderTitle}
            onChange={handleTenderTitleChange}
            showSearch
            optionFilterProp="children"
            filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            options={getTenderTitles()}
            allowClear
          />
        </Space>
        <Space size="small" style={isPhone ? { width: '100%' } : undefined}>
          {!isPhone && <Text type="secondary" style={{ fontSize: 16 }}>Версия:</Text>}
          <Select
            placeholder="Версия"
            value={selectedVersion}
            onChange={handleVersionChange}
            disabled={!selectedTenderTitle}
            options={selectedTenderTitle ? getVersionsForTitle(selectedTenderTitle) : []}
            style={{ width: isPhone ? '100%' : 140 }}
          />
        </Space>
      </Space>
    </Space>
  );

  return (
    <Card bordered={false} style={{ height: '100%' }} styles={{ header: { borderBottom: 'none', paddingBottom: 0 } }} title={headerNode}>
      {/* Тулбар над вкладками на телефоне */}
      {isPhoneDevice && <div style={{ marginBottom: 12 }}>{filterControls(true)}</div>}

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as 'all' | 'materials' | 'works')}
        items={tabItems}
        style={{ marginBottom: 16 }}
        tabBarExtraContent={isPhoneDevice ? undefined : filterControls(false)}
      />

      {isPhone ? (
        <BsmCardList items={filteredItems} loading={loading} />
      ) : isLandscapePhone ? (
        <LandscapeTableOverlay theme={currentTheme} width={1875}>
          {renderTable(true)}
        </LandscapeTableOverlay>
      ) : (
        renderTable(false)
      )}
    </Card>
  );
};

export default Bsm;
