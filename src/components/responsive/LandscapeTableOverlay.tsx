import React from 'react';
import { useFitScale } from '../../hooks/useFitScale';

interface LandscapeTableOverlayProps {
  /** 'light' | 'dark' — фон оверлея, чтобы страница не просвечивала. */
  theme: string;
  /** Натуральная ширина контента (px), под которую считается масштаб. По умолчанию 1080. */
  width?: number;
  children: React.ReactNode;
}

/**
 * Полноэкранный оверлей таблицы для телефона в ландшафте: при повороте таблица
 * раскрывается поверх всего экрана с минимальными полями, масштаб подбирается так,
 * чтобы все колонки и строки влезли без прокрутки. Закрытия не нужно — оверлей
 * завязан на isLandscapePhone и сам исчезает при повороте в портрет.
 *
 * Применять только к read-only-вариантам таблиц (без scroll и без fixed-колонок —
 * они ломаются под transform:scale).
 */
export const LandscapeTableOverlay: React.FC<LandscapeTableOverlayProps> = ({
  theme,
  width = 1080,
  children,
}) => {
  const { outerRef, innerRef, scale } = useFitScale();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: theme === 'dark' ? '#1f1f1f' : '#ffffff',
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
