import React, { useState, useEffect } from 'react';
import {
  Card,
  Typography,
  Space,
  Form,
  Select,
  InputNumber,
  Button,
  message,
  Spin,
  Row,
  Col,
  Tag,
  Tabs,
} from 'antd';
import { SaveOutlined, ReloadOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { Tender, TenderMarkupPercentageInsert, MarkupParameter, MarkupTactic } from '../../../lib/supabase';
import { fetchTenders as apiFetchTenders } from '../../../lib/api/tenders';
import {
  listMarkupTactics,
  listActiveMarkupParameters,
  findGlobalMarkupTacticByName,
  getTenderMarkupTacticId,
  setTenderMarkupTacticId,
  listTenderMarkupPercentages,
  deleteTenderMarkupPercentages,
  insertTenderMarkupPercentages,
} from '../../../lib/api/markup';
import { parseNumberInput, formatNumberInput } from '../../../utils/numberFormat';
import { SubcontractGrowthTab } from './SubcontractGrowthTab';
import { getVersionColorByTitle } from '../../../utils/versionColor';

const { Title, Text } = Typography;

interface TenderOption {
  value: string;
  label: string;
  clientName: string;
}

const MarkupPercentages: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tactics, setTactics] = useState<MarkupTactic[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [selectedTenderTitle, setSelectedTenderTitle] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [selectedTacticId, setSelectedTacticId] = useState<string | null>(null);
  const [currentMarkupId, setCurrentMarkupId] = useState<string | null>(null);
  const [markupParameters, setMarkupParameters] = useState<MarkupParameter[]>([]);
  const [loadingParameters, setLoadingParameters] = useState(false);

  const fetchTacticFromSupabase = async (tenderId?: string) => {
    try {
      let tacticId: string | null = null;

      if (tenderId) {
        try {
          tacticId = await getTenderMarkupTacticId(tenderId);
        } catch (error) {
          console.error('Ошибка загрузки тендера:', error);
        }
      }

      if (!tacticId) {
        try {
          const globalTactic = await findGlobalMarkupTacticByName('Базовая схема');
          tacticId = globalTactic?.id || null;
        } catch (error) {
          console.error('Ошибка загрузки глобальной тактики:', error);
          return null;
        }
      }

      return tacticId;
    } catch (error) {
      console.error('Ошибка при загрузке тактики:', error);
      return null;
    }
  };

  const fetchMarkupParameters = async () => {
    setLoadingParameters(true);
    try {
      const data = await listActiveMarkupParameters();
      setMarkupParameters(data);
    } catch (error) {
      console.error('Ошибка загрузки параметров наценок:', error);
      message.error('Не удалось загрузить параметры наценок');
    } finally {
      setLoadingParameters(false);
    }
  };

  const fetchTenders = async () => {
    try {
      const data = await apiFetchTenders();
      setTenders(data);
    } catch (error) {
      console.error('Ошибка загрузки тендеров:', error);
      message.error('Не удалось загрузить список тендеров');
    }
  };

  const fetchTactics = async () => {
    try {
      const data = await listMarkupTactics();
      setTactics(data);
    } catch (error) {
      console.error('Ошибка загрузки тактик:', error);
      message.error('Не удалось загрузить список тактик');
    }
  };

  // Получение уникальных наименований тендеров
  const getTenderTitles = (): TenderOption[] => {
    const uniqueTitles = new Map<string, TenderOption>();

    tenders.forEach(tender => {
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
    return tenders
      .filter(tender => tender.title === title)
      .map(tender => ({
        value: tender.version || 1,
        label: `Версия ${tender.version || 1}`,
      }))
      .sort((a, b) => b.value - a.value);
  };

  // Обработка выбора наименования тендера
  const handleTenderTitleChange = (title: string) => {
    setSelectedTenderTitle(title);
    setSelectedTenderId(null);
    setSelectedVersion(null);
    form.resetFields();
  };

  // Обработка выбора версии тендера
  const handleVersionChange = async (version: number) => {
    setSelectedVersion(version);
    const tender = tenders.find(t => t.title === selectedTenderTitle && t.version === version);
    if (tender) {
      setSelectedTenderId(tender.id);
      const tacticId = await fetchTacticFromSupabase(tender.id);
      if (tacticId) {
        setSelectedTacticId(tacticId);
      }
      fetchMarkupData(tender.id);
    }
  };

  const fetchMarkupData = async (tenderId: string) => {
    setLoading(true);
    try {
      const data = await listTenderMarkupPercentages(tenderId);

      const markupValues: Record<string, number> = {};
      markupParameters.forEach((param) => {
        markupValues[param.key] = param.default_value || 0;
      });

      if (data.length > 0) {
        data.forEach((record) => {
          if (record.markup_parameter) {
            markupValues[record.markup_parameter.key] = record.value || 0;
          }
        });
        setCurrentMarkupId(tenderId);
      } else {
        setCurrentMarkupId(null);
      }

      form.setFieldsValue({
        tender_id: tenderId,
        ...markupValues,
      });
    } catch (error) {
      console.error('Ошибка загрузки данных наценок:', error);
      message.error('Не удалось загрузить данные наценок');
    } finally {
      setLoading(false);
    }
  };


  // Обработка выбора тактики
  const handleTacticChange = async (tacticId: string) => {
    setSelectedTacticId(tacticId);
  };

  // Сохранение данных
  const handleSave = async () => {
    if (!selectedTenderId) {
      message.warning('Выберите тендер');
      return;
    }

    try {
      await form.validateFields();
      const values = form.getFieldsValue();
      setSaving(true);

      if (currentMarkupId) {
        await deleteTenderMarkupPercentages(selectedTenderId);
      }

      const markupRecords: TenderMarkupPercentageInsert[] = markupParameters.map((param) => ({
        tender_id: selectedTenderId,
        markup_parameter_id: param.id,
        value: values[param.key] || 0,
      }));

      await insertTenderMarkupPercentages(markupRecords);

      if (selectedTacticId) {
        await setTenderMarkupTacticId(selectedTenderId, selectedTacticId);
      }

      setCurrentMarkupId(selectedTenderId);
      message.success('Данные успешно обновлены');
    } catch (error) {
      console.error('Ошибка сохранения:', error);
      message.error('Не удалось сохранить данные');
    } finally {
      setSaving(false);
    }
  };

  // Сброс формы
  const handleReset = () => {
    if (selectedTenderId) {
      fetchMarkupData(selectedTenderId);
    } else {
      form.resetFields();
    }
  };

  useEffect(() => {
    fetchTenders();
    fetchTactics();
    fetchMarkupParameters();
  }, []);

  // Если тендер не выбран, показываем только выбор тендера
  if (!selectedTenderId) {
    return (
      <Card bordered={false} style={{ height: '100%' }}>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <Title level={4} style={{ marginBottom: 24 }}>
            Проценты наценок
          </Title>
          <Text type="secondary" style={{ fontSize: 16, marginBottom: 24, display: 'block' }}>
            Выберите тендер для корректирования процентов
          </Text>
          <Select
            className="tender-select"
            style={{ width: 400, marginBottom: 32 }}
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
              style={{ width: 200, marginBottom: 32, marginLeft: 16 }}
              placeholder="Выберите версию"
              value={selectedVersion}
              onChange={handleVersionChange}
              options={getVersionsForTitle(selectedTenderTitle)}
              size="large"
            />
          )}

          {/* Быстрый выбор через карточки */}
          {tenders.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                Или выберите из списка:
              </Text>
              <Row gutter={[16, 16]} justify="center">
                {tenders.filter(t => !t.is_archived).slice(0, 6).map(tender => (
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
                      onClick={async () => {
                        setSelectedTenderId(tender.id);
                        setSelectedTenderTitle(tender.title);
                        setSelectedVersion(tender.version || 1);
                        const tacticId = await fetchTacticFromSupabase(tender.id);
                        if (tacticId) {
                          setSelectedTacticId(tacticId);
                        }
                        fetchMarkupData(tender.id);
                      }}
                      onAuxClick={(e) => {
                        if (e.button === 1) {
                          e.preventDefault();
                          window.open(`/admin/markup?tenderId=${tender.id}`, '_blank');
                        }
                      }}
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
                        gap: 4
                      }}>
                        <Text strong style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 140
                        }}>
                          {tender.title}
                        </Text>
                        <Tag color={getVersionColorByTitle(tender.version, tender.title, tenders)} style={{ flexShrink: 0, margin: 0 }}>v{tender.version || 1}</Tag>
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
      headStyle={{ borderBottom: 'none', paddingBottom: 0 }}
      title={
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Button
            icon={<ArrowLeftOutlined />}
            type="primary"
            onClick={() => {
              setSelectedTenderId(null);
              setSelectedTenderTitle(null);
              setSelectedVersion(null);
              setSelectedTacticId(null);
              form.resetFields();
            }}
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
          <Title level={4} style={{ margin: 0 }}>
            Проценты наценок
          </Title>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <Space size="middle" wrap>
              <Space size="small">
                <Text type="secondary" style={{ fontSize: 16 }}>Тендер:</Text>
                <Select
                  className="tender-select"
                  placeholder="Выберите тендер"
                  value={selectedTenderTitle}
                  onChange={handleTenderTitleChange}
                  showSearch
                  optionFilterProp="children"
                  filterOption={(input, option) =>
                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={getTenderTitles()}
                  style={{ width: 350, fontSize: 16 }}
                  allowClear
                />
              </Space>
              <Space size="small">
                <Text type="secondary" style={{ fontSize: 16 }}>Версия:</Text>
                <Select
                  placeholder="Версия"
                  value={selectedVersion}
                  onChange={handleVersionChange}
                  disabled={!selectedTenderTitle}
                  options={selectedTenderTitle ? getVersionsForTitle(selectedTenderTitle) : []}
                  style={{ width: 140 }}
                />
              </Space>
            </Space>
            <div>
              <Space>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={handleReset}
                  disabled={!selectedTenderId}
                >
                  Сбросить
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={handleSave}
                  loading={saving}
                  disabled={!selectedTenderId}
                >
                  Сохранить
                </Button>
              </Space>
            </div>
          </div>
        </Space>
      }
    >
      <Tabs
        defaultActiveKey="percentages"
        items={[
          {
            key: 'percentages',
            label: 'Базовые проценты',
            children: (
              <Spin spinning={loading || loadingParameters}>
                {loadingParameters ? (
                  <div style={{ textAlign: 'center', padding: '48px 0' }}>
                    <Text>Загрузка параметров наценок...</Text>
                  </div>
                ) : markupParameters.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '48px 0' }}>
                    <Text type="danger">Параметры наценок не найдены. Проверьте базу данных.</Text>
                  </div>
                ) : (
                  <Form
                    form={form}
                    layout="horizontal"
                    labelCol={{ style: { width: '250px', textAlign: 'left' } }}
                    wrapperCol={{ style: { flex: 1 } }}
                    initialValues={{
                      ...markupParameters.reduce((acc, param) => ({
                        ...acc,
                        [param.key]: param.default_value || 0
                      }), {}),
                      tender_id: selectedTenderId
                    }}
                  >
                    <div style={{ marginBottom: '24px' }}>
                      <Form.Item
                        label="Порядок расчета"
                        style={{ marginBottom: 0 }}
                      >
                        <Select
                          placeholder="Выберите порядок расчета"
                          value={selectedTacticId}
                          onChange={handleTacticChange}
                          showSearch
                          optionFilterProp="label"
                          filterOption={(input, option) =>
                            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                          }
                          optionRender={(option) => {
                            const tactic = tactics.find(t => t.id === option.value);
                            return (
                              <span>
                                {option.label}
                                {tactic?.is_global && (
                                  <Tag color="green" style={{ marginLeft: 8, fontSize: 11 }}>
                                    Глобальная
                                  </Tag>
                                )}
                              </span>
                            );
                          }}
                          labelRender={(props) => {
                            const tactic = tactics.find(t => t.id === props.value);
                            return (
                              <span>
                                {props.label}
                                {tactic?.is_global && (
                                  <Tag color="green" style={{ marginLeft: 8, fontSize: 11 }}>
                                    Глобальная
                                  </Tag>
                                )}
                              </span>
                            );
                          }}
                          options={tactics.map(tactic => ({
                            label: tactic.name || 'Без названия',
                            value: tactic.id,
                          }))}
                          style={{ width: '250px' }}
                        />
                      </Form.Item>
                    </div>

                    <Row gutter={[16, 0]}>
                      {markupParameters.map((param, index) => (
                        <Col span={24} key={param.id}>
                          <Form.Item
                            label={`${index + 1}. ${param.label}`}
                            name={param.key}
                            style={{ marginBottom: '4px' }}
                          >
                            <InputNumber
                              min={0}
                              max={999.99999}
                              step={0.00001}
                              addonAfter="%"
                              style={{ width: '120px' }}
                              precision={5}
                              parser={parseNumberInput}
                              formatter={formatNumberInput}
                            />
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>
                  </Form>
                )}
              </Spin>
            ),
          },
          {
            key: 'subcontract_growth',
            label: 'Рост субподряда',
            children: <SubcontractGrowthTab tenderId={selectedTenderId} />,
          },
        ]}
      />
    </Card>
  );
};

export default MarkupPercentages;
