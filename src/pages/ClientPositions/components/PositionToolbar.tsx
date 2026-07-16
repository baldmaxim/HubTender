import React from 'react';
import { Card, Select, Row, Col, Divider, Button, Space, Typography } from 'antd';
import {
  LinkOutlined,
  FileTextOutlined,
  QuestionCircleOutlined,
  FolderOutlined,
  DownOutlined,
  UpOutlined,
} from '@ant-design/icons';
import type { Tender } from '../../../lib/types';
import { useIsMobile } from '../../../hooks/useIsMobile';

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
  /** Телефон: показывать ярлык сворачивания сверху по центру. */
  collapsible?: boolean;
  /** Свёрнутое состояние: видимы только ярлык и фильтр (Тендер/Версия). */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onTenderTitleChange: (title: string) => void;
  onVersionChange: (version: number) => void;
}

export const PositionToolbar: React.FC<PositionToolbarProps> = ({
  selectedTender,
  selectedTenderTitle,
  selectedVersion,
  tenderTitles,
  versions,
  currentTheme,
  totalSum,
  collapsible = false,
  collapsed = false,
  onToggleCollapsed,
  onTenderTitleChange,
  onVersionChange,
}) => {
  const { isPhoneDevice, isPhone } = useIsMobile();

  const txt: React.CSSProperties = { color: currentTheme === 'dark' ? '#fff' : '#000' };
  const green: React.CSSProperties = { color: '#10b981' };
  const vDivider = (
    <Divider type="vertical" style={{ margin: '0 4px', borderColor: currentTheme === 'dark' ? '#444' : '#d9d9d9' }} />
  );
  // Десктоп: одна строка справа с разделителями (как раньше).
  const deskRow: React.CSSProperties = { marginBottom: 4, fontSize: 14 };
  // Телефон: читаемый 12px. Перебиваем глобальное правило Settings.css
  // `.ant-typography { font-size: var(--font-size-base) }` (без !important),
  // локально опуская переменную — иначе AntD <Text> остаётся 14px (правило задаёт
  // размер прямо на элементе, и унаследованный от родителя fontSize проигрывает).
  // whiteSpace на строке не фиксируем: при разрастании числа сработает перенос
  // вместо обрезки справа (nowrap оставлен на самих чанках — значение не рвётся).
  const phoneMetricRow = {
    marginBottom: 4,
    fontSize: 12, // для разделителей (.ant-divider не в списке Settings.css)
    '--font-size-base': '12px', // двигает font-size у вложенных .ant-typography
  } as React.CSSProperties;
  // Телефон читаемо укладывается в рамку за счёт сокращения подписей:
  // «Площадь по СП» → «S СП», «Курс USD: … Р/$» → «USD: …» (запятая-разделитель).
  const rateFmt = (rate?: number) =>
    (rate ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Атомарные чанки «метрик»: nowrap, чтобы значение не рвалось посередине при переносе.
  // Рендерятся только при выбранном тендере; optional chaining — чтобы избежать null-доступа.
  const metrics = {
    areaSp: (
      <span style={{ whiteSpace: 'nowrap' }}>
        <Text style={txt}>{isPhone ? 'S СП: ' : 'Площадь по СП: '}</Text>
        <Text strong style={green}>{selectedTender?.area_sp?.toLocaleString('ru-RU') || '0'} м²</Text>
      </span>
    ),
    areaClient: (
      <span style={{ whiteSpace: 'nowrap' }}>
        <Text style={txt}>{isPhone ? 'S Заказчика: ' : 'Площадь Заказчика: '}</Text>
        <Text strong style={green}>{selectedTender?.area_client?.toLocaleString('ru-RU') || '0'} м²</Text>
      </span>
    ),
    rateUsd: (
      <span style={{ whiteSpace: 'nowrap' }}>
        <Text strong style={green}>{isPhone ? 'USD: ' : 'Курс USD: '}</Text>
        <Text style={txt}>{isPhone ? rateFmt(selectedTender?.usd_rate) : `${selectedTender?.usd_rate?.toFixed(2) || '0.00'} Р/$`}</Text>
      </span>
    ),
    rateEur: (
      <span style={{ whiteSpace: 'nowrap' }}>
        <Text strong style={green}>{isPhone ? 'EUR: ' : 'Курс EUR: '}</Text>
        <Text style={txt}>{isPhone ? rateFmt(selectedTender?.eur_rate) : `${selectedTender?.eur_rate?.toFixed(2) || '0.00'} Р/€`}</Text>
      </span>
    ),
    rateCny: (
      <span style={{ whiteSpace: 'nowrap' }}>
        <Text strong style={green}>{isPhone ? 'CNY: ' : 'Курс CNY: '}</Text>
        <Text style={txt}>{isPhone ? rateFmt(selectedTender?.cny_rate) : `${selectedTender?.cny_rate?.toFixed(2) || '0.00'} Р/¥`}</Text>
      </span>
    ),
  };

  return (
    <>
      {/* Ярлык сворачивания — сверху по центру шапки (телефон). */}
      {collapsible && (
        <div
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Развернуть шапку' : 'Свернуть шапку'}
          onClick={onToggleCollapsed}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleCollapsed?.();
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 22,
            cursor: 'pointer',
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 16,
            borderRadius: 8,
            background: 'rgba(255, 255, 255, 0.35)',
            color: '#fff',
            fontSize: 10,
            lineHeight: 1,
          }}>
            {collapsed ? <DownOutlined /> : <UpOutlined />}
          </div>
        </div>
      )}

      {/* Блок с фильтрами и информацией о тендере */}
      <div style={{
        padding: collapsed ? '0 12px 8px' : '8px 16px 16px 16px',
        display: 'flex',
        gap: '8px',
        flexDirection: isPhoneDevice ? 'column' : 'row',
      }}>
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
            {!collapsed && (
            <Col xs={24} lg={15}>
              {selectedTender ? (
                <div style={{ textAlign: isPhone ? 'center' : 'right' }}>
                  {/* Строка 1: Заказчик (на телефоне без названия тендера — оно
                      дублирует селект «Тендер» и съедает две строки) */}
                  <div style={{ marginBottom: 4, fontSize: isPhone ? 12 : 14 }}>
                    {!isPhone && (
                      <>
                        <Text strong style={txt}>Название: </Text>
                        <Text style={txt}>{selectedTender.title}</Text>
                        {vDivider}
                      </>
                    )}
                    <Text strong style={txt}>Заказчик: </Text>
                    <Text style={txt}>{selectedTender.client_name}</Text>
                  </div>

                  {/* Строка 2: Площади — телефон: одна строка слева, фикс. шрифт 5px (без автоподгонки) */}
                  {isPhone ? (
                    <div style={phoneMetricRow}>
                      {metrics.areaSp}{vDivider}{metrics.areaClient}
                    </div>
                  ) : (
                    <div style={deskRow}>{metrics.areaSp}{vDivider}{metrics.areaClient}</div>
                  )}

                  {/* Строка 3: Курсы валют — телефон: одна строка слева, фикс. шрифт 5px (без автоподгонки) */}
                  {isPhone ? (
                    <div style={phoneMetricRow}>
                      {metrics.rateUsd}{vDivider}{metrics.rateEur}{vDivider}{metrics.rateCny}
                    </div>
                  ) : (
                    <div style={deskRow}>{metrics.rateUsd}{vDivider}{metrics.rateEur}{vDivider}{metrics.rateCny}</div>
                  )}

                  {/* Строка 4: Кнопки */}
                  <div style={{ display: 'flex', justifyContent: isPhone ? 'flex-start' : 'flex-end' }}>
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
            )}
          </Row>
        </Card>

        {/* Правый блок: Общая стоимость */}
        {!collapsed && (
        <Card
          bordered={false}
          // Телефон (портрет и ландшафт): вертикаль ужата до минимума — padding 16→4,
          // minHeight снят, межстрочные интервалы прижаты к кеглю (было 28/26px «воздуха»
          // на шрифтах 14/23px). ~90px → ~48px, экран отдаём списку позиций.
          bodyStyle={{
            padding: isPhoneDevice ? '4px 12px' : '16px',
            display: 'flex',
            minHeight: isPhoneDevice ? 'auto' : '120px',
          }}
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
                gap: isPhoneDevice ? 0 : '4px',
              }}
            >
              <div style={{ fontSize: 14, color: currentTheme === 'dark' ? 'rgba(255, 255, 255, 0.65)' : 'rgba(0, 0, 0, 0.65)', lineHeight: isPhoneDevice ? '16px' : '28px' }}>
                Общая стоимость
              </div>
              <div style={{ fontSize: 23, fontWeight: 600, color: currentTheme === 'dark' ? '#52c41a' : '#389e0d', letterSpacing: '0.5px', lineHeight: isPhoneDevice ? '24px' : '26px' }}>
                {Math.round(totalSum).toLocaleString('ru-RU')}
              </div>
            </div>
          ) : null}
        </Card>
        )}
      </div>
    </>
  );
};
