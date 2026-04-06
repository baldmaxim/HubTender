import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Card, Table, Select, InputNumber, Typography, Space,
  Row, Col, Statistic, message, Button,
} from 'antd';
import { SafetyCertificateOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { supabase } from '../../../lib/supabase';
import type { Tender } from '../../../lib/supabase';

const { Title, Text } = Typography;

interface InsuranceFormData {
  judicial_pct: number;
  total_pct: number;
  apt_price_m2: number;
  apt_area: number;
  parking_price_m2: number;
  parking_area: number;
  storage_price_m2: number;
  storage_area: number;
}

const DEFAULT_DATA: InsuranceFormData = {
  judicial_pct: 0,
  total_pct: 0,
  apt_price_m2: 0,
  apt_area: 0,
  parking_price_m2: 0,
  parking_area: 0,
  storage_price_m2: 0,
  storage_area: 0,
};

interface CalcResult {
  aptTotal: number;
  parkingTotal: number;
  storageTotal: number;
  sumTotal: number;
  insuranceTotal: number;
}

function calcInsurance(d: InsuranceFormData): CalcResult {
  const aptTotal = (d.apt_price_m2 || 0) * (d.apt_area || 0);
  const parkingTotal = (d.parking_price_m2 || 0) * (d.parking_area || 0);
  const storageTotal = (d.storage_price_m2 || 0) * (d.storage_area || 0);
  const sumTotal = aptTotal + parkingTotal + storageTotal;
  const insuranceTotal = sumTotal * ((d.judicial_pct || 0) / 100) * ((d.total_pct || 0) / 100);
  return { aptTotal, parkingTotal, storageTotal, sumTotal, insuranceTotal };
}

const numFmt = (v: number | string | undefined) =>
  String(v ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
const numParse = (v: string | undefined) =>
  Number(String(v ?? '').replace(/\u00a0/g, '').replace(/\s/g, ''));
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

interface TableRow {
  key: string;
  label: string;
  priceField: keyof InsuranceFormData | null;
  areaField: keyof InsuranceFormData | null;
  total: number;
  isTotal?: boolean;
}

export default function Insurance() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTenderTitle, setSelectedTenderTitle] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [formData, setFormData] = useState<InsuranceFormData>({ ...DEFAULT_DATA });
  const [loading, setLoading] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    supabase
      .from('tenders')
      .select('id, title, tender_number, client_name, version, is_archived')
      .order('created_at', { ascending: false })
      .then(({ data }) => setTenders((data || []) as Tender[]));
  }, []);

  const loadInsurance = useCallback(async (tenderId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('tender_insurance')
        .select('*')
        .eq('tender_id', tenderId)
        .maybeSingle();
      if (error) throw error;
      setFormData(data ? {
        judicial_pct: Number(data.judicial_pct) || 0,
        total_pct: Number(data.total_pct) || 0,
        apt_price_m2: Number(data.apt_price_m2) || 0,
        apt_area: Number(data.apt_area) || 0,
        parking_price_m2: Number(data.parking_price_m2) || 0,
        parking_area: Number(data.parking_area) || 0,
        storage_price_m2: Number(data.storage_price_m2) || 0,
        storage_area: Number(data.storage_area) || 0,
      } : { ...DEFAULT_DATA });
    } catch {
      message.error('Ошибка загрузки данных страхования');
    } finally {
      setLoading(false);
    }
  }, []);

  const persistSave = useCallback(async (tenderId: string, data: InsuranceFormData) => {
    const { error } = await supabase
      .from('tender_insurance')
      .upsert({ tender_id: tenderId, ...data }, { onConflict: 'tender_id' });
    if (error) message.error('Ошибка сохранения: ' + error.message);
  }, []);

  const handleChange = (field: keyof InsuranceFormData, value: number | null) => {
    const next = { ...formData, [field]: value ?? 0 };
    setFormData(next);
    if (!selectedTenderId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persistSave(selectedTenderId, next), 700);
  };

  const getTenderTitles = () => {
    const seen = new Set<string>();
    return tenders
      .filter(t => { if (seen.has(t.title)) return false; seen.add(t.title); return true; })
      .map(t => ({ value: t.title, label: t.title }));
  };

  const getVersionsForTitle = (title: string) =>
    tenders
      .filter(t => t.title === title)
      .sort((a, b) => (b.version || 1) - (a.version || 1))
      .map(t => ({ value: t.version || 1, label: `Версия ${t.version || 1}` }));

  const selectTender = (tenderId: string, title: string, version: number) => {
    setSelectedTenderTitle(title);
    setSelectedVersion(version);
    setSelectedTenderId(tenderId);
    loadInsurance(tenderId);
  };

  const handleTitleChange = (title: string) => {
    const latest = tenders
      .filter(t => t.title === title)
      .sort((a, b) => (b.version || 1) - (a.version || 1))[0];
    if (latest) selectTender(latest.id, title, latest.version || 1);
  };

  const handleVersionChange = (version: number) => {
    const t = tenders.find(t => t.title === selectedTenderTitle && t.version === version);
    if (t) selectTender(t.id, t.title, version);
  };

  const { aptTotal, parkingTotal, storageTotal, sumTotal, insuranceTotal } = calcInsurance(formData);

  const inputProps = (field: keyof InsuranceFormData) => ({
    value: formData[field] as number,
    onChange: (v: number | null) => handleChange(field, v),
    disabled: !selectedTenderId,
    min: 0,
    precision: 2,
    style: { width: '100%' },
    formatter: numFmt,
    parser: numParse,
  });

  const pctProps = (field: keyof InsuranceFormData) => ({
    ...inputProps(field),
    max: 100,
    precision: 4,
    addonAfter: '%',
    formatter: undefined as any,
    parser: undefined as any,
  });

  const rows: TableRow[] = [
    { key: 'apt', label: 'Квартиры', priceField: 'apt_price_m2', areaField: 'apt_area', total: aptTotal },
    { key: 'parking', label: 'Паркинг', priceField: 'parking_price_m2', areaField: 'parking_area', total: parkingTotal },
    { key: 'storage', label: 'Кладовки', priceField: 'storage_price_m2', areaField: 'storage_area', total: storageTotal },
    { key: 'sum', label: 'Итого', priceField: null, areaField: null, total: sumTotal, isTotal: true },
  ];

  const columns = [
    {
      title: 'Тип',
      dataIndex: 'label',
      key: 'label',
      width: 130,
      render: (v: string, row: TableRow) =>
        row.isTotal ? <Text strong>{v}</Text> : <Text>{v}</Text>,
    },
    {
      title: 'Цена за м², ₽',
      key: 'price',
      width: 200,
      render: (_: any, row: TableRow) =>
        row.priceField ? <InputNumber {...inputProps(row.priceField)} /> : null,
    },
    {
      title: 'Площадь, м²',
      key: 'area',
      width: 200,
      render: (_: any, row: TableRow) =>
        row.areaField ? <InputNumber {...inputProps(row.areaField)} /> : null,
    },
    {
      title: 'Итого, ₽',
      key: 'total',
      align: 'right' as const,
      render: (_: any, row: TableRow) => (
        <Text strong={row.isTotal}>{fmt(row.total)} ₽</Text>
      ),
    },
  ];

  if (!selectedTenderId) {
    return (
      <Card bordered={false}>
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <SafetyCertificateOutlined style={{ fontSize: 56, color: '#10b981', marginBottom: 16 }} />
          <Title level={3} style={{ marginBottom: 8 }}>Страхование от судимостей</Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 32, fontSize: 15 }}>
            Выберите тендер для редактирования параметров страхования
          </Text>
          <Space size="middle" wrap>
            <Select
              placeholder="Наименование тендера"
              style={{ width: 400 }}
              showSearch
              value={selectedTenderTitle}
              onChange={handleTitleChange}
              options={getTenderTitles()}
              filterOption={(input, opt) =>
                (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              size="large"
            />
            {selectedTenderTitle && (
              <Select
                placeholder="Версия"
                style={{ width: 160 }}
                value={selectedVersion}
                onChange={handleVersionChange}
                options={getVersionsForTitle(selectedTenderTitle)}
                size="large"
              />
            )}
          </Space>
        </div>
      </Card>
    );
  }

  return (
    <Card
      bordered={false}
      loading={loading}
      title={
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Button
            icon={<ArrowLeftOutlined />}
            type="primary"
            onClick={() => {
              setSelectedTenderId(null);
              setSelectedTenderTitle(null);
              setSelectedVersion(null);
              setFormData({ ...DEFAULT_DATA });
            }}
            style={{ backgroundColor: '#10b981', borderColor: '#10b981', width: 'fit-content' }}
          >
            Назад к выбору
          </Button>
          <Title level={4} style={{ margin: 0 }}>Страхование от судимостей</Title>
          <Space>
            <Text type="secondary">Тендер:</Text>
            <Select
              showSearch
              value={selectedTenderTitle}
              onChange={handleTitleChange}
              options={getTenderTitles()}
              filterOption={(input, opt) =>
                (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              style={{ width: 350 }}
            />
            <Select
              value={selectedVersion}
              onChange={handleVersionChange}
              options={selectedTenderTitle ? getVersionsForTitle(selectedTenderTitle) : []}
              style={{ width: 140 }}
            />
          </Space>
        </Space>
      }
    >
      {/* Проценты */}
      <Row gutter={24} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card
            size="small"
            title={<Text type="secondary" style={{ fontSize: 13 }}>% судебных квартир</Text>}
            style={{ background: 'rgba(16,185,129,0.06)' }}
          >
            <InputNumber {...pctProps('judicial_pct')} style={{ width: '100%' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card
            size="small"
            title={<Text type="secondary" style={{ fontSize: 13 }}>% от общей суммы</Text>}
            style={{ background: 'rgba(16,185,129,0.06)' }}
          >
            <InputNumber {...pctProps('total_pct')} style={{ width: '100%' }} />
          </Card>
        </Col>
      </Row>

      {/* Таблица параметров */}
      <Table<TableRow>
        bordered
        size="middle"
        dataSource={rows}
        columns={columns}
        pagination={false}
        style={{ marginBottom: 24 }}
        rowClassName={(r) => r.isTotal ? 'insurance-total-row' : ''}
      />

      {/* Итог страхования */}
      <Row justify="end">
        <Col>
          <Card
            style={{
              background: 'rgba(16,185,129,0.10)',
              border: '1px solid #10b981',
              minWidth: 340,
            }}
          >
            <Statistic
              title={<span style={{ fontSize: 14, fontWeight: 600 }}>Итого страхование от судимостей</span>}
              value={insuranceTotal}
              precision={0}
              valueStyle={{ color: '#10b981', fontSize: 28, fontWeight: 700 }}
              formatter={(v) => fmt(Number(v))}
              suffix="₽"
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {fmt(sumTotal)} ₽ × {formData.judicial_pct}% × {formData.total_pct}%
            </Text>
          </Card>
        </Col>
      </Row>
    </Card>
  );
}
