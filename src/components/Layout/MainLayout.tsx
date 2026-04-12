import React, { useState, useEffect, useRef } from 'react';
import { Layout, Menu, Avatar, Badge, Switch, theme, Dropdown, List, Typography, Space, Empty, Button, Popover, Input, Tag } from 'antd';
import type { MenuProps } from 'antd';
const { Text } = Typography;
import {
  DashboardOutlined,
  ShoppingCartOutlined,
  CalculatorOutlined,
  BookOutlined,
  DollarOutlined,
  SettingOutlined,
  UserOutlined,
  BellOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  SunOutlined,
  MoonOutlined,
  ProfileOutlined,
  FileTextOutlined,
  BankOutlined,
  PercentageOutlined,
  CheckCircleOutlined,
  CheckSquareOutlined,
  InfoCircleOutlined,
  WarningOutlined,
  ClockCircleOutlined,
  BarChartOutlined,
  LineChartOutlined,
  DeleteOutlined,
  SwapOutlined,
  BuildOutlined,
  ImportOutlined,
  MessageOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { NotesPopoverContent } from './NotesPopover';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { LogoIcon } from '../Icons';
import { supabase, type Notification } from '../../lib/supabase';
import { hasPageAccess } from '../../lib/supabase/types';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ru';
import './MainLayout.css';

// Настройка dayjs для форматирования относительного времени на русском
dayjs.extend(relativeTime);
dayjs.locale('ru');

const { Header, Sider, Content } = Layout;

interface MainLayoutProps {
  children?: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [calcValue, setCalcValue] = useState('0');
  const [calcOpen, setCalcOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const calcInputRef = useRef<any>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // tenderId доступен, когда пользователь находится на странице позиций заказчика
  const currentTenderId = location.pathname === '/positions'
    ? new URLSearchParams(location.search).get('tenderId')
    : null;
  const { theme: currentTheme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const {
    token: { colorBgContainer },
  } = theme.useToken();

  // Загрузка уведомлений при монтировании компонента и подписка на изменения
  useEffect(() => {
    fetchNotifications();

    // Подписываемся на real-time обновления таблицы notifications
    const channel = supabase
      .channel('notifications-channel')
      .on(
        'postgres_changes',
        {
          event: '*', // Слушаем все события (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'notifications',
        },
        (payload) => {
          console.log('Получено изменение в уведомлениях:', payload);
          // Перезагружаем уведомления при любом изменении
          fetchNotifications();
        }
      )
      .subscribe();

    // Очистка подписки при размонтировании
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Функция для загрузки уведомлений из базы данных
  const fetchNotifications = async () => {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50); // Загружаем последние 50 уведомлений

      if (error) throw error;

      setNotifications(data || []);
      // Подсчитываем непрочитанные уведомления
      const unread = (data || []).filter(n => !n.is_read).length;
      setUnreadCount(unread);
    } catch (error) {
      console.error('Ошибка загрузки уведомлений:', error);
    }
  };

  // Функция для получения иконки по типу уведомления
  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'info':
        return <InfoCircleOutlined style={{ color: '#1890ff' }} />;
      case 'warning':
        return <WarningOutlined style={{ color: '#faad14' }} />;
      case 'pending':
        return <ClockCircleOutlined style={{ color: '#8c8c8c' }} />;
      default:
        return <InfoCircleOutlined style={{ color: '#1890ff' }} />;
    }
  };

  // Функция для очистки всех уведомлений
  const clearAllNotifications = async () => {
    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Удаляем все записи

      if (error) throw error;

      setNotifications([]);
      setUnreadCount(0);
    } catch (error) {
      console.error('Ошибка очистки уведомлений:', error);
    }
  };

  // Функция форматирования чисел с разрядами
  const formatCalcDisplay = (value: string): string => {
    // Разбиваем выражение на части (числа и операторы, включая ^ и sqrt)
    const parts = value.split(/([+\-*/()^]|sqrt)/);

    return parts.map(part => {
      // Пропускаем операторы и пустые строки
      if (/^[+\-*/()^]\s*$/.test(part) || part === '' || part === 'sqrt') return part;

      // Убираем существующие пробелы
      const clean = part.replace(/\s/g, '');

      // Проверяем, является ли это числом
      if (/^-?\d+,?\d*$/.test(clean)) {
        const [integer, decimal] = clean.split(',');
        // Форматируем целую часть с пробелами
        const formattedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        return decimal !== undefined ? `${formattedInteger},${decimal}` : formattedInteger;
      }

      return part;
    }).join('');
  };

  // Функции калькулятора
  const handleCalcClick = (value: string) => {
    if (value === '=') {
      try {
        // Убираем пробелы и заменяем запятые на точки для вычислений
        let evalValue = calcValue.replace(/\s/g, '').replace(/,/g, '.');
        // Заменяем ^ на ** для возведения в степень
        evalValue = evalValue.replace(/\^/g, '**');
        // Обрабатываем sqrt как функцию
        evalValue = evalValue.replace(/sqrt\(([^)]+)\)/g, 'Math.sqrt($1)');
        const result = eval(evalValue);
        const resultStr = String(result).replace('.', ',');
        setCalcValue(resultStr);
      } catch {
        setCalcValue('Ошибка');
      }
    }
  };

  const handleCalcInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    // Разрешаем цифры, операторы, запятую, ^, и буквы для sqrt
    if (/^[0-9+\-*/.(),^sqrtа-яА-ЯёЁ\s]*$/.test(newValue) || newValue === '') {
      // Убираем все пробелы для проверки
      const cleanValue = newValue.replace(/\s/g, '');
      const cleanCurrentValue = calcValue.replace(/\s/g, '');

      // Если текущее значение "0" и пользователь вводит что-то
      if (cleanCurrentValue === '0' && cleanValue.length > 0) {
        // Если новое значение начинается с цифры (не оператора)
        if (/^[0-9]/.test(cleanValue)) {
          // Убираем все начальные и конечные нули, кроме случая "0,"
          const withoutZero = cleanValue.replace(/^0+|0+$/g, '').replace(/^$/, '0');
          setCalcValue(withoutZero);
        } else {
          // Если начинается с оператора, сохраняем как есть
          setCalcValue(cleanValue);
        }
      } else {
        setCalcValue(newValue || '0');
      }
    }
  };

  // Обработка клавиатурных событий для калькулятора
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!calcOpen) return;

      const key = e.key;
      if (key === 'Enter') {
        e.preventDefault();
        handleCalcClick('=');
      } else if (key === 'Escape') {
        e.preventDefault();
        setCalcValue('0');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [calcOpen, calcValue]);

  const menuItems: MenuProps['items'] = [
    // {
    //   key: '/',
    //   icon: <HomeOutlined />,
    //   label: 'Главная',
    // },
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: 'Дашборд',
    },
    {
      key: 'tender-data-group',
      icon: <FileTextOutlined />,
      label: 'Данные по тендерам',
      children: [
        {
          key: '/tenders',
          icon: <FileTextOutlined />,
          label: 'Перечень тендеров',
        },
        {
          key: '/tender-timeline',
          icon: <ClockCircleOutlined />,
          label: 'Хронология расчёта',
        },
      ],
    },
    {
      key: '/tasks',
      icon: <CheckSquareOutlined />,
      label: 'Список задач',
    },
    {
      key: '/positions',
      icon: <ShoppingCartOutlined />,
      label: 'Позиции заказчика',
    },
    {
      key: 'commerce-group',
      icon: <DollarOutlined />,
      label: 'Коммерция',
      children: [
        {
          key: '/commerce/proposal',
          icon: <FileTextOutlined />,
          label: 'Форма КП',
        },
        {
          key: '/commerce/redistribution',
          icon: <SwapOutlined />,
          label: 'Перераспределение',
        },
      ],
    },
    {
      key: 'library',
      icon: <BookOutlined />,
      label: 'Библиотеки',
      children: [
        {
          key: '/library',
          icon: <BookOutlined />,
          label: 'Материалы и работы',
        },
        {
          key: '/library/templates',
          icon: <ProfileOutlined />,
          label: 'Шаблоны',
        },
      ],
    },
    {
      key: '/bsm',
      icon: <FileTextOutlined />,
      label: 'Базовая стоимость',
    },
    {
      key: '/costs',
      icon: <DollarOutlined />,
      label: 'Затраты на строительство',
    },
    {
      key: '/financial-indicators',
      icon: <BarChartOutlined />,
      label: 'Финансовые показатели',
    },
    {
      key: '/projects',
      icon: <BuildOutlined />,
      label: 'Текущие объекты',
    },
    {
      key: 'analytics',
      icon: <BarChartOutlined />,
      label: 'Аналитика',
      children: [
        {
          key: '/analytics/comparison',
          icon: <LineChartOutlined />,
          label: 'Сравнение объектов',
        },
      ],
    },
    {
      key: 'admin',
      icon: <SettingOutlined />,
      label: 'Администрирование',
      children: [
        {
          key: '/admin/nomenclatures',
          icon: <ProfileOutlined />,
          label: 'Номенклатуры',
        },
        {
          key: '/admin/tenders',
          icon: <FileTextOutlined />,
          label: 'Тендеры',
        },
        {
          key: '/admin/construction_cost',
          icon: <BankOutlined />,
          label: 'Справочник затрат',
        },
        {
          key: '/admin/markup',
          icon: <PercentageOutlined />,
          label: 'Проценты наценок',
        },
        {
          type: 'divider',
        },
        {
          key: '/admin/markup_constructor',
          icon: <PercentageOutlined />,
          label: 'Конструктор наценок',
        },
        {
          type: 'divider',
        },
        {
          key: '/admin/import-log',
          icon: <ImportOutlined />,
          label: 'Журнал импортов строк',
        },
        {
          type: 'divider',
        },
        {
          key: '/admin/insurance',
          icon: <SafetyCertificateOutlined />,
          label: 'Страхование от судимостей',
        },
      ],
    },
    {
      key: '/users',
      icon: <UserOutlined />,
      label: 'Пользователи',
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: 'Настройки',
    },
  ];

  const handleMenuClick: MenuProps['onClick'] = (e) => {
    // Предотвращаем навигацию только если это не клик по ссылке
    // (клик колесом обрабатывается браузером нативно через Link)
    if (e.domEvent && 'button' in e.domEvent && !e.domEvent.button) {
      e.domEvent.preventDefault();
      navigate(e.key);
    }
  };

  // Функция для преобразования пунктов меню в ссылки
  const renderMenuItem = (item: any) => {
    // Если это группа (есть children), не рендерим как ссылку
    if (item.children) {
      return item.label;
    }
    // Если есть key, рендерим как Link для поддержки открытия в новой вкладке
    if (item.key && item.key.startsWith('/')) {
      return <Link to={item.key}>{item.label}</Link>;
    }
    return item.label;
  };

  // Преобразуем menuItems, добавляя label как функцию рендеринга
  const processedMenuItems = menuItems.map((item: any) => {
    if (item.children) {
      return {
        ...item,
        children: item.children.map((child: any) => ({
          ...child,
          label: child.type === 'divider' ? undefined : renderMenuItem(child),
        })),
      };
    }
    return {
      ...item,
      label: renderMenuItem(item),
    };
  });

  // Фильтруем меню на основе прав доступа пользователя
  const filterMenuByAccess = (items: any[]): any[] => {
    if (!user) return items;

    return items
      .map((item: any) => {
        // Если у пункта есть дочерние элементы
        if (item.children) {
          const filteredChildren = item.children.filter((child: any) => {
            // Пропускаем разделители
            if (child.type === 'divider') return true;
            // Проверяем доступ к дочернему пункту
            return child.key ? hasPageAccess(user, child.key) : true;
          });

          // Проверяем, есть ли реальные страницы (не только разделители)
          const hasAccessiblePages = filteredChildren.some(
            (child: any) => child.type !== 'divider'
          );

          // Если после фильтрации остались доступные страницы, оставляем родительский пункт
          if (hasAccessiblePages) {
            return {
              ...item,
              children: filteredChildren,
            };
          }
          return null;
        }

        // Для обычных пунктов проверяем доступ
        return item.key ? (hasPageAccess(user, item.key) ? item : null) : item;
      })
      .filter(Boolean); // Убираем null элементы
  };

  const filteredMenuItems = filterMenuByAccess(processedMenuItems);

  return (
    <Layout style={{ minHeight: '100vh', height: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        className={`sidebar-${currentTheme}`}
        style={{
          background: currentTheme === 'dark' ? '#0a0a0a' : '#fff',
          borderRight: currentTheme === 'light' ? '1px solid #f0f0f0' : 'none',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
        }}
        width={250}
      >
        <div
          className={`logo logo-${currentTheme}`}
          onClick={() => navigate('/dashboard')}
          style={{ cursor: 'pointer', flexShrink: 0 }}
        >
          {collapsed ? (
            <div className="logo-collapsed">
              <LogoIcon size={80} color={currentTheme === 'dark' ? '#10b981' : '#ffffff'} />
            </div>
          ) : (
            <div className="logo-expanded">
              <div className="logo-icon-wrapper">
                <LogoIcon size={52} color={currentTheme === 'dark' ? '#10b981' : '#ffffff'} />
              </div>
              <div className="logo-text-wrapper">
                <div className="logo-title">TenderHUB</div>
                <div className="logo-subtitle">by SU_10</div>
              </div>
            </div>
          )}
        </div>
        <div
          className="sidebar-menu-container"
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <Menu
            theme={currentTheme}
            mode="inline"
            selectedKeys={[location.pathname]}
            defaultOpenKeys={
              location.pathname.startsWith('/admin') ? ['admin'] :
              location.pathname.startsWith('/library') ? ['library'] :
              location.pathname.startsWith('/analytics') ? ['analytics'] :
              []
            }
            items={filteredMenuItems}
            onClick={handleMenuClick}
            style={{
              background: 'transparent',
              borderRight: 0,
            }}
          />
        </div>
      </Sider>
      <Layout>
        <Header
          style={{
            padding: '0 24px',
            background: currentTheme === 'dark' ? '#0a0a0a' : '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: currentTheme === 'light' ? '1px solid #e8e8e8' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {React.createElement(collapsed ? MenuUnfoldOutlined : MenuFoldOutlined, {
              className: 'trigger',
              onClick: () => setCollapsed(!collapsed),
              style: {
                fontSize: '18px',
                cursor: 'pointer',
              },
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            {/* Заметки к тендеру */}
            <Popover
              content={
                <NotesPopoverContent
                  tenderId={currentTenderId}
                  userId={user?.id ?? null}
                  roleCode={user?.role_code ?? ''}
                  currentTheme={currentTheme}
                />
              }
              title="Заметки к тендеру"
              trigger="click"
              open={notesOpen}
              onOpenChange={setNotesOpen}
              placement="bottomRight"
              destroyOnHidden
            >
              <MessageOutlined
                style={{
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: currentTenderId ? '#10b981' : '#8c8c8c',
                  fontWeight: 'bold',
                }}
              />
            </Popover>

            {/* Калькулятор */}
            <Popover
              content={
                <div style={{ width: '300px' }}>
                  <Input
                    ref={calcInputRef}
                    value={formatCalcDisplay(calcValue)}
                    onChange={handleCalcInputChange}
                    placeholder="Введите выражение..."
                    style={{
                      marginBottom: '8px',
                      fontSize: '18px',
                      textAlign: 'right',
                      fontWeight: 'bold',
                    }}
                    onPressEnter={() => handleCalcClick('=')}
                  />
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>
                    Операции: +, -, *, /, ^(степень), sqrt(x)
                  </div>
                  <div style={{ fontSize: '11px', color: '#888' }}>
                    Enter — вычислить, Esc — очистить
                  </div>
                </div>
              }
              title="Калькулятор"
              trigger="click"
              open={calcOpen}
              onOpenChange={setCalcOpen}
              placement="bottomRight"
            >
              <CalculatorOutlined style={{ fontSize: '24px', cursor: 'pointer', color: '#1890ff', fontWeight: 'bold' }} />
            </Popover>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <SunOutlined style={{ fontSize: '16px', color: currentTheme === 'light' ? '#faad14' : '#888' }} />
              <Switch
                checked={currentTheme === 'dark'}
                onChange={toggleTheme}
                style={{ backgroundColor: currentTheme === 'dark' ? '#10b981' : '#ccc' }}
              />
              <MoonOutlined style={{ fontSize: '16px', color: currentTheme === 'dark' ? '#10b981' : '#888' }} />
            </div>

            <Dropdown
              popupRender={() => (
                <div
                  style={{
                    backgroundColor: currentTheme === 'dark' ? '#1f1f1f' : '#fff',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                    width: '400px',
                    maxHeight: '500px',
                    overflow: 'auto',
                  }}
                >
                  <div
                    style={{
                      padding: '16px',
                      borderBottom: currentTheme === 'dark' ? '1px solid #303030' : '1px solid #f0f0f0',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Text strong style={{ fontSize: '16px' }}>Уведомления</Text>
                    {notifications.length > 0 && (
                      <Button
                        size="small"
                        type="text"
                        icon={<DeleteOutlined />}
                        onClick={clearAllNotifications}
                        danger
                      >
                        Очистить
                      </Button>
                    )}
                  </div>
                  {notifications.length > 0 ? (
                    <List
                      dataSource={notifications}
                      renderItem={(item) => (
                        <List.Item
                          style={{
                            padding: '12px 16px',
                            borderBottom: currentTheme === 'dark' ? '1px solid #303030' : '1px solid #f0f0f0',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = currentTheme === 'dark' ? '#262626' : '#f5f5f5';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }}
                        >
                          <List.Item.Meta
                            avatar={getNotificationIcon(item.type)}
                            title={
                              <Space direction="vertical" size={0} style={{ width: '100%' }}>
                                <Text strong>{item.title}</Text>
                                <Text type="secondary" style={{ fontSize: '12px' }}>
                                  {dayjs(item.created_at).fromNow()}
                                </Text>
                              </Space>
                            }
                            description={
                              <Text style={{ fontSize: '13px', color: currentTheme === 'dark' ? '#d9d9d9' : '#595959' }}>
                                {item.message}
                              </Text>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="Нет уведомлений"
                      style={{ padding: '40px 0' }}
                    />
                  )}
                </div>
              )}
              trigger={['click']}
              placement="bottomRight"
            >
              <Badge count={unreadCount}>
                <BellOutlined style={{ fontSize: '18px', cursor: 'pointer' }} />
              </Badge>
            </Dropdown>

            <Dropdown
              menu={{
                items: [
                  {
                    key: 'profile',
                    label: (
                      <div style={{ padding: '8px 0' }}>
                        <div style={{ marginBottom: 4 }}>
                          <Text strong style={{ fontSize: 14 }}>{user?.full_name || 'Пользователь'}</Text>
                        </div>
                        <div style={{ marginBottom: 4 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>{user?.email}</Text>
                        </div>
                        <div>
                          <Tag
                            color={user?.role_color || 'default'}
                            style={{ margin: 0 }}
                          >
                            {user?.role}
                          </Tag>
                        </div>
                      </div>
                    ),
                    disabled: true,
                  },
                  {
                    type: 'divider',
                  },
                  {
                    key: 'logout',
                    label: 'Выйти',
                    icon: <LogoutOutlined />,
                    onClick: signOut,
                    danger: true,
                  },
                ],
              }}
              placement="bottomRight"
              trigger={['click']}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
                <span>{user?.full_name || 'Пользователь'}</span>
                <Avatar style={{
                  backgroundColor: user?.role_color ? `var(--ant-${user.role_color}-6, #10b981)` : '#10b981'
                }}>
                  {user?.full_name?.charAt(0).toUpperCase() || 'П'}
                </Avatar>
              </div>
            </Dropdown>
          </div>
        </Header>
        <Content
          style={{
            padding: 16,
            minHeight: 280,
            background: colorBgContainer,
            overflow: 'auto',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
