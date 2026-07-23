import { useState, useEffect, useCallback } from 'react';
import { Typography, Spin, Card, Tabs, Select, Button, Row, Col, Tag, Input, Drawer, Space, Popconfirm, message, Alert } from 'antd';
import { formatFXUnavailable } from '../../utils/boq/currencyGuard';
import { BarChartOutlined, TableOutlined, EditOutlined, CheckOutlined, CloseOutlined, FullscreenOutlined, ZoomInOutlined, ZoomOutOutlined, FallOutlined } from '@ant-design/icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { getTenderById, approveFinancial } from '../../lib/api/fi';
import { adminPatchTender } from '../../lib/api/tenders';
import { getErrorMessage } from '../../utils/errors';
import { useRealtimeTopic } from '../../lib/realtime/useRealtimeTopic';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title as ChartTitle,
  Tooltip as ChartTooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { useIsMobile } from '../../hooks/useIsMobile';
import { TenderTileCard } from '../../components/TenderTileCard';
import { useFinancialData } from './hooks/useFinancialData';
import { IndicatorsCharts } from './components/IndicatorsCharts';
import { IndicatorsTable, INDICATORS_TABLE_FIT_WIDTH } from './components/IndicatorsTable';
import { IndicatorsFilters } from './components/IndicatorsFilters';
import { DiscountTab } from './discount/components/DiscountTab';
import { DiscountSummaryCard } from './discount/components/DiscountSummaryCard';
import { LandscapeTableOverlay } from '../../components/responsive/LandscapeTableOverlay';
import './FinancialIndicators.css';


ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ChartTitle,
  ChartTooltip,
  Legend,
  ArcElement,
  ChartDataLabels
);

const { Title, Text } = Typography;

