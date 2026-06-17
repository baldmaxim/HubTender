import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { App, Button, ConfigProvider, Typography } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import './LandscapeOverlay.css';

const { Text } = Typography;

interface LandscapeOverlayProps {
  open: boolean;
  onClose: () => void;
  background?: string;
  children: React.ReactNode;
}

/**
 * Полноэкранный псевдо-ландшафт для телефонов: контент поворачивается на 90°
 * через CSS, пользователь физически поворачивает телефон. Настоящий поворот ОС
 * на iOS из браузера невозможен — это работает одинаково на iPhone и Android.
 *
 * Тултипы/message внутри уезжают в повёрнутый контейнер через getPopupContainer + App,
 * иначе AntD рендерит их в портретный document.body и они «отрываются» от графика.
 */
export const LandscapeOverlay: React.FC<LandscapeOverlayProps> = ({
  open,
  onClose,
  background = '#000',
  children,
}) => {
  // callback-ref в state: гарантирует ре-рендер после монтирования узла,
  // чтобы первый же тултип увидел непустой контейнер.
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Esc → закрыть
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // Блокировка скролла body на время оверлея
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Android hardware back → закрыть оверлей, а не уходить со страницы
    window.history.pushState({ landscapeOverlay: true }, '');
    const onPopState = () => onClose();
    window.addEventListener('popstate', onPopState);

    // Пнуть chart.js, чтобы холсты пересчитали размеры после поворота/раскладки
    const raf = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });

    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPopState);
      document.body.style.overflow = prevOverflow;
      cancelAnimationFrame(raf);
      // Снять history-state, добавленный при открытии (если ушли не через back)
      if (window.history.state?.landscapeOverlay) {
        window.history.back();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="landscape-overlay-root" style={{ background }}>
      <div ref={setNode} className="landscape-overlay-rot" style={{ background }}>
        <div className="landscape-overlay-bar" style={{ background }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Поверните телефон
          </Text>
          <Button icon={<CloseOutlined />} onClick={onClose} aria-label="Закрыть" autoFocus>
            Закрыть
          </Button>
        </div>
        <ConfigProvider getPopupContainer={() => node ?? document.body}>
          <App>{children}</App>
        </ConfigProvider>
      </div>
    </div>,
    document.body
  );
};

export default LandscapeOverlay;
