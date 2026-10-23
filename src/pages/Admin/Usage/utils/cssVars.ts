import type { CSSProperties } from 'react';
import type { GlobalToken } from 'antd';

/** Токены antd → CSS-переменные для Usage.module.css (обе темы). */
export const getUsageCssVars = (token: GlobalToken): CSSProperties =>
  ({
    '--usage-bg': token.colorBgContainer,
    '--usage-text': token.colorText,
    '--usage-muted': token.colorTextSecondary,
    '--usage-border': token.colorBorderSecondary,
    '--usage-accent': token.colorPrimary,
    '--usage-empty': token.colorFillQuaternary,
    '--usage-head-bg': token.colorFillAlter,
    '--usage-warn': token.colorWarning,
    '--usage-warn-bg': token.colorWarningBg,
    '--usage-radius': `${token.borderRadiusLG}px`,
  }) as CSSProperties;
