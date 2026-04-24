import React, { useState, useEffect } from 'react';
import {
  Card,
  Typography,
  Select,
  Slider,
  Button,
  Space,
  Row,
  Col,
  Divider,
  message,
  InputNumber,
  Switch,
} from 'antd';
import {
  SettingOutlined,
  FontSizeOutlined,
  ReloadOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import { useTheme } from '../../contexts/ThemeContext';
import './Settings.css';

const { Title, Text, Paragraph } = Typography;

interface FontSettings {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  letterSpacing: number;
  compactMode: boolean;
}

// Конфигурация по умолчанию
const DEFAULT_FONT_SETTINGS: FontSettings = {
  fontSize: 14,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  lineHeight: 1.5715,
  letterSpacing: 0,
  compactMode: false,
};

// Доступные шрифты
const FONT_FAMILIES = [
  {
    label: 'Системный (по умолчанию)',
    value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  {
    label: 'Inter',
    value: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  {
    label: 'Roboto',
    value: 'Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  {
    label: 'Open Sans',
    value: '"Open Sans", -apple-system, BlinkMacSystemFont, sans-serif',
  },
  {
    label: 'Montserrat',
    value: 'Montserrat, -apple-system, BlinkMacSystemFont, sans-serif',
  },
  {
    label: 'PT Sans',
    value: '"PT Sans", -apple-system, BlinkMacSystemFont, sans-serif',
  },
  {
    label: 'Source Sans Pro',
    value: '"Source Sans Pro", -apple-system, BlinkMacSystemFont, sans-serif',
  },
  {
    label: 'Noto Sans',
    value: '"Noto Sans", -apple-system, BlinkMacSystemFont, sans-serif',
  },
  {
    label: 'Моноширинный',
    value: '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, monospace',
  },
];

const Settings: React.FC = () => {
  const { theme: currentTheme } = useTheme();
  const [fontSettings, setFontSettings] = useState<FontSettings>(DEFAULT_FONT_SETTINGS);
  const [hasChanges, setHasChanges] = useState(false);

  // Загрузка настроек из localStorage при монтировании
  useEffect(() => {
    const savedSettings = localStorage.getItem('tenderHub_fontSettings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setFontSettings(parsed);
        applyFontSettings(parsed);
      } catch (error) {
        console.error('Ошибка загрузки настроек:', error);
      }
    }
  }, []);

  // Проверка наличия изменений
  useEffect(() => {
    const savedSettings = localStorage.getItem('tenderHub_fontSettings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setHasChanges(JSON.stringify(parsed) !== JSON.stringify(fontSettings));
      } catch {
        setHasChanges(true);
      }
    } else {
      setHasChanges(JSON.stringify(DEFAULT_FONT_SETTINGS) !== JSON.stringify(fontSettings));
    }
  }, [fontSettings]);

  // Применение настроек шрифта к документу
  const applyFontSettings = (settings: FontSettings) => {
    const root = document.documentElement;

    // Базовый размер шрифта
    root.style.setProperty('--font-size-base', `${settings.fontSize}px`);

    // Вычисляем размеры для разных уровней
    root.style.setProperty('--font-size-sm', `${settings.fontSize - 2}px`);
    root.style.setProperty('--font-size-lg', `${settings.fontSize + 2}px`);
    root.style.setProperty('--font-size-xl', `${settings.fontSize + 4}px`);
    root.style.setProperty('--font-size-xxl', `${settings.fontSize + 6}px`);

    // Семейство шрифтов
    root.style.setProperty('--font-family', settings.fontFamily);

    // Высота строки
    root.style.setProperty('--line-height-base', `${settings.lineHeight}`);

    // Межбуквенное расстояние
    root.style.setProperty('--letter-spacing', `${settings.letterSpacing}px`);

    // Компактный режим
    if (settings.compactMode) {
      root.classList.add('compact-mode');
    } else {
      root.classList.remove('compact-mode');
    }
  };

  // Обновление настроек
  const updateFontSettings = (key: keyof FontSettings, value: FontSettings[keyof FontSettings]) => {
    const newSettings = { ...fontSettings, [key]: value };
    setFontSettings(newSettings);
    applyFontSettings(newSettings);
  };

  // Сохранение настроек
  const saveSettings = () => {
    localStorage.setItem('tenderHub_fontSettings', JSON.stringify(fontSettings));
    message.success('Настройки сохранены');
    setHasChanges(false);
  };

  // Сброс к настройкам по умолчанию
  const resetToDefaults = () => {
    setFontSettings(DEFAULT_FONT_SETTINGS);
    applyFontSettings(DEFAULT_FONT_SETTINGS);
    localStorage.removeItem('tenderHub_fontSettings');
    message.info('Настройки сброшены к значениям по умолчанию');
    setHasChanges(false);
  };

  // Загрузка внешних шрифтов
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Roboto:wght@300;400;500;700&family=Open+Sans:wght@300;400;500;600;700&family=Montserrat:wght@300;400;500;600;700&family=PT+Sans:wght@400;700&family=Source+Sans+Pro:wght@300;400;600;700&family=Noto+Sans:wght@300;400;500;600;700&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);

    return () => {
      document.head.removeChild(link);
    };
  }, []);

  return (
    <div className={`settings-container ${currentTheme}`}>
      <div className="settings-header">
        <Title level={2}>
          <SettingOutlined /> Настройки
        </Title>
        <Text type="secondary">Настройте внешний вид приложения под себя</Text>
      </div>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={16}>
          <Card
            bordered={false}
            title={
              <Space>
                <FontSizeOutlined />
                <span>Настройки шрифта</span>
              </Space>
            }
            className="settings-card"
          >
            {/* Тип шрифта */}
            <div className="setting-item">
              <div className="setting-label">
                <Text strong>Семейство шрифта</Text>
                <Text type="secondary" className="setting-description">
                  Выберите шрифт для всего интерфейса
                </Text>
              </div>
              <Select
                value={fontSettings.fontFamily}
                onChange={(value) => updateFontSettings('fontFamily', value)}
                options={FONT_FAMILIES}
                style={{ width: '100%', maxWidth: 400 }}
                placeholder="Выберите шрифт"
              />
            </div>

            <Divider />

            {/* Размер шрифта */}
            <div className="setting-item">
              <div className="setting-label">
                <Text strong>Размер шрифта</Text>
                <Text type="secondary" className="setting-description">
                  Базовый размер текста в пикселях
                </Text>
              </div>
              <div style={{ maxWidth: 400 }}>
                <Row gutter={16} align="middle">
                  <Col flex="auto">
                    <Slider
                      min={10}
                      max={20}
                      value={fontSettings.fontSize}
                      onChange={(value) => updateFontSettings('fontSize', value)}
                      marks={{
                        10: '10px',
                        12: '12px',
                        14: '14px',
                        16: '16px',
                        18: '18px',
                        20: '20px',
                      }}
                    />
                  </Col>
                  <Col>
                    <InputNumber
                      min={10}
                      max={20}
                      value={fontSettings.fontSize}
                      onChange={(value) => updateFontSettings('fontSize', value)}
                      formatter={(value) => `${value}px`}
                      parser={(value) => parseInt(value?.replace('px', '') || '14')}
                      style={{ width: 80 }}
                    />
                  </Col>
                </Row>
              </div>
            </div>

            <Divider />

            {/* Высота строки */}
            <div className="setting-item">
              <div className="setting-label">
                <Text strong>Высота строки</Text>
                <Text type="secondary" className="setting-description">
                  Расстояние между строками текста
                </Text>
              </div>
              <div style={{ maxWidth: 400 }}>
                <Row gutter={16} align="middle">
                  <Col flex="auto">
                    <Slider
                      min={1.2}
                      max={2}
                      step={0.05}
                      value={fontSettings.lineHeight}
                      onChange={(value) => updateFontSettings('lineHeight', value)}
                      marks={{
                        1.2: '1.2',
                        1.5: '1.5',
                        1.75: '1.75',
                        2: '2.0',
                      }}
                    />
                  </Col>
                  <Col>
                    <InputNumber
                      min={1.2}
                      max={2}
                      step={0.05}
                      value={fontSettings.lineHeight}
                      onChange={(value) => updateFontSettings('lineHeight', value)}
                      style={{ width: 80 }}
                    />
                  </Col>
                </Row>
              </div>
            </div>

            <Divider />

            {/* Межбуквенное расстояние */}
            <div className="setting-item">
              <div className="setting-label">
                <Text strong>Межбуквенное расстояние</Text>
                <Text type="secondary" className="setting-description">
                  Расстояние между символами (letter-spacing)
                </Text>
              </div>
              <div style={{ maxWidth: 400 }}>
                <Row gutter={16} align="middle">
                  <Col flex="auto">
                    <Slider
                      min={-0.5}
                      max={2}
                      step={0.1}
                      value={fontSettings.letterSpacing}
                      onChange={(value) => updateFontSettings('letterSpacing', value)}
                      marks={{
                        '-0.5': '-0.5px',
                        0: '0',
                        0.5: '0.5px',
                        1: '1px',
                        2: '2px',
                      }}
                    />
                  </Col>
                  <Col>
                    <InputNumber
                      min={-0.5}
                      max={2}
                      step={0.1}
                      value={fontSettings.letterSpacing}
                      onChange={(value) => updateFontSettings('letterSpacing', value)}
                      formatter={(value) => `${value}px`}
                      parser={(value) => parseFloat(value?.replace('px', '') || '0')}
                      style={{ width: 80 }}
                    />
                  </Col>
                </Row>
              </div>
            </div>

            <Divider />

            {/* Компактный режим */}
            <div className="setting-item">
              <div className="setting-label">
                <Text strong>Компактный режим</Text>
                <Text type="secondary" className="setting-description">
                  Уменьшить отступы и сделать интерфейс более плотным
                </Text>
              </div>
              <Switch
                checked={fontSettings.compactMode}
                onChange={(value) => updateFontSettings('compactMode', value)}
              />
            </div>

            <Divider />

            {/* Кнопки действий */}
            <div className="settings-actions">
              <Space>
                <Button
                  type="primary"
                  icon={<CheckOutlined />}
                  onClick={saveSettings}
                  disabled={!hasChanges}
                >
                  Сохранить изменения
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={resetToDefaults}
                >
                  Сбросить к настройкам по умолчанию
                </Button>
              </Space>
              {hasChanges && (
                <Text type="warning" style={{ marginLeft: 16 }}>
                  Есть несохраненные изменения
                </Text>
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card bordered={false} title="Предпросмотр" className="settings-preview">
            <Title level={3}>Заголовок третьего уровня</Title>
            <Title level={4}>Заголовок четвертого уровня</Title>
            <Paragraph>
              Это пример обычного текста с текущими настройками шрифта.
              Здесь вы можете увидеть, как будет выглядеть текст в приложении
              с выбранными параметрами.
            </Paragraph>
            <Paragraph>
              <Text strong>Жирный текст</Text> и <Text type="secondary">вторичный текст</Text>
              {' '}также адаптируются под ваши настройки.
              <Text code>Моноширинный текст</Text> остается неизменным.
            </Paragraph>
            <ul>
              <li>Первый пункт списка</li>
              <li>Второй пункт списка</li>
              <li>Третий пункт списка</li>
            </ul>
          </Card>

          <Card
            bordered={false}
            title="Текущие настройки"
            className="settings-current"
            style={{ marginTop: 24 }}
          >
            <div className="current-settings-list">
              <div className="current-setting">
                <Text type="secondary">Размер:</Text>
                <Text strong>{fontSettings.fontSize}px</Text>
              </div>
              <div className="current-setting">
                <Text type="secondary">Шрифт:</Text>
                <Text strong>
                  {FONT_FAMILIES.find(f => f.value === fontSettings.fontFamily)?.label || 'Системный'}
                </Text>
              </div>
              <div className="current-setting">
                <Text type="secondary">Высота строки:</Text>
                <Text strong>{fontSettings.lineHeight}</Text>
              </div>
              <div className="current-setting">
                <Text type="secondary">Межбуквенный интервал:</Text>
                <Text strong>{fontSettings.letterSpacing}px</Text>
              </div>
              <div className="current-setting">
                <Text type="secondary">Компактный режим:</Text>
                <Text strong>{fontSettings.compactMode ? 'Включен' : 'Выключен'}</Text>
              </div>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Settings;