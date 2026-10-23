import type { CSSProperties } from 'react';
import type { GlobalToken } from 'antd';

/** Токены antd → CSS-переменные для модулей страницы «Объекты» (динамические значения темы). */
export const getObjectsCssVars = (token: GlobalToken): CSSProperties =>
  ({
    '--obj-bg': token.colorBgContainer,
    '--obj-bg-elevated': token.colorBgElevated,
    '--obj-fill': token.colorFillQuaternary,
    '--obj-fill-strong': token.colorFillTertiary,
    '--obj-text': token.colorText,
    '--obj-muted': token.colorTextSecondary,
    '--obj-border': token.colorBorderSecondary,
    '--obj-border-strong': token.colorBorder,
    '--obj-current': token.colorPrimary,
    '--obj-current-bg': token.colorPrimaryBg,
    '--obj-current-border': token.colorPrimaryBorder,
    '--obj-archive': token.colorInfo,
    '--obj-archive-bg': token.colorInfoBg,
    '--obj-archive-border': token.colorInfoBorder,
    '--obj-selected-bg': token.colorPrimaryBg,
    '--obj-shadow': token.boxShadowTertiary,
    '--obj-radius': `${token.borderRadiusLG}px`,
  }) as CSSProperties;