const FinancialIndicators: React.FC = () => {
  const { theme: currentTheme } = useTheme();
  const { user } = useAuth();
  const { isPhone, isLandscapePhone, isPhoneDevice, isMobile, screens } = useIsMobile();
  // Генеральный директор и телефоны (в любой ориентации) — только просмотр (без обновления и редактирования)
  const readOnly = user?.role_code === 'general_director' || isMobile || isLandscapePhone;
  // Кнопка/зум на весь экран нужны там, где широкая таблица может не помещаться,
  // но это не телефон (на телефоне — карточный вид или зум inline): настоящие планшеты, узкие ноуты.
  const showFullscreenTable = !isPhoneDevice && !screens.lg;
  const {
    tenders,
    loading,
    data,
    tableData,
    spTotal,
    customerTotal,
    isVatInConstructor,
    vatCoefficient,
    fxMissing,
    loadTenders,
    fetchFinancialIndicators,
    discountContext,
    discountSettings,
    getDiscountWorkspace,
  } = useFinancialData();

  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [selectedTenderTitle, setSelectedTenderTitle] = useState<string>('');
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'table' | 'charts' | 'discount'>('charts');
  const [editingVolumeTitle, setEditingVolumeTitle] = useState(false);
  const [volumeTitle, setVolumeTitle] = useState('Полный объём строительства');
  const [tempVolumeTitle, setTempVolumeTitle] = useState('Полный объём строительства');
  const [tableFullscreen, setTableFullscreen] = useState(false);
  const [tableScale, setTableScale] = useState(1);
  // Статус согласования «Финансовых показателей» текущей версии тендера.
  const [financialApproved, setFinancialApproved] = useState(false);
  const isGeneralDirector = user?.role_code === 'general_director';

  const loadVolumeTitle = useCallback(async (tenderId: string) => {
    try {
      const data = await getTenderById(tenderId);
      const title = (data as { volume_title?: string | null })?.volume_title || 'Полный объём строительства';
      setVolumeTitle(title);
      setTempVolumeTitle(title);
      setFinancialApproved(Boolean((data as { financial_approved?: boolean })?.financial_approved));
    } catch (error) {
      console.error('Ошибка загрузки заголовка:', error);
    }
  }, []);

  useEffect(() => {
    loadTenders();
  }, [loadTenders]);

  useEffect(() => {
    if (selectedTenderId) {
      fetchFinancialIndicators(selectedTenderId);
      loadVolumeTitle(selectedTenderId);
    }
  }, [selectedTenderId, fetchFinancialIndicators, loadVolumeTitle]);

  // Native WS hub (Go BFF) — refetch on tender row change.
  useRealtimeTopic(
    selectedTenderId ? `tender:${selectedTenderId}` : null,
    () => {
      if (selectedTenderId) {
        fetchFinancialIndicators(selectedTenderId);
        loadVolumeTitle(selectedTenderId);
      }
    },
  );

  const handleUpdateVolumeTitle = async () => {
    if (!selectedTenderId) return;

    try {
      await adminPatchTender(selectedTenderId, { volume_title: tempVolumeTitle });
      setVolumeTitle(tempVolumeTitle);
      setEditingVolumeTitle(false);
      message.success('Заголовок обновлен');
    } catch (error) {
      message.error('Ошибка обновления заголовка: ' + getErrorMessage(error));
    }
  };

  const handleCancelVolumeTitle = () => {
    setTempVolumeTitle(volumeTitle);
    setEditingVolumeTitle(false);
  };

  const handleApprove = async () => {
    if (!selectedTenderId) return;
    try {
      await approveFinancial(selectedTenderId);
      setFinancialApproved(true);
      message.success('Согласовано');
    } catch (error) {
      message.error('Ошибка согласования: ' + getErrorMessage(error));
    }
  };

  const formatNumber = (value: number | undefined) => {
    if (value === undefined) return '';
    return value.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

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

  const handleTenderTitleChange = (title: string) => {
    setSelectedTenderTitle(title);
    // Автоматически выбираем последнюю версию нового тендера
    const versionsOfTitle = tenders
      .filter(t => t.title === title)
      .sort((a, b) => (b.version || 1) - (a.version || 1));
    if (versionsOfTitle.length > 0) {
      const latest = versionsOfTitle[0];
      setSelectedVersion(latest.version || 1);
      setSelectedTenderId(latest.id);
    } else {
      setSelectedVersion(null);
      setSelectedTenderId(null);
    }
  };

  const handleVersionChange = (version: number) => {
    setSelectedVersion(version);
    const tender = tenders.find(t => t.title === selectedTenderTitle && t.version === version);
    if (tender) {
      setSelectedTenderId(tender.id);
    }
  };

  if (!selectedTenderId) {
    return (
      <div className="financial-indicators-page">
        <Card bordered={false} style={{ height: '100%' }}>
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            {/* На телефоне заголовок уже есть в шапке (pageTitle) — здесь не дублируем. */}
            {!isPhoneDevice && (
              <Title level={4} style={{ marginBottom: 24 }}>
                Финансовые показатели
              </Title>
            )}
            <Text type="secondary" style={{ fontSize: 16, marginBottom: 24, display: 'block' }}>
              Выберите тендер для просмотра показателей
            </Text>
            <Select
              className="tender-select"
              style={{ width: isPhone ? '100%' : 400, maxWidth: '100%', marginBottom: 32 }}
              placeholder="Выберите тендер"
              value={selectedTenderTitle}
              onChange={handleTenderTitleChange}
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
                style={{ width: isPhone ? '100%' : 200, maxWidth: '100%', marginBottom: 32, marginLeft: isPhone ? 0 : 16 }}
                placeholder="Выберите версию"
                value={selectedVersion}
                onChange={handleVersionChange}
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
                  {tenders.filter(t => !t.is_archived).slice(0, 6).map(tender => (
                    <Col key={tender.id}>
                      <TenderTileCard
                        tender={tender}
                        allTenders={tenders}
                        desktopBodyPadding="12px 16px"
                        onClick={() => {
                          setSelectedTenderTitle(tender.title);
                          setSelectedVersion(tender.version || 1);
                          setSelectedTenderId(tender.id);
                        }}
                        deepLinkUrl={`/financial-indicators?tenderId=${tender.id}`}
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
  }

  // Экспорт выгружает уже сниженные строки — без этой пометки в файле нельзя
  // отличить снижённый расчёт от обычного.
  const discountNote = discountContext
    ? `Применено снижение: ${formatNumber(discountContext.appliedAmount)} руб. ` +
      `(до снижения: ${formatNumber(discountContext.baseGrandTotal)} руб.)`
    : null;

  const indicatorsTableNode = (
    <IndicatorsTable
      data={tableData}
      spTotal={spTotal}
      customerTotal={customerTotal}
      formatNumber={formatNumber}
      currentTheme={currentTheme}
      tenderTitle={selectedTenderTitle}
      tenderVersion={selectedVersion || 1}
      tenderId={selectedTenderId}
      isPhone={isPhone}
      isPhoneDevice={isPhoneDevice}
      onAreaUpdated={() => fetchFinancialIndicators(selectedTenderId)}
      readOnly={readOnly}
      fxMissing={fxMissing}
      discountNote={discountNote}
      volumeTitle={volumeTitle}
    />
  );

  // Тот же узел, но без внутреннего горизонтального скролла — для авто-фуллскрин-оверлея
  // в ландшафте (масштаб подбирает LandscapeTableOverlay, чтобы всё влезло без прокрутки).
  const indicatorsTableFitNode = (
    <IndicatorsTable
      data={tableData}
      spTotal={spTotal}
      customerTotal={customerTotal}
      formatNumber={formatNumber}
      currentTheme={currentTheme}
      tenderTitle={selectedTenderTitle}
      tenderVersion={selectedVersion || 1}
      tenderId={selectedTenderId}
      isPhone={isPhone}
      isPhoneDevice={isPhoneDevice}
      onAreaUpdated={() => fetchFinancialIndicators(selectedTenderId)}
      readOnly={readOnly}
      fxMissing={fxMissing}
      discountNote={discountNote}
      volumeTitle={volumeTitle}
      fitToScreen
    />
  );

  return (
    <div className="financial-indicators-page">
      <IndicatorsFilters
        tenders={tenders}
        selectedTenderTitle={selectedTenderTitle}
        selectedVersion={selectedVersion}
        loading={loading}
        onTenderTitleChange={handleTenderTitleChange}
        onVersionChange={handleVersionChange}
      />

      {fxMissing.length > 0 && (
        <Alert type="error" showIcon message={formatFXUnavailable(fxMissing)} style={{ marginBottom: 12 }} />
      )}

      <Card bordered={false}>
        <div style={{ marginBottom: 24 }}>
          {editingVolumeTitle ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <Input
                value={tempVolumeTitle}
                onChange={(e) => setTempVolumeTitle(e.target.value)}
                style={{ width: isPhone ? '100%' : 400, maxWidth: '100%', fontSize: isPhone ? 18 : 24, fontWeight: 600, color: '#ff4d4f', textAlign: 'center' }}
                size="large"
              />
              <CheckOutlined
                style={{ fontSize: 20, color: '#52c41a', cursor: 'pointer' }}
                onClick={handleUpdateVolumeTitle}
              />
              <CloseOutlined
                style={{ fontSize: 20, color: '#ff4d4f', cursor: 'pointer' }}
                onClick={handleCancelVolumeTitle}
              />
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Title level={3} style={{ margin: 0, textAlign: 'center', color: '#ff4d4f', fontSize: isPhone ? 18 : undefined }}>
                {volumeTitle}
              </Title>
              {!readOnly && (
                <EditOutlined
                  style={{ fontSize: 16, cursor: 'pointer', color: '#1890ff' }}
                  onClick={() => setEditingVolumeTitle(true)}
                />
              )}
            </div>
          )}
          {/* Статус согласования + кнопка (только Генеральный директор). Адаптив:
              на телефоне тег и кнопка переносятся, кнопка — во всю ширину. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexWrap: 'wrap',
              gap: isPhone ? 6 : 8,
              marginTop: 12,
              maxWidth: '100%',
            }}
          >
            <Tag
              color={financialApproved ? 'green' : 'red'}
              style={{ margin: 0, fontSize: isPhone ? 12 : 14, padding: isPhone ? '2px 10px' : '4px 14px' }}
            >
              {financialApproved ? 'Согласовано' : 'Не согласовано'}
            </Tag>
            {isGeneralDirector && !financialApproved && (
              <Popconfirm
                title="Согласовать финансовые показатели?"
                description="Действие необратимо — изменить статус обратно нельзя."
                okText="Согласовать"
                cancelText="Отмена"
                onConfirm={handleApprove}
              >
                <Button
                  type="primary"
                  icon={<CheckOutlined />}
                  size={isPhone ? 'middle' : 'large'}
                  block={isPhone}
                  style={{ backgroundColor: '#10b981', borderColor: '#10b981' }}
                >
                  Согласовать
                </Button>
              </Popconfirm>
            )}
          </div>
        </div>

        {/* Сводка снижения — только когда оно включено и применено. При
            выключенном тумблере страница выглядит ровно как раньше. */}
        {discountContext && (
          <DiscountSummaryCard discount={discountContext} isPhone={isPhone} />
        )}

        <Spin spinning={loading}>
          <Tabs
            activeKey={activeTab}
            onChange={(key) => {
              setActiveTab(key as 'table' | 'charts' | 'discount');
            }}
            items={[
              {
                key: 'charts',
                label: (
                  <span>
                    <BarChartOutlined style={{ marginRight: 8 }} />
                    Графики
                  </span>
                ),
                children: (
                  <IndicatorsCharts
                    data={data}
                    spTotal={spTotal}
                    formatNumber={formatNumber}
                    selectedTenderId={selectedTenderId}
                    isVatInConstructor={isVatInConstructor}
                    vatCoefficient={vatCoefficient}
                    itemScale={discountContext?.itemScale ?? null}
                  />
                ),
              },
              {
                key: 'table',
                label: (
                  <span>
                    <TableOutlined style={{ marginRight: 8 }} />
                    Таблица
                  </span>
                ),
                children: (
                  <>
                    {showFullscreenTable && (
                      <div style={{ marginBottom: 8, textAlign: 'right' }}>
                        <Button icon={<FullscreenOutlined />} onClick={() => setTableFullscreen(true)}>
                          На весь экран
                        </Button>
                      </div>
                    )}
                    {/* Телефон в landscape: таблица раскрывается на весь экран
                        (fixed-оверлей); колонки вписываются по ширине, строки
                        прокручиваются вертикально. Поворот в портрет → карточный вид. */}
                    {isLandscapePhone ? (
                      <LandscapeTableOverlay theme={currentTheme} fit="zoom" width={INDICATORS_TABLE_FIT_WIDTH}>
                        {indicatorsTableFitNode}
                      </LandscapeTableOverlay>
                    ) : (
                      indicatorsTableNode
                    )}
                  </>
                ),
              },
              // Настройка снижения — только для тех, кто может редактировать
              // (ГД и телефоны страницу лишь просматривают). Данные вкладки
              // грузятся лениво, при первом её открытии.
              ...(readOnly || !selectedTenderId
                ? []
                : [{
                    key: 'discount',
                    label: (
                      <span>
                        <FallOutlined style={{ marginRight: 8 }} />
                        Снижение
                      </span>
                    ),
                    children: (
                      <DiscountTab
                        tenderId={selectedTenderId}
                        settings={discountSettings}
                        getDiscountWorkspace={getDiscountWorkspace}
                        onSaved={() => fetchFinancialIndicators(selectedTenderId)}
                        isPhone={isPhone}
                      />
                    ),
                  }]),
            ]}
          />
        </Spin>
      </Card>

      <Drawer
        open={tableFullscreen}
        onClose={() => setTableFullscreen(false)}
        placement="bottom"
        height="100%"
        title="Финансовые показатели — таблица"
        styles={{ body: { padding: 8, overflow: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y pinch-zoom' } }}
        extra={
          <Space>
            <Button
              size="small"
              icon={<ZoomOutOutlined />}
              disabled={tableScale <= 0.75}
              onClick={() => setTableScale((s) => Math.max(0.75, Math.round((s - 0.25) * 100) / 100))}
            />
            <span style={{ minWidth: 44, textAlign: 'center', display: 'inline-block' }}>
              {Math.round(tableScale * 100)}%
            </span>
            <Button
              size="small"
              icon={<ZoomInOutlined />}
              disabled={tableScale >= 2}
              onClick={() => setTableScale((s) => Math.min(2, Math.round((s + 0.25) * 100) / 100))}
            />
          </Space>
        }
      >
        <div style={{ transform: `scale(${tableScale})`, transformOrigin: 'top left', width: `${100 / tableScale}%` }}>
          {indicatorsTableNode}
        </div>
      </Drawer>
    </div>
  );
};

export default FinancialIndicators;
