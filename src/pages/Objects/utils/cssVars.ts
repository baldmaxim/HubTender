import type { CSSProperties } from 'react';
import type { GlobalToken } from 'antd';

/** Токены antd → CSS-переменные для Objects.module.css (динамические значения темы). */
export const getObjectsCssVars = (token: GlobalToken): CSSProperties =>
  ({
    '--obj-bg': token.colorBgContainer,
    '--obj-bg-elevated': token.colorBgElevated,
    '--obj-text': token.colorText,
    '--obj-muted': token.colorTextSecondary,
    '--obj-border': token.colorBorderSecondary,
    '--obj-current': token.colorPrimary,
    '--obj-archive': token.colorInfo,
    '--obj-selected-bg': token.colorPrimaryBg,
    '--obj-radius': `${token.borderRadiusLG}px`,
  }) as CSSProperties;
