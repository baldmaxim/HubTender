import React, { useEffect, useState } from 'react';
import { useFitScale } from '../../hooks/useFitScale';

interface LandscapeTableOverlayProps {
  /** 'light' | 'dark' — фон оверлея, чтобы страница не просвечивала. */
  theme: string;
  /** Натуральная ширина контента (px), под которую считается масштаб. По умолчанию 1080. */
  width?: number;
  /**
   * Режим вписывания:
   * - 'contain' (по умолчанию): масштаб по min(ширина, высота) — таблица целиком без скролла.
   * - 'width': масштаб только по ширине; строки, не влезающие по высоте, скроллятся вертикально.
   * - 'zoom': масштаб по ИЗВЕСТНОЙ ширине `width` через CSS `zoom` (а не transform:scale).
   *   Контент раскладывается в обычном потоке → нет одного гигантского композитного слоя,
   *   поэтому большие таблицы (тысячи строк) не дают чёрный экран на мобильных GPU.
   *   Вертикальный скролл — нативный. Замеров нет → нет петли ResizeObserver.
   */
  fit?: 'contain' | 'width' | 'zoom';
  /** Закреплённая полоса под скроллом (вне scale), видна всегда. Для fit='width' и fit='zoom'. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Полноэкранный оверлей таблицы для телефона в ландшафте: при повороте таблица
 * раскрывается поверх всего экрана с минимальными полями.
 *
 * - fit='contain': масштаб подбирается так, чтобы все колонки и строки влезли без прокрутки.
 * - fit='width': колонки вписываются по ширине экрана, строки прокручиваются вертикально,
 *   опциональный footer закреплён снизу (например, сводная строка «Итого»).
 *
 * Закрытия не нужно — оверлей завязан на isLandscapePhone и сам исчезает при повороте
 * в портрет. Применять только к read-only-вариантам таблиц (без scroll и без fixed-колонок —
 * они ломаются под transform:scale).
 */
export const LandscapeTableOverlay: React.FC<LandscapeTableOverlayProps> = ({
  theme,
  width = 1080,
  fit = 'contain',
  footer,
  children,
}) => {
  const { outerRef, innerRef, scale, natW, natH } = useFitScale(fit === 'width' ? 'width' : 'both');
  const background = theme === 'dark' ? '#1f1f1f' : '#ffffff';

  // Реактивная ширина окна для режима 'zoom' (известная ширина контента → фактор без замеров).
  const [availW, setAvailW] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : width,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Поворот шлёт пачку resize-событий — коалесим в один кадр (rAF), один setState.
    let frame = 0;
    const apply = () => {
      frame = 0;
      setAvailW(window.innerWidth);
    };
    const onChange = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };
    window.addEventListener('resize', onChange);
    window.addEventListener('orientationchange', onChange);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('orientationchange', onChange);
    };
  }, []);

  if (fit === 'zoom') {
    const PAD = 4;
    const zoom = Math.min((availW - PAD * 2) / width, 1);
    // Фон закреплённой шапки (непрозрачный, отдельно от фона тела).
    const headBg = theme === 'dark' ? '#1d1d1d' : '#fafafa';
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1100,
          background,
          padding: PAD,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <style>{`
          .lto-fit-zoom .ant-table.ant-table-small .ant-table-cell { padding: 2px 4px; }
          /* Скролл-контейнер — внутренний блок ниже: снимаем overflow у обёрток AntD,
             иначе sticky-шапка прилипнет к нескроллящейся обёртке. */
          .lto-fit-zoom .ant-table,
          .lto-fit-zoom .ant-table-container,
          .lto-fit-zoom .ant-table-content { overflow: visible; }
          /* Закрепляем шапку (обе строки сгруппированных заголовков) при скролле. */
          .lto-fit-zoom .ant-table-thead { position: sticky; top: 0; z-index: 11; }
          .lto-fit-zoom .ant-table-thead > tr > th { background: ${headBg}; }
        `}</style>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowX: 'hidden',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <div className="lto-fit-zoom" style={{ width, zoom: String(zoom) }}>
            {children}
          </div>
        </div>
        {footer && (
          <div
            style={{
              flex: '0 0 auto',
              borderTop: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
              background,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    );
  }

  if (fit === 'width') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1100,
          background,
          display: 'flex',
          flexDirection: 'column',
          padding: 4,
          overflow: 'hidden',
        }}
      >
        <style>{`
          .lto-fit-width .ant-table.ant-table-small .ant-table-cell { padding: 2px 4px; }
        `}</style>
        <div
          ref={outerRef}
          className="lto-fit-width"
          style={{
            flex: 1,
            minHeight: 0,
            width: '100%',
            // Полосу всегда резервируем (scroll, не auto) + stable-gutter — иначе
            // её появление/исчезновение меняет clientWidth и зацикливает ResizeObserver.
            overflowY: 'scroll',
            overflowX: 'hidden',
            scrollbarGutter: 'stable',
          }}
        >
          <div style={{ position: 'relative', width: natW * scale, height: natH * scale }}>
            <div
              ref={innerRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 'max-content',
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
            >
              {children}
            </div>
          </div>
        </div>
        {footer && (
          <div
            style={{
              flex: '0 0 auto',
              borderTop: `1px solid ${theme === 'dark' ? '#303030' : '#f0f0f0'}`,
              background,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 4,
        overflow: 'hidden',
      }}
    >
      <div
        ref={outerRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <div
          ref={innerRef}
          style={{
            width,
            flex: '0 0 auto',
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
