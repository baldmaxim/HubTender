import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Typography, Button, Spin } from 'antd';
import { Bar, Doughnut } from 'react-chartjs-2';
import { useTheme } from '../../../../contexts/ThemeContext';
import { useIsMobile } from '../../../../hooks/useIsMobile';
import type { DrillDownLevel, IndicatorsChartsProps } from './types';
import { useBreakdownData } from './useBreakdownData';
import { useChartDrillDown } from './useChartDrillDown';
import { getCategoriesData } from './categoriesData';
import { getAreaBarData } from './areaBarData';
import { getSummaryTableData, hasDetailedBreakdown } from './drillDownRows';
import { buildPieOptions, buildBarOptions } from './chartOptions';
import { BreakdownDetailCard, SummaryTableCard, ReferenceInfoCard } from './DetailCards';

const { Text, Title } = Typography;

export const IndicatorsCharts: React.FC<IndicatorsChartsProps> = ({
  data,
  spTotal,
  formatNumber,
  selectedTenderId,
  isVatInConstructor,
  vatCoefficient,
  itemScale,
}) => {
  const { theme: currentTheme } = useTheme();
  const { isPhone, isPhoneDevice } = useIsMobile();
  const [drillDownPath, setDrillDownPath] = useState<DrillDownLevel[]>([{ type: 'root' }]);

  const {
    selectedIndicator,
    setSelectedIndicator,
    breakdownData,
    setBreakdownData,
    loadingBreakdown,
    setLoadingBreakdown,
    referenceInfo,
    fetchCategoryBreakdown,
    fetchReferenceInfo,
  } = useBreakdownData({ selectedTenderId, isVatInConstructor, vatCoefficient, itemScale });

  const { handlePieClick, handleBarClick } = useChartDrillDown({
    data,
    drillDownPath,
    setDrillDownPath,
    isPhoneDevice,
    isVatInConstructor,
    setSelectedIndicator,
    setLoadingBreakdown,
    fetchCategoryBreakdown,
  });

  // Функция для возврата на уровень выше
  const handleDrillUp = () => {
    if (drillDownPath.length > 1) {
      const newPath = drillDownPath.slice(0, -1);
      setDrillDownPath(newPath);

      if (newPath.length === 1) {
        // Возвращаемся на корневой уровень
        setSelectedIndicator(null);
        setBreakdownData([]);
      }
    }
  };

  // Сброс выбора при изменении тендера
  useEffect(() => {
    setSelectedIndicator(null);
    setBreakdownData([]);
    setDrillDownPath([{ type: 'root' }]);
    // setters are stable hook-returned functions; excluded to avoid loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenderId]);

  // На телефоне 3-й уровень диаграмм отключён — терминал 2-й уровень. Если пользователь
  // повернул экран, находясь на 3-м уровне, схлопываем путь до 2-го уровня.
  useEffect(() => {
    if (isPhoneDevice && drillDownPath.length > 2) {
      setDrillDownPath(prev => prev.slice(0, 2));
      setSelectedIndicator(null);
      setBreakdownData([]);
    }
    // setters are stable hook-returned functions; excluded to avoid loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPhoneDevice, drillDownPath.length]);

  useEffect(() => {
    if (!selectedTenderId) {
      return;
    }

    void fetchReferenceInfo();

    if (selectedIndicator && hasDetailedBreakdown(selectedIndicator)) {
      void fetchCategoryBreakdown(selectedIndicator);
    }
    // fetchCategoryBreakdown and fetchReferenceInfo are stable hook-returned functions; excluded to avoid loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenderId, selectedIndicator, data, isVatInConstructor, vatCoefficient]);

  // Автоматическая очистка блока детализации при выходе из режима просмотра конечного уровня
  useEffect(() => {
    const currentLevel = drillDownPath[drillDownPath.length - 1];

    // Если текущий уровень не 'indicator', очищаем детализацию
    if (currentLevel.type !== 'indicator') {
      setSelectedIndicator(null);
      setBreakdownData([]);
    }
    // setters are stable hook-returned functions; excluded to avoid loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillDownPath]);

  // Extract current drill-down level for use in barOptions
  const currentLevel = drillDownPath[drillDownPath.length - 1];

  // Высота круговой на телефоне (порт.+ландш.): ур.1 уменьшен на 30% (280→196),
  // ур.2 чуть выше — длиннее легенда. 3-й уровень на телефоне недостижим (отключён).
  // Десктоп не трогаем.
  const pieIsRoot = currentLevel.type === 'root';
  const pieIsLevel2 = currentLevel.type === 'direct_costs' || currentLevel.type === 'markups';
  const pieHeight = isPhoneDevice ? (pieIsRoot ? 196 : pieIsLevel2 ? 230 : 196) : 320;

  const pieOptions = buildPieOptions({ currentTheme, isPhone, isPhoneDevice, drillDownPath, handlePieClick });
  const barOptions = buildBarOptions({ currentTheme, isPhoneDevice, currentLevel, breakdownData, handleBarClick });

  const categoriesData = getCategoriesData({ data, drillDownPath, breakdownData, currentTheme });
  const areaBarData = getAreaBarData({ data, drillDownPath, breakdownData, selectedIndicator, selectedTenderId, spTotal });

  // Получаем имя выбранного индикатора
  const selectedIndicatorName = selectedIndicator
    ? data.find(d => d.row_number === selectedIndicator)?.indicator_name
    : null;

  return (
    <div>
      {/* Верхний ряд: Круговая диаграмма и столбчатая диаграмма */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={12}>
          <Card
            bordered
            style={{
              minHeight: isPhoneDevice ? undefined : 450,
              background: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <Title level={5} style={{ margin: 0, color: currentTheme === 'dark' ? '#ffffff' : '#000000' }}>
                  Структура Цены
                </Title>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  {data.length > 0 && (
                    <Text strong style={{ fontSize: 16, color: currentTheme === 'dark' ? '#ffffff' : '#000000' }}>
                      {formatNumber(
                        drillDownPath.length === 1
                          ? data.find(d => d.is_total)?.total_cost
                          : drillDownPath[drillDownPath.length - 1].type === 'direct_costs'
                          ? data.filter(d => !d.is_header && !d.is_total && d.row_number >= 2 && d.row_number <= 7).reduce((sum, d) => sum + (d.total_cost || 0), 0)
                          : drillDownPath[drillDownPath.length - 1].type === 'markups'
                          ? data.filter(d => !d.is_header && !d.is_total && d.row_number >= 8 && d.row_number <= 16).reduce((sum, d) => sum + (d.total_cost || 0), 0)
                          : drillDownPath[drillDownPath.length - 1].type === 'indicator' && selectedIndicator
                          ? data.find(d => d.row_number === selectedIndicator)?.total_cost
                          : drillDownPath[drillDownPath.length - 1].type === 'profit_breakdown'
                          ? data.filter(d => d.row_number === 14 || d.row_number === 15).reduce((sum, d) => sum + (d.total_cost || 0), 0)
                          : data.find(d => d.is_total)?.total_cost
                      )} Руб.
                    </Text>
                  )}
                  {drillDownPath.length > 1 && (
                    <Button
                      size="small"
                      style={{ backgroundColor: '#52c41a', borderColor: '#52c41a', color: '#fff' }}
                      onClick={handleDrillUp}
                    >
                      ← Назад
                    </Button>
                  )}
                </div>
              </div>

              {/* Breadcrumb навигация */}
              {drillDownPath.length > 1 && (
                <div style={{ marginBottom: 8 }}>
                  {drillDownPath.map((level, idx) => (
                    <span key={idx}>
                      {idx > 0 && <Text type="secondary"> → </Text>}
                      <Text
                        type={idx === drillDownPath.length - 1 ? undefined : 'secondary'}
                        style={{
                          cursor: idx < drillDownPath.length - 1 ? 'pointer' : 'default',
                          fontWeight: idx === drillDownPath.length - 1 ? 600 : 400,
                          color: idx === drillDownPath.length - 1 ? '#1890ff' : undefined,
                        }}
                        onClick={() => {
                          if (idx < drillDownPath.length - 1) {
                            setDrillDownPath(drillDownPath.slice(0, idx + 1));
                            if (idx === 0) {
                              setSelectedIndicator(null);
                              setBreakdownData([]);
                            }
                          }
                        }}
                      >
                        {level.type === 'root'
                          ? 'Все показатели'
                          : level.type === 'direct_costs'
                          ? 'Прямые затраты'
                          : level.type === 'markups'
                          ? 'Наценки'
                          : level.type === 'profit_breakdown'
                          ? 'Детализация прибыли'
                          : level.type === 'reserve_breakdown'
                          ? 'Запас на сдачу объекта'
                          : level.indicatorName || 'Детализация'}
                      </Text>
                    </span>
                  ))}
                </div>
              )}

              <div style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {drillDownPath.length === 1
                    ? 'Кликните для детализации'
                    : drillDownPath[drillDownPath.length - 1].type === 'indicator'
                    ? 'Детализация по категориям затрат'
                    : isPhoneDevice
                    ? 'Структура по типам работ и материалов'
                    : 'Детализация по показателям'}
                </Text>
              </div>
            </div>
            <Spin spinning={loadingBreakdown}>
              {categoriesData ? (
                <div style={{ height: pieHeight, maxHeight: pieHeight, overflow: 'hidden', touchAction: 'pan-x pan-y pinch-zoom' }}>
                  <Doughnut data={categoriesData} options={pieOptions} />
                </div>
              ) : drillDownPath.length > 1 ? (
                <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                  <Text type="secondary" style={{ fontSize: 16, marginBottom: 12 }}>
                    📊 Детализация недоступна
                  </Text>
                  <Text type="secondary" style={{ fontSize: 14 }}>
                    Для показателя "{drillDownPath[drillDownPath.length - 1].indicatorName}"
                  </Text>
                  <Text type="secondary" style={{ fontSize: 14 }}>
                    детализация по категориям затрат не предусмотрена
                  </Text>
                  <Button type="primary" onClick={handleDrillUp} style={{ marginTop: 16 }}>
                    Вернуться к общему обзору
                  </Button>
                </div>
              ) : null}
            </Spin>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            bordered
            style={{
              minHeight: isPhoneDevice ? undefined : 450,
              background: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <Title level={5} style={{ margin: 0, color: currentTheme === 'dark' ? '#ffffff' : '#000000' }}>
                  Стоимость за м²
                </Title>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  {data.length > 0 && (
                    <Text strong style={{ fontSize: 16, color: currentTheme === 'dark' ? '#ffffff' : '#000000' }}>
                      {(() => {
                        const level = drillDownPath[drillDownPath.length - 1];
                        const totalAreaM2 = spTotal; // Используем только площадь по СП
                        let currentCost = 0;

                        if (level.type === 'root') {
                          currentCost = data.find(d => d.is_total)?.total_cost || 0;
                        } else if (level.type === 'direct_costs') {
                          currentCost = data.filter(d => !d.is_header && !d.is_total && d.row_number >= 2 && d.row_number <= 7)
                            .reduce((sum, d) => sum + (d.total_cost || 0), 0);
                        } else if (level.type === 'markups') {
                          currentCost = data.filter(d => !d.is_header && !d.is_total && d.row_number >= 8 && d.row_number <= 16)
                            .reduce((sum, d) => sum + (d.total_cost || 0), 0);
                        } else if (level.type === 'indicator' && selectedIndicator) {
                          currentCost = data.find(d => d.row_number === selectedIndicator)?.total_cost || 0;
                        } else if (level.type === 'profit_breakdown') {
                          currentCost = data.filter(d => d.row_number === 14 || d.row_number === 15)
                            .reduce((sum, d) => sum + (d.total_cost || 0), 0);
                        }

                        const pricePerM2 = totalAreaM2 > 0 ? currentCost / totalAreaM2 : 0;
                        return `${formatNumber(Math.round(pricePerM2))} Руб./м²`;
                      })()}
                    </Text>
                  )}
                  {drillDownPath.length > 1 && (
                    <Button
                      size="small"
                      style={{ backgroundColor: '#52c41a', borderColor: '#52c41a', color: '#fff' }}
                      onClick={handleDrillUp}
                    >
                      ← Назад
                    </Button>
                  )}
                </div>
              </div>
            </div>
            {areaBarData && (
              <div style={{ height: isPhoneDevice ? 340 : 350, touchAction: 'pan-x pan-y pinch-zoom' }}>
                <Bar data={areaBarData} options={barOptions as never} />
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* Детализация по категориям затрат (показывается только для Субподряда и Работы+Материалы СУ-10).
          На телефоне 3-й уровень отключён — блок не показываем. */}
      {!isPhoneDevice && selectedIndicator && (selectedIndicator === 2 || selectedIndicator === 3 || selectedIndicator === 4) && (
        <BreakdownDetailCard
          currentTheme={currentTheme}
          selectedIndicatorName={selectedIndicatorName}
          loadingBreakdown={loadingBreakdown}
          breakdownData={breakdownData}
          formatNumber={formatNumber}
        />
      )}

      {/* Нижний ряд: Таблица сводки по выбранному уровню (скрыт когда открыт блок детализации затрат) */}
      {!(!isPhoneDevice && selectedIndicator && (selectedIndicator === 2 || selectedIndicator === 3 || selectedIndicator === 4)) && (
        <SummaryTableCard
          currentTheme={currentTheme}
          drillDownPath={drillDownPath}
          dataSource={getSummaryTableData(data, drillDownPath, spTotal)}
          isPhoneDevice={isPhoneDevice}
          formatNumber={formatNumber}
          spTotal={spTotal}
        />
      )}

      {/* Справочная информация */}
      <ReferenceInfoCard
        currentTheme={currentTheme}
        referenceInfo={referenceInfo}
        formatNumber={formatNumber}
      />
    </div>
  );
};
