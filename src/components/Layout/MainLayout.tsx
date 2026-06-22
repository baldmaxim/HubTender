import React, { useState, useEffect, useMemo } from 'react';
import { Layout, Menu, Avatar, Switch, theme, Dropdown, Typography, Tag, Button } from 'antd';
import type { MenuProps } from 'antd';
const { Text } = Typography;
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  SunOutlined,
  MoonOutlined,
} from '@ant-design/icons';
import { menuItems, MOBILE_HIDDEN_KEYS } from './menuItems';
import { CalculatorWidget } from './CalculatorWidget';
import { NotesWidget } from './NotesWidget';
import { NotificationsBell } from './NotificationsBell';
import PositionTabsBar from './PositionTabsBar';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { LogoIcon } from '../Icons';
import { IconSwap } from '../transitions';
import { type Notification } from '../../lib/supabase';
import { useRealtimeTopic } from '../../lib/realtime/useRealtimeTopic';
import { listNotifications, deleteAllNotifications } from '../../lib/api/notifications';
import { hasPageAccess, PAGE_LABELS } from '../../lib/supabase/types';
import { useIsMobile } from '../../hooks/useIsMobile';
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
  const navigate = useNavigate();
  const location = useLocation();
  const { isPhone, isLandscapePhone, isPhoneDevice, isMobile, screens } = useIsMobile();
  // «Мобильный» layout = <992px (телефон + планшет), как и переключение на карточный вид.
  const isMobileLayout = !screens.lg;

  // Название текущей страницы для шапки (на телефонах). /path → PAGE_LABELS,
  // c учётом параметрических роутов (паттерн как в hasPageAccess).
  const pageTitle = useMemo(() => {
    const path = location.pathname;
    if (PAGE_LABELS[path]) return PAGE_LABELS[path];
    const match = Object.keys(PAGE_LABELS).find(
      (p) => p.includes(':') && new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+') + '$').test(path)
    );
    return match ? PAGE_LABELS[match] : '';
  }, [location.pathname]);

  // На телефоне (<576px) автоматически сворачивать боковое меню в icon-режим,
  // освобождая место под контент. Планшет/десктоп не затрагиваем.
  useEffect(() => {
    if (isPhone) setCollapsed(true);
  }, [isPhone]);

  // tenderId доступен, когда пользователь находится на странице позиций заказчика
  const currentTenderId = location.pathname === '/positions'
    ? new URLSearchParams(location.search).get('tenderId')
    : null;
  const { theme: currentTheme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const isGeneralDirector = user?.role_code === 'general_director';
  const {
    token: { colorBgContainer },
  } = theme.useToken();

  // Native WS hub (Go BFF) — feeds notifications:<user_id> topic.
  useRealtimeTopic(
    user?.id ? `notifications:${user.id}` : null,
    () => fetchNotifications(),
  );

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    try {
      const rows = await listNotifications(50);
      setNotifications(rows as unknown as Notification[]);
      const unread = rows.filter((n) => !n.is_read).length;
      setUnreadCount(unread);
    } catch (error) {
      console.error('Ошибка загрузки уведомлений:', error);
    }
  };

  const clearAllNotifications = async () => {
    try {
      await deleteAllNotifications();
      setNotifications([]);
      setUnreadCount(0);
    } catch (error) {
      console.error('Ошибка очистки уведомлений:', error);
    }
  };

  const handleMenuClick: MenuProps['onClick'] = (e) => {
    // Предотвращаем навигацию только если это не клик по ссылке
    // (клик колесом обрабатывается браузером нативно через Link)
    if (e.domEvent && 'button' in e.domEvent && !e.domEvent.button) {
      e.domEvent.preventDefault();
      navigate(e.key);
      // На мобильных после выбора пункта сворачиваем меню, освобождая место под контент
      if (isMobileLayout) setCollapsed(true);
    }
  };

  // Функция для преобразования пунктов меню в ссылки
  type MenuItem = NonNullable<MenuProps['items']>[number];
  type MenuItemWithKey = Extract<MenuItem, { key?: React.Key }>;
  const renderMenuItem = (item: MenuItem) => {
    if (!item || item.type === 'divider') return null;
    const mi = item as MenuItemWithKey;
    // Если это группа (есть children), не рендерим как ссылку
    if ('children' in mi && mi.children) {
      return (mi as { label?: React.ReactNode }).label;
    }
    // Если есть key, рендерим как Link для поддержки открытия в новой вкладке
    const key = mi.key != null ? String(mi.key) : undefined;
    const label = (mi as { label?: React.ReactNode }).label;
    if (key && key.startsWith('/')) {
      return <Link to={key}>{label}</Link>;
    }
    return label;
  };

  // Преобразуем menuItems, добавляя label как функцию рендеринга
  const processedMenuItems = menuItems.map((item: MenuItem) => {
    if (item && 'children' in item && item.children) {
      return {
        ...item,
        children: (item.children as MenuItem[]).map((child: MenuItem) => ({
          ...child,
          label: child && child.type === 'divider' ? undefined : renderMenuItem(child),
        })),
      };
    }
    return {
      ...item,
      label: renderMenuItem(item),
    };
  });

  // Фильтруем меню на основе прав доступа пользователя
  const filterMenuByAccess = (items: MenuProps['items']): MenuProps['items'] => {
    if (!user) return items;
    if (!items) return items;

    return items
      .map((item) => {
        if (!item) return null;
        // Если у пункта есть дочерние элементы
        if ('children' in item && item.children) {
          const filteredChildren = (item.children as MenuItem[]).filter((child) => {
            if (!child) return false;
            // Пропускаем разделители
            if ('type' in child && child.type === 'divider') return true;
            // Проверяем доступ к дочернему пункту
            const key = 'key' in child ? String(child.key) : undefined;
            return key ? hasPageAccess(user, key) : true;
          });

          // Реальные доступные страницы (без разделителей)
          const accessiblePages = filteredChildren.filter(
            (child) => !(child && 'type' in child && child.type === 'divider')
          );

          // Нет доступных страниц — убираем группу целиком
          if (accessiblePages.length === 0) {
            return null;
          }

          // Доступна ровно одна страница — показываем прямую ссылку на неё,
          // без промежуточного раскрытия группы (убираем двойной переход)
          if (accessiblePages.length === 1) {
            return accessiblePages[0];
          }

          // Иначе оставляем родительский пункт с отфильтрованными детьми
          return {
            ...item,
            children: filteredChildren,
          };
        }

        // Для обычных пунктов проверяем доступ
        const itemKey = 'key' in item && item.key != null ? String(item.key) : undefined;
        return itemKey ? (hasPageAccess(user, itemKey) ? item : null) : item;
      })
      .filter((item): item is NonNullable<typeof item> => item != null);
  };

  // На телефонах (Android/iPhone) скрываем часть разделов из меню
  const filterMenuByDevice = (items: MenuProps['items']): MenuProps['items'] => {
    if (!isPhoneDevice || !items) return items;
    return items
      .map((item) => {
        if (!item) return null;
        // Обычный пункт — скрываем по ключу
        if (!('children' in item) || !item.children) {
          const key = 'key' in item && item.key != null ? String(item.key) : undefined;
          return key && MOBILE_HIDDEN_KEYS.has(key) ? null : item;
        }
        // Группа — отфильтровываем скрытые дочерние страницы
        const children = (item.children as MenuItem[]).filter((child) => {
          const key = child && 'key' in child ? String(child.key) : undefined;
          return !(key && MOBILE_HIDDEN_KEYS.has(key));
        });
        const realPages = children.filter(
          (c) => !(c && 'type' in c && c.type === 'divider')
        );
        if (realPages.length === 0) return null; // группа опустела — убираем целиком
        return { ...item, children };
      })
      .filter((item): item is NonNullable<typeof item> => item != null);
  };

  const filteredMenuItems = filterMenuByAccess(
    filterMenuByDevice(processedMenuItems as MenuProps['items'])
  );

  return (
    <Layout style={{ minHeight: '100vh', height: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        collapsedWidth={isMobileLayout ? 0 : 80}
        className={`sidebar-${currentTheme}`}
        style={{
          background: currentTheme === 'dark' ? '#0a0a0a' : '#fff',
          borderRight: currentTheme === 'light' ? '1px solid #f0f0f0' : 'none',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          // На телефоне меню всплывает поверх страницы (не сдвигает контент).
          ...(isMobile ? { position: 'fixed' as const, left: 0, top: 0, zIndex: 1000 } : {}),
        }}
        width={250}
      >
        <div
          className={`logo logo-${currentTheme} ${isPhoneDevice && !collapsed ? 'logo-phone' : ''}`}
          onClick={() => navigate('/dashboard')}
          style={{ cursor: 'pointer', flexShrink: 0 }}
        >
          {collapsed ? (
            <div className="logo-collapsed">
              <LogoIcon size={isPhone ? 32 : 80} color={currentTheme === 'dark' ? '#10b981' : '#ffffff'} />
            </div>
          ) : (
            <div className="logo-expanded">
              <div className="logo-icon-wrapper">
                <LogoIcon size={52} color={currentTheme === 'dark' ? '#10b981' : '#ffffff'} />
              </div>
              <div className="logo-text-wrapper">
                <div className="logo-title">TenderHUB</div>
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
            defaultOpenKeys={(() => {
              const p = location.pathname;
              if (['/library', '/library/templates', '/admin/nomenclatures', '/admin/construction_cost'].includes(p)) return ['library'];
              if (['/costs', '/bsm', '/projects'].includes(p) || p.startsWith('/analytics')) return ['analytics'];
              if (['/settings', '/admin/import-log', '/admin/insurance'].includes(p)) return ['settings-group'];
              if (p.startsWith('/admin')) return ['admin'];
              return [];
            })()}
            items={filteredMenuItems}
            onClick={handleMenuClick}
            style={{
              background: 'transparent',
              borderRight: 0,
            }}
          />
        </div>
      </Sider>
      {/* Затемнение под раскрытым оверлей-меню на телефоне */}
      {isMobile && !collapsed && (
        <div
          onClick={() => setCollapsed(true)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 999 }}
        />
      )}
      <Layout>
        <Header
          style={{
            padding: isPhone ? '0 12px' : '0 24px',
            background: currentTheme === 'dark' ? '#0a0a0a' : '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: currentTheme === 'light' ? '1px solid #e8e8e8' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <span
              className="trigger"
              onClick={() => setCollapsed(!collapsed)}
              style={{ cursor: 'pointer', fontSize: '18px', display: 'inline-flex' }}
            >
              <IconSwap
                state={collapsed ? 'b' : 'a'}
                iconA={<MenuFoldOutlined />}
                iconB={<MenuUnfoldOutlined />}
              />
            </span>
            {/* Название страницы вверху (телефоны, в т.ч. landscape) */}
            {(isMobile || isLandscapePhone) && pageTitle && (
              <Text
                strong
                style={{ fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {pageTitle}
              </Text>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: isPhone ? '12px' : '24px' }}>
            {/* Заметки к тендеру — скрыты для Генерального директора и на телефонах (вкл. landscape) */}
            {!isMobile && !isLandscapePhone && !isGeneralDirector && (
              <NotesWidget
                tenderId={currentTenderId}
                userId={user?.id ?? null}
                roleCode={user?.role_code ?? ''}
                currentTheme={currentTheme}
                isMobileLayout={isMobileLayout}
                isPhone={isPhone}
              />
            )}

            {/* Калькулятор — скрыт на телефонах (вкл. landscape) */}
            {!isMobile && !isLandscapePhone && <CalculatorWidget isMobileLayout={isMobileLayout} isPhone={isPhone} />}

            {isMobile || isLandscapePhone ? (
              // На телефоне (любая ориентация) — компактная кнопка-переключатель темы, без ярлыков.
              <Button
                type="text"
                onClick={toggleTheme}
                aria-label="Сменить тему"
                icon={
                  currentTheme === 'dark'
                    ? <MoonOutlined style={{ fontSize: 18, color: '#10b981' }} />
                    : <SunOutlined style={{ fontSize: 18, color: '#faad14' }} />
                }
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <SunOutlined style={{ fontSize: '16px', color: currentTheme === 'light' ? '#faad14' : '#888' }} />
                <Switch
                  checked={currentTheme === 'dark'}
                  onChange={toggleTheme}
                  style={{ backgroundColor: currentTheme === 'dark' ? '#10b981' : '#ccc' }}
                />
                <MoonOutlined style={{ fontSize: '16px', color: currentTheme === 'dark' ? '#10b981' : '#888' }} />
              </div>
            )}

            {/* Уведомления — скрыты на телефонах через CSS (.app-header-bell), любая ориентация */}
            <span className="app-header-bell">
              <NotificationsBell
                notifications={notifications}
                unreadCount={unreadCount}
                currentTheme={currentTheme}
                onClear={clearAllNotifications}
              />
            </span>

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
                {!isPhoneDevice && <span>{user?.full_name || 'Пользователь'}</span>}
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
            // На телефоне убираем боковые отступы (контент до краёв экрана).
            padding: isMobile ? '8px 0' : 16,
            minHeight: 280,
            background: colorBgContainer,
            overflow: 'auto',
          }}
        >
          {location.pathname.startsWith('/positions') && <PositionTabsBar />}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
