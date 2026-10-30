import type { CSSProperties } from 'react';
import type { GlobalToken } from 'antd';

/** Токены antd → CSS-переменные модуля AnalogPicker (динамические значения темы). */
export const getAnalogCssVars = (token: GlobalToken): CSSProperties =>
  ({
    '--apn-bg': token.colorBgContainer,
    '--apn-fill': token.colorFillQuaternary,
    '--apn-fill-solid': token.colorBgLayout,
    '--apn-text': token.colorText,
    '--apn-muted': token.colorTextSecondary,
    '--apn-border': token.colorBorderSecondary,
    '--apn-accent': token.colorPrimary,
    '--apn-warning': token.colorWarning,
    '--apn-info-bg': token.colorInfoBg,
    '--apn-radius': `${token.borderRadiusLG}px`,
  }) as CSSProperties;
