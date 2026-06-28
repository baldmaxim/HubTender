import React from 'react';
import { Card, Select, Row, Col, Divider, Button, Space, Typography } from 'antd';
import {
  LinkOutlined,
  FileTextOutlined,
  QuestionCircleOutlined,
  FolderOutlined,
  ArrowLeftOutlined,
  DashboardOutlined,
} from '@ant-design/icons';
import type { Tender } from '../../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { FitOneLine } from '../../../components/responsive/FitOneLine';

const { Text } = Typography;

interface TenderOption {
  value: string;
  label: string;
  clientName: string;
}

interface PositionToolbarProps {
  selectedTender: Tender | null;
  selectedTenderTitle: string | null;
  selectedVersion: number | null;
  tenderTitles: TenderOption[];
  versions: { value: number; label: string }[];
  currentTheme: string;
  totalSum: number;
  onTenderTitleChange: (title: string) => void;
  onVersionChange: (version: number) => void;
  onBackToSelection: () => void;
}

export const PositionToolbar: React.FC<PositionToolbarProps> = ({
  selectedTender,
  selectedTenderTitle,
  selectedVersion,
  tenderTitles,
  versions,
  currentTheme,
  totalSum,
  onTenderTitleChange,
  onVersionChange,
  onBackToSelection,
}) => {
  const navigate = useNavigate();
  const { isPhoneDevice, isPhone } = useIsMobile();

  return (
    <>
      {/* Верхняя шапка с названием тендера и кнопками */}
      {selectedTender && (
        <div style={{
          padding: isPhoneDevice ? '12px 16px' : '12px 32px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: isPhoneDevice ? 'flex-start' : 'center',
          flexDirection: isPhoneDevice ? 'column' : 'row',
          gap: isPhoneDevice ? 8 : 0,
        }}>
          {!isPhoneDevice && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <FileTextOutlined style={{ fontSize: 32, color: 'white' }} />
              <div>
                <Text style={{ fontSize: 22, fontWeight: 600, margin: 0, color: 'white', display: 'block' }}>
                  {selectedTender.title}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 14 }}>
                  Заказчик: {selectedTender.client_name}
                </Text>
              </div>
            </div>
          )}
          <Space>
            <Button
              type="primary"
              style={{ backgroundColor: '#10b981', borderColor: '#10b981' }}
              icon={<ArrowLeftOutlined />}
              onClick={onBackToSelection}
            >
              Назад к выбору
            </Button>
            {!isPhoneDevice && (
              <Button
                icon={<DashboardOutlined />}
                onClick={() => navigate('/dashboard')}
              >
                К дашборду
              </Button>
            )}
          </Space>
        </div>
      )}

      {/* Блок с фильтрами и информацией о тендере */}
      <div style={{ padding: '16px', display: 'flex', gap: '8px', flexDirection: isPhoneDevice ? 'column' : 'row' }}>
        {/* Левый и средний блоки объединены */}
        <Card
          bordered={false}
          bodyStyle={{ padding: '16px' }}
          style={{ borderRadius: '8px', flex: 1 }}
        >
          <Row gutter={8}>
            {/* Левый блок: Фильтры */}
            <Col xs={24} lg={9}>
              <Row gutter={8}>
                <Col span={16}>
                  <Text strong style={{ color: currentTheme === 'dark' ? '#fff' : '#000', fontSize: 14 }}>Тендер:</Text>
                  <Select
                    style={{ width: '100%', marginTop: 6 }}
                    placeholder="Выберите тендер..."
                    value={selectedTenderTitle}
                    onChange={onTenderTitleChange}
                    options={tenderTitles}
                    showSearch
                    filterOption={(input, option) =>
                      (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </Col>
                <Col span={8}>
                  <Text strong style={{ color: currentTheme === 'dark' ? '#fff' : '#000', fontSize: 14 }}>Версия:</Text>
                  <Select
                    style={{ width: '100%', marginTop: 6 }}
                    placeholder="Выберите..."
                    disabled={!selectedTenderTitle}
                    value={selectedVersion}
                    onChange={onVersionChange}
                    options={versions}
                  />
                </Col>
              </Row>
            </Col>

            {/* Средний блок: Информация о тендере */}
            <Col xs={24} lg={15}>
              {selectedTender ? (
                <div style={{ textAlign: 'right' }}>
                  {/* Строка 1: Название и заказчик */}
                  <div style={{ marginBottom: 4, fontSize: 14 }}>
                    <Text strong style={{ color: currentTheme === 'dark' ? '#fff' : '#000' }}>Название: </Text>
                    <Text style={{ color: currentTheme === 'dark' ? '#fff' : '#000' }}>{selectedTender.title}</Text>
                    <Divider type="vertical" style={{ borderColor: currentTheme === 'dark' ? '#444' : '#d9d9d9' }} />
                    <Text strong style={{ color: currentTheme === 'dark' ? '#fff' : '#000' }}>Заказчик: </Text>
                    <Text style={{ color: currentTheme === 'dark' ? '#fff' : '#000' }}>{selectedTender.client_name}</Text>
                  </div>

                  {/* Строка 2: Площади */}
                  <FitOneLine enabled={isPhone} baseFontSize={isPhone ? 11 : 14} minFontSize={5} style={{ marginBottom: 4 }}>
                    <span style={{ whiteSpace: 'nowrap' }}>
                      <Text style={{ color: currentTheme === 'dark' ? '#fff' : '#000' }}>Площадь по СП: </Text>
                      <Text strong style={{ color: '#10b981' }}>{selectedTender.area_sp?.toLocaleString('ru-RU') || '0'} м²</Text>
                    </span>
                    <Divider type="vertical" style={{ margin: '0 4px', borderColor: currentTheme === 'dark' ? '#444' : '#d9d9d9' }} />
                    <span style={{ whiteSpace: 'nowrap' }}>
                      <Text style={{ color: currentTheme === 'dark' ? '#fff' : '#000' }}>Площадь Заказчика: </Text>
                      <Text strong style={{ color: '#10b981' }}>{selectedTender.area_client?.toLocaleString('ru-RU') || '0'} м²</Text>
                    </span>
                  </FitOneLine>

                  {/* Строка 3: Курсы валют */}
                  <FitOneLine enabled={isPhone} baseFontSize={isPhone ? 10 : 14} minFontSize={5} style={{ marginBottom: 4 }}>
                    <Text strong style={{ color: '#10b981' }}>Курс USD: </Text>
                    <Text style={{ color: currentTheme === 'dark' ? '#fff' : '#000' }}>{selectedTender.usd_rate?.toFixed(2) || '0.00'} Р/$</Text>
                    <Divider type="vertical" style={{ margin: '0 4px', borderColor: currentTheme === 'dark' ? '#444' : '#d9d9d9' }} />
                    <Text strong style={{ color: '#10b981' }}>Курс EUR: </Text>
                    <Text style={{ color: currentTheme === 'dark' ? '#fff' : '#000' }}>{selectedTender.eur_rate?.toFixed(2) || '0.00'} Р/€</Text>
                    <Divider type="vertical" style={{ margin: '0 4px', borderColor: currentTheme === 'dark' ? '#444' : '#d9d9d9' }} />
                    <Text strong style={{ color: '#10b981' }}>Курс CNY: </Text>
                    <Text style={{ color: currentTheme === 'dark' ? '#fff' : '#000' }}>{selectedTender.cny_rate?.toFixed(2) || '0.00'} Р/¥</Text>
                  </FitOneLine>

                  {/* Строка 4: Кнопки */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Space wrap size="small">
                      {selectedTender.upload_folder && (
                        <Button
                          icon={<LinkOutlined />}
                          href={selectedTender.upload_folder}
                          target="_blank"
                          size="small"
                        >
                          Папка КП
                        </Button>
                      )}
                      {selectedTender.bsm_link && (
                        <Button
                          icon={<FileTextOutlined />}
                          href={selectedTender.bsm_link}
                          target="_blank"
                          size="small"
                        >
                          БСМ
                        </Button>
                      )}
                      {selectedTender.tz_link && (
                        <Button
                          icon={<FileTextOutlined />}
                          href={selectedTender.tz_link}
                          target="_blank"
                          size="small"
                        >
                          Уточнение ТЗ
                        </Button>
                      )}
                      {selectedTender.qa_form_link && (
                        <Button
                          icon={<QuestionCircleOutlined />}
                          href={selectedTender.qa_form_link}
                          target="_blank"
                          size="small"
                        >
                          Вопросы
                        </Button>
                      )}
                      {selectedTender.project_folder_link && (
                        <Button
                          icon={<FolderOutlined />}
                          href={selectedTender.project_folder_link}
                          target="_blank"
                          size="small"
                        >
                          Папка с проектом
                        </Button>
                      )}
                    </Space>
                  </div>
                </div>
              ) : (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: currentTheme === 'dark' ? '#666' : '#999'
                }}>
                  <Text style={{ fontSize: 14, color: currentTheme === 'dark' ? '#666' : '#999' }}>
                    Выберите тендер для отображения данных
                  </Text>
                </div>
              )}
            </Col>
          </Row>
        </Card>

        {/* Правый блок: Общая стоимость */}
        <Card
          bordered={false}
          bodyStyle={{ padding: '16px', display: 'flex', minHeight: isPhoneDevice ? '72px' : '120px' }}
          style={{ borderRadius: '8px', width: isPhoneDevice ? '100%' : '180px', flexShrink: 0 }}
        >
          {selectedTender ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <div style={{ fontSize: 14, color: currentTheme === 'dark' ? 'rgba(255, 255, 255, 0.65)' : 'rgba(0, 0, 0, 0.65)', lineHeight: '28px' }}>
                Общая стоимость
              </div>
              <div style={{ fontSize: 23, fontWeight: 600, color: currentTheme === 'dark' ? '#52c41a' : '#389e0d', letterSpacing: '0.5px', lineHeight: '26px' }}>
                {Math.round(totalSum).toLocaleString('ru-RU')}
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
};
