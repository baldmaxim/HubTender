import React from 'react';
import { Card, Row, Col, Typography, Table, Spin } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AutoFitText } from '../../../../components/AutoFitText';
import type { CategoryBreakdown, DrillDownLevel, SummaryTableRow } from './types';

const { Text, Title } = Typography;

/** Карточка «Детализация по категориям затрат» (3-й уровень, только десктоп). */
export const BreakdownDetailCard: React.FC<{
  currentTheme: string;
  selectedIndicatorName: string | null | undefined;
  loadingBreakdown: boolean;
  breakdownData: CategoryBreakdown[];
  formatNumber: (value: number | undefined) => string;
}> = ({ currentTheme, selectedIndicatorName, loadingBreakdown, breakdownData, formatNumber }) => {
  // Колонки таблицы детализации по категориям затрат
  const breakdownColumns: ColumnsType<CategoryBreakdown> = [
    {
      title: '№',
      dataIndex: 'key',
      key: 'key',
      width: 50,
      render: (_: unknown, __: unknown, index: number) => index + 1,
    },
    {
      title: 'Категория затрат',
      dataIndex: 'category_name',
      key: 'category_name',
      width: 200,
    },
    {
      title: 'Вид затрат',
      dataIndex: 'detail_name',
      key: 'detail_name',
      width: 200,
    },
    {
      title: 'Локализация',
      dataIndex: 'location_name',
      key: 'location_name',
      width: 150,
    },
    {
      title: 'Работы (руб.)',
      dataIndex: 'works_amount',
      key: 'works_amount',
      width: 150,
      align: 'right' as const,
      render: (val: number) => formatNumber(val),
    },
    {
      title: 'Материалы (руб.)',
      dataIndex: 'materials_amount',
      key: 'materials_amount',
      width: 150,
      align: 'right' as const,
      render: (val: number) => formatNumber(val),
    },
    {
      title: 'Итого (руб.)',
      dataIndex: 'total_amount',
      key: 'total_amount',
      width: 150,
      align: 'right' as const,
      render: (val: number) => <Text strong>{formatNumber(val)}</Text>,
    },
  ];

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      <Col xs={24}>
        <Card
          bordered
          style={{
            background: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <Title level={5} style={{ margin: 0, marginBottom: 4 }}>
              Детализация по категориям затрат
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {selectedIndicatorName}
            </Text>
          </div>

          <Spin spinning={loadingBreakdown}>
            <Table
              dataSource={breakdownData}
              columns={breakdownColumns}
              pagination={false}
              size="small"
              bordered
              scroll={{ x: 1200 }}
              summary={(data) => {
                const totalWorks = data.reduce((sum, item) => sum + item.works_amount, 0);
                const totalMaterials = data.reduce((sum, item) => sum + item.materials_amount, 0);
                const total = data.reduce((sum, item) => sum + item.total_amount, 0);

                return (
                  <Table.Summary.Row style={{ background: currentTheme === 'dark' ? '#262626' : '#fafafa' }}>
                    <Table.Summary.Cell index={0} colSpan={4}>
                      <Text strong>ИТОГО:</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <Text strong>{formatNumber(totalWorks)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      <Text strong>{formatNumber(totalMaterials)}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">
                      <Text strong style={{ color: '#1890ff' }}>{formatNumber(total)}</Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                );
              }}
            />
          </Spin>
        </Card>
      </Col>
    </Row>
  );
};

/** Карточка «Краткая сводка» по текущему уровню drill-down. */
export const SummaryTableCard: React.FC<{
  currentTheme: string;
  drillDownPath: DrillDownLevel[];
  dataSource: SummaryTableRow[];
  isPhoneDevice: boolean;
  formatNumber: (value: number | undefined) => string;
  spTotal: number;
}> = ({ currentTheme, drillDownPath, dataSource, isPhoneDevice, formatNumber, spTotal }) => {
  const summaryTableColumns: ColumnsType<SummaryTableRow> = [
    {
      title: '№',
      dataIndex: 'key',
      key: 'key',
      width: isPhoneDevice ? 28 : 50,
      render: (_: unknown, __: unknown, index: number) => index + 1,
    },
    {
      title: 'Показатель',
      dataIndex: 'indicator_name',
      key: 'indicator_name',
      width: isPhoneDevice ? 100 : 300,
    },
    {
      title: 'Сумма (руб.)',
      dataIndex: 'amount',
      key: 'amount',
      width: isPhoneDevice ? 95 : 150,
      align: 'right' as const,
      render: (val: number) => <AutoFitText strong>{formatNumber(val)}</AutoFitText>,
    },
    {
      title: 'Цена за м² (руб./м²)',
      dataIndex: 'price_per_m2',
      key: 'price_per_m2',
      width: isPhoneDevice ? 85 : 150,
      align: 'right' as const,
      render: (val: number) => <AutoFitText>{formatNumber(Math.round(val))}</AutoFitText>,
    },
  ];

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24}>
        <Card
          bordered
          style={{
            background: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <Title level={5} style={{ margin: 0, marginBottom: 4 }}>
              Краткая сводка
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {drillDownPath.length === 1
                ? 'Общая структура затрат'
                : drillDownPath[drillDownPath.length - 1].type === 'direct_costs'
                ? 'Состав прямых затрат'
                : drillDownPath[drillDownPath.length - 1].type === 'markups'
                ? 'Состав наценок'
                : drillDownPath[drillDownPath.length - 1].type === 'profit_breakdown'
                ? 'Детализация прибыли'
                : drillDownPath[drillDownPath.length - 1].type === 'ooz_breakdown'
                ? 'Детализация ООЗ'
                : drillDownPath[drillDownPath.length - 1].type === 'cost_growth_breakdown'
                ? 'Детализация роста стоимости'
                : drillDownPath[drillDownPath.length - 1].type === 'reserve_breakdown'
                ? 'Запас на сдачу объекта'
                : drillDownPath[drillDownPath.length - 1].indicatorName || 'Детализация'}
            </Text>
          </div>

          <Table
            className="fi-summary-table"
            dataSource={dataSource}
            columns={summaryTableColumns}
            pagination={false}
            size="small"
            bordered
            scroll={{ x: isPhoneDevice ? 315 : 650 }}
            summary={(pageData) => {
              const totalAmount = pageData.reduce((sum, item) => sum + item.amount, 0);
              const totalAreaM2 = spTotal;
              const avgPricePerM2 = totalAreaM2 > 0 ? totalAmount / totalAreaM2 : 0;

              return (
                <Table.Summary.Row style={{ background: currentTheme === 'dark' ? '#262626' : '#fafafa' }}>
                  <Table.Summary.Cell index={0} colSpan={2}>
                    <Text strong>ИТОГО:</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <AutoFitText strong color="#1890ff">{formatNumber(totalAmount)}</AutoFitText>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">
                    <AutoFitText strong>{formatNumber(Math.round(avgPricePerM2))}</AutoFitText>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              );
            }}
          />
        </Card>
      </Col>
    </Row>
  );
};

/** Карточка «Справочная информация» (монолит/ВИС/фасады за единицу). */
export const ReferenceInfoCard: React.FC<{
  currentTheme: string;
  referenceInfo: { monolithPerM3: number; visPerM2: number; facadePerM2: number };
  formatNumber: (value: number | undefined) => string;
}> = ({ currentTheme, referenceInfo, formatNumber }) => (
  <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
    <Col xs={24}>
      <Card
        bordered
        style={{
          background: currentTheme === 'dark' ? '#1f1f1f' : '#ffffff',
        }}
      >
        <Title level={5} style={{ marginBottom: 16 }}>
          Справочная информация
        </Title>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
            <Text>1. Стоимость монолита за м³</Text>
            <Text strong style={{ fontSize: 16 }}>
              {formatNumber(Math.round(referenceInfo.monolithPerM3))} руб/м³
            </Text>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
            <Text>2. Стоимость ВИСов за м²</Text>
            <Text strong style={{ fontSize: 16 }}>
              {formatNumber(Math.round(referenceInfo.visPerM2))} руб/м²
            </Text>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
            <Text>3. Стоимость Фасадов за м²</Text>
            <Text strong style={{ fontSize: 16 }}>
              {formatNumber(Math.round(referenceInfo.facadePerM2))} руб/м²
            </Text>
          </div>
        </div>
      </Card>
    </Col>
  </Row>
);
