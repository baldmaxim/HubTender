import type { CSSProperties } from 'react';
import type { GlobalToken } from 'antd';

/** Токены antd → CSS-переменные модулей страницы (динамические значения темы). */
export const getReviewCssVars = (token: GlobalToken): CSSProperties =>
  ({
    '--apr-bg': token.colorBgContainer,
    '--apr-fill': token.colorFillQuaternary,
    '--apr-text': token.colorText,
    '--apr-muted': token.colorTextSecondary,
    '--apr-border': token.colorBorderSecondary,
    '--apr-selected': token.colorPrimaryBg,
    '--apr-changed': token.colorWarningBg,
    '--apr-changed-border': token.colorWarningBorder,
    '--apr-danger': token.colorError,
    '--apr-radius': `${token.borderRadiusLG}px`,
  }) as CSSProperties;
