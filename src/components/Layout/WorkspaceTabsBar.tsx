import React, { startTransition } from 'react';
import { ConfigProvider, Tabs, theme } from 'antd';
import type { TabsProps } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import { useWorkspaceTabs } from '../../contexts/WorkspaceTabsContext';
import { resolveTabKey } from './workspacePages';
import { PAGE_LABELS } from '../../lib/types/types';
import { useTheme } from '../../contexts/ThemeContext';
import { useIsMobile } from '../../hooks/useIsMobile';

/**
 * Панель вкладок «рабочего стола»: по вкладке на каждую открытую страницу приложения
 * + по вкладке на каждую открытую позицию — все закрываемые (кроме единственной), в порядке
 * открытия. activeKey выводится ИЗ URL (источник истины). Рендерится в ШАПКЕ MainLayout
 * (через HeaderTitleOrTabs) на всех страницах — вместо названия страницы.
 * Подписи статических page-вкладок берутся из PAGE_LABELS в рендере (а не из хранимого title),
 * поэтому протухшие записи sessionStorage не влияют на отображение; у параметризованных
 * страниц (объект) подпись — сохранённый title (имя объекта).
 */
const WorkspaceTabsBar: React.FC = () => {
  const { tabs, closeTab } = useWorkspaceTabs();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme: currentTheme } = useTheme();
  const { token } = theme.useToken();
  const { isPhoneDevice } = useIsMobile();

  // Пока нет ни одной открытой вкладки — панель не показываем.
  if (tabs.length === 0) return null;

  // '' (а не undefined) на путях без вкладки: с undefined Tabs неуправляемый и подсветил бы первую.
  const activeKey = resolveTabKey(location.pathname) ?? '';

  const items: TabsProps['items'] = tabs.map((t) => ({
    key: t.key,
    label: t.kind === 'page' ? (PAGE_LABELS[t.key] ?? t.title) : t.title,
    // Последнюю вкладку не закрываем: пустая панель = пустая страница.
    closable: tabs.length > 1,
  }));

  const onChange = (key: string) => {
    const tab = tabs.find((t) => t.key === key);
    if (tab) navigate(tab.path);
  };

  const onEdit: TabsProps['onEdit'] = (targetKey, action) => {
    if (action !== 'remove' || typeof targetKey !== 'string') return;
    // Закрытие активной: уводим URL на соседнюю вкладку и убираем закрываемую В ОДНОМ коммите —
    // navigate у react-router идёт через startTransition, а голый closeTab (срочное обновление)
    // закоммитился бы первым, пока URL ещё на закрываемой вкладке (пустой кадр, а при lazy-чанке
    // соседней — пустой экран до его загрузки). replace: «Назад» не должно возвращать закрытую.
    if (targetKey === activeKey) {
      const idx = tabs.findIndex((t) => t.key === targetKey);
      const remaining = tabs.filter((t) => t.key !== targetKey);
      const next = remaining[idx - 1] ?? remaining[idx] ?? null;
      navigate(next ? next.path : '/dashboard', { replace: true });
    }
    startTransition(() => closeTab(targetKey));
  };

  return (
    <div className={`header-workspace-tabs header-workspace-tabs-${currentTheme}`}>
      <ConfigProvider
        theme={{
          components: {
            Tabs: {
              // Текст вкладок — цвет заголовка страницы (белый в dark), а не зелёный colorPrimary.
              itemSelectedColor: token.colorText,
              itemHoverColor: token.colorText,
              itemActiveColor: token.colorText,
              itemColor: token.colorTextSecondary,
              cardBg: 'transparent',
              // НЕ переопределять здесь colorBgContainer: токен утекает в «…»-дропдаун
              // скрытых вкладок (портал в body получает hashId nested-темы) и делает его
              // прозрачным. Подложка активной вкладки — в MainLayout.css.
              horizontalMargin: '0',
              // Телефон ловим хуком, а не media query: cssinjs-токен к @media не
              // привязать, а isPhoneDevice считает короткую сторону вьюпорта и
              // потому ловит ландшафтный телефон (ширина-брейкпоинты — нет).
              titleFontSizeSM: isPhoneDevice ? 11 : 16,
              cardGutter: 4,
            },
          },
        }}
      >
        <Tabs
          type="editable-card"
          hideAdd
          size="small"
          activeKey={activeKey}
          items={items}
          onChange={onChange}
          onEdit={onEdit}
        />
      </ConfigProvider>
    </div>
  );
};

export default WorkspaceTabsBar;
