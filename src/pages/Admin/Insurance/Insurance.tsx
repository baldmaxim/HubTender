import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Card, Select, InputNumber, Typography, Space,
  Row, Col, message, Button, Tag,
} from 'antd';
import { SafetyCertificateOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import type { Tender } from '../../../lib/supabase';
import {
  fetchInsuranceTenders,
  loadTenderInsurance,
  upsertTenderInsurance,
  type InsuranceData,
} from '../../../lib/api/insurance';
import { getErrorMessage } from '../../../utils/errors';
import { getVersionColorByTitle } from '../../../utils/versionColor';
import { useAuth } from '../../../contexts/AuthContext';

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

function calcInsurance(d: InsuranceFormData) {
  const aptTotal = (d.apt_price_m2 || 0) * (d.apt_area || 0);
  const parkingTotal = (d.parking_price_m2 || 0) * (d.parking_area || 0);
  const storageTotal = (d.storage_price_m2 || 0) * (d.storage_area || 0);
  const sumTotal = aptTotal + parkingTotal + storageTotal;
  const insuranceTotal = sumTotal * ((d.judicial_pct || 0) / 100) * ((d.total_pct || 0) / 100);
  return { aptTotal, parkingTotal, storageTotal, sumTotal, insuranceTotal };
}

const numFmt = (v: number | string | undefined) =>
  String(v ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
// Parser for price fields: strip thousands separators
const numParse = (v: string | undefined) =>
  String(v ?? '').replace(/\u00a0/g, '').replace(/\s/g, '') as unknown as number;
// Parser for area fields: additionally accept comma as decimal separator
const areaParse = (v: string | undefined) =>
  String(v ?? '').replace(/\u00a0/g, '').replace(/\s/g, '').replace(',', '.') as unknown as number;

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

const AREA_ONLY_ROLES = ['engineer', 'senior_group'];

export default function Insurance() {
  const { user } = useAuth();
  const isAreaOnly = AREA_ONLY_ROLES.includes(user?.role_code || '');

  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTenderTitle, setSelectedTenderTitle] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [formData, setFormData] = useState<InsuranceFormData>({ ...DEFAULT_DATA });
  const [loading, setLoading] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchInsuranceTenders().then(setTenders).catch(() => setTenders([]));
  }, []);

  const loadInsurance = useCallback(async (tenderId: string) => {
    setLoading(true);
    try {
      const data = await loadTenderInsurance(tenderId);
      setFormData(data ?? { ...DEFAULT_DATA });
    } catch {
      message.error('Ошибка загрузки данных страхования');
    } finally {
      setLoading(false);
    }
  }, []);

  const persistSave = useCallback(async (tenderId: string, data: InsuranceData) => {
    try {
      await upsertTenderInsurance(tenderId, data);
    } catch (error) {
      message.error('Ошибка сохранения: ' + getErrorMessage(error));
    }
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

  // price fields: disabled for area-only roles
  const numInput = (field: keyof InsuranceFormData) => (
    <InputNumber
      value={formData[field] as number}
      onChange={(v) => handleChange(field, v as number | null)}
      disabled={!selectedTenderId || isAreaOnly}
      min={0}
      precision={2}
      style={{ width: '100%' }}
      formatter={numFmt}
      parser={numParse}
    />
  );

  // area fields: always editable (when tender selected)
  const areaInput = (field: keyof InsuranceFormData) => (
    <InputNumber
      value={formData[field] as number}
      onChange={(v) => handleChange(field, v as number | null)}
      disabled={!selectedTenderId}
      min={0}
      precision={2}
      style={{ width: '100%' }}
      formatter={numFmt}
      parser={areaParse}
    />
  );

  // pct fields: disabled for area-only roles
  const pctInput = (field: keyof InsuranceFormData) => (
    <InputNumber
      value={formData[field] as number}
      onChange={(v) => handleChange(field, v)}
      disabled={!selectedTenderId || isAreaOnly}
      min={0}
      max={100}
      precision={4}
      addonAfter="%"
      style={{ width: '100%' }}
    />
  );

  const quickCards = tenders.filter(t => !t.is_archived).slice(0, 6);
  const headerTags = tenders.slice(0, 8);

  // Styles for the property table
  const borderColor = '#d9d9d9';
  const groupBorder = '2px solid #10b981';

  const thBase: React.CSSProperties = {
    padding: '8px 10px',
    textAlign: 'center',
    fontWeight: 600,
    fontSize: 13,
    background: 'rgba(0,0,0,0.04)',
    borderBottom: `1px solid ${borderColor}`,
    borderLeft: `1px solid ${borderColor}`,
  };
  const thGroup: React.CSSProperties = { ...thBase, borderLeft: groupBorder };
  const thSub: React.CSSProperties = { ...thBase, fontWeight: 400, fontSize: 12 };
  const thSubGroup: React.CSSProperties = { ...thSub, borderLeft: groupBorder };
  const tdBase: React.CSSProperties = {
    padding: '10px 10px',
    textAlign: 'center',
    borderLeft: `1px solid ${borderColor}`,
    verticalAlign: 'middle',
  };
  const tdGroup: React.CSSProperties = { ...tdBase, borderLeft: groupBorder };

  if (!selectedTenderId) {
    return (
      <Card bordered={false} style={{ height: '100%' }}>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <SafetyCertificateOutlined style={{ fontSize: 56, color: '#10b981', marginBottom: 16 }} />
          <Title level={3} style={{ marginBottom: 8 }}>Страхование от судимостей</Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 24, fontSize: 15 }}>
            Выберите тендер для редактирования параметров страхования
          </Text>
          <Space size="middle" wrap style={{ justifyContent: 'center', display: 'flex', marginBottom: 32 }}>
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
          {quickCards.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                Или выберите из списка:
              </Text>
              <Row gutter={[16, 16]} justify="center">
                {quickCards.map(tender => (
                  <Col key={tender.id}>
                    <Card
                      hoverable
                      style={{
                        width: 200,
                        textAlign: 'center',
                        cursor: 'pointer',
                        borderColor: '#10b981',
                        borderWidth: 1,
                      }}
                      onClick={() => selectTender(tender.id, tender.title, tender.version || 1)}
                    >
                      <div style={{ marginBottom: 8 }}>
                        <Tag color="#10b981">{tender.tender_number}</Tag>
                      </div>
                      <div style={{
                        marginBottom: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexWrap: 'nowrap',
                        gap: 4,
                      }}>
                        <Text strong style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 140,
                        }}>
                          {tender.title}
                        </Text>
                        <Tag
                          color={getVersionColorByTitle(tender.version, tender.title, tenders)}
                          style={{ flexShrink: 0, margin: 0 }}
                        >
                          v{tender.version || 1}
                        </Tag>
                      </div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {tender.client_name}
                      </Text>
                    </Card>
                  </Col>
                ))}
              </Row>
            </div>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card
      bordered={false}
      loading={loading}
      title={
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
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
          <Space wrap>
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
          {headerTags.length > 0 && (
            <Space size={4} wrap>
              <Text type="secondary" style={{ fontSize: 11 }}>Быстрый выбор:</Text>
              {headerTags.map(t => (
                <Tag
                  key={t.id}
                  color={t.id === selectedTenderId ? 'green' : 'default'}
                  style={{ cursor: 'pointer', fontSize: 12, margin: 0 }}
                  onClick={() => selectTender(t.id, t.title, t.version || 1)}
                >
                  {t.title} v{t.version || 1}
                </Tag>
              ))}
            </Space>
          )}
        </Space>
      }
    >
      {/* Проценты + Итог страхования */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8} lg={5} style={{ display: 'flex' }}>
          <Card
            size="small"
            title={<Text type="secondary" style={{ fontSize: 13 }}>% судебных квартир</Text>}
            style={{ background: 'rgba(16,185,129,0.06)', flex: 1 }}
            styles={{ body: { paddingTop: 8, paddingBottom: 8 } }}
          >
            {pctInput('judicial_pct')}
          </Card>
        </Col>
        <Col xs={24} sm={8} lg={5} style={{ display: 'flex' }}>
          <Card
            size="small"
            title={<Text type="secondary" style={{ fontSize: 13 }}>% от общей суммы</Text>}
            style={{ background: 'rgba(16,185,129,0.06)', flex: 1 }}
            styles={{ body: { paddingTop: 8, paddingBottom: 8 } }}
          >
            {pctInput('total_pct')}
          </Card>
        </Col>
        <Col xs={24} sm={8} lg={5} style={{ display: 'flex' }}>
          <Card
            size="small"
            title={
              <Text style={{ fontSize: 13, fontWeight: 600, color: '#10b981' }}>
                Итого страхование от судимостей
              </Text>
            }
            style={{ background: 'rgba(16,185,129,0.10)', border: '1px solid #10b981', flex: 1 }}
            styles={{ body: { paddingTop: 8, paddingBottom: 8 } }}
          >
            <Text style={{ color: '#10b981', fontSize: 18, fontWeight: 700, display: 'block' }}>
              {fmt(insuranceTotal)} ₽
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {fmt(sumTotal)} × {formData.judicial_pct}% × {formData.total_pct}%
            </Text>
          </Card>
        </Col>
      </Row>

      {/* Таблица параметров недвижимости — нативный <table> для стабильности инпутов */}
      <div style={{ border: `1px solid ${borderColor}`, borderRadius: 8, overflow: 'auto', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 900 }}>
          <colgroup>
            <col /><col /><col />
            <col /><col /><col />
            <col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th colSpan={3} style={thBase}>Квартиры</th>
              <th colSpan={3} style={thGroup}>Паркинг</th>
              <th colSpan={3} style={thGroup}>Кладовки</th>
            </tr>
            <tr>
              <th style={thSub}>Цена за м², ₽</th>
              <th style={thSub}>Площадь, м²</th>
              <th style={thSub}>Итого, ₽</th>
              <th style={thSubGroup}>Цена за м², ₽</th>
              <th style={thSub}>Площадь, м²</th>
              <th style={thSub}>Итого, ₽</th>
              <th style={thSubGroup}>Цена за м², ₽</th>
              <th style={thSub}>Площадь, м²</th>
              <th style={thSub}>Итого, ₽</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={tdBase}>{numInput('apt_price_m2')}</td>
              <td style={tdBase}>{areaInput('apt_area')}</td>
              <td style={tdBase}>
                <Text strong style={{ color: '#10b981' }}>{fmt(aptTotal)} ₽</Text>
              </td>
              <td style={tdGroup}>{numInput('parking_price_m2')}</td>
              <td style={tdBase}>{areaInput('parking_area')}</td>
              <td style={tdBase}>
                <Text strong style={{ color: '#10b981' }}>{fmt(parkingTotal)} ₽</Text>
              </td>
              <td style={tdGroup}>{numInput('storage_price_m2')}</td>
              <td style={tdBase}>{areaInput('storage_area')}</td>
              <td style={tdBase}>
                <Text strong style={{ color: '#10b981' }}>{fmt(storageTotal)} ₽</Text>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
