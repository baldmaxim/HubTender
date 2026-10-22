import type { ThemeConfig } from 'antd';

export interface TenderMonitorPalette {
  pageBg: string;
  pageGlowPrimary: string;
  pageGlowSecondary: string;
  cardBg: string;
  cardBgAlt: string;
  sectionBg: string;
  panelBg: string;
  fieldBg: string;
  /** Рамка полей ввода: заметнее border, иначе поле теряется на фоне блока. */
  fieldBorder: string;
  border: string;
  borderSoft: string;
  text: string;
  textSecondary: string;
  muted: string;
  subtleText: string;
  title: string;
  warning: string;
  sent: string;
  warningBg: string;
  warningBorder: string;
  danger: string;
  dangerBg: string;
  dangerBorder: string;
  success: string;
  successStrong: string;
  info: string;
  /** «Ожидание ПД»: бейдж статуса и колонка канбана. */
  pending: string;
  marker: string;
  disabledBg: string;
  disabledText: string;
  tabBadgeBg: string;
  callPulseShadow: string;
  alertPulseShadow: string;
  alertPulseBorder: string;
  /** Ползунок прокрутки поверх фона темы. */
  scrollThumb: string;
  /** Тень всплывающей панели (выбор тендеров для удаления). */
  floatingShadow: string;
}

// mixHex переехал в общий src/utils/color.ts; ре-экспорт сохраняет 8 импортёров в Tenders зелёными.
export { mixHex } from '../../../utils/color';

export function getTenderMonitorPalette(isDark: boolean): TenderMonitorPalette {
  if (isDark) {
    return {
      pageBg: '#12141d',
      pageGlowPrimary: 'rgba(201, 168, 76, 0.14)',
      pageGlowSecondary: 'rgba(74, 144, 226, 0.10)',
      cardBg: '#202433',
      cardBgAlt: '#1e2130',
      sectionBg: '#0f1017',
      panelBg: '#1b1f2d',
      fieldBg: '#11141d',
      fieldBorder: 'rgba(255,255,255,0.14)',
      border: 'rgba(255,255,255,0.08)',
      borderSoft: 'rgba(255,255,255,0.06)',
      text: '#f5efe4',
      textSecondary: '#d8dbea',
      muted: '#8b93a7',
      subtleText: '#6f7589',
      title: '#f0c45a',
      warning: '#f0c45a',
      sent: '#ef9f27',
      warningBg: 'rgba(240,196,90,0.10)',
      warningBorder: 'rgba(240,196,90,0.24)',
      danger: '#e24b4a',
      dangerBg: 'rgba(226,75,74,0.10)',
      dangerBorder: 'rgba(226,75,74,0.34)',
      success: '#3db87a',
      successStrong: '#49d28c',
      info: '#4a90e2',
      pending: '#a78bfa',
      marker: '#ff4db8',
      disabledBg: 'rgba(255,255,255,0.05)',
      disabledText: '#5f6578',
      tabBadgeBg: '#222636',
      callPulseShadow: 'rgba(226, 75, 74, 0.08)',
      alertPulseShadow: 'rgba(226, 75, 74, 0.08)',
      alertPulseBorder: 'rgba(226, 75, 74, 0.28)',
      scrollThumb: 'rgba(255, 255, 255, 0.16)',
      floatingShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
    };
  }

  return {
    pageBg: '#f3f6fb',
    pageGlowPrimary: 'rgba(201, 168, 76, 0.10)',
    pageGlowSecondary: 'rgba(74, 144, 226, 0.08)',
    cardBg: '#ffffff',
    cardBgAlt: '#ffffff',
    sectionBg: '#f8fafc',
    panelBg: '#ffffff',
    fieldBg: '#f8fafc',
    fieldBorder: 'rgba(15,23,42,0.16)',
    border: 'rgba(15,23,42,0.10)',
    borderSoft: 'rgba(15,23,42,0.08)',
    text: '#172033',
    textSecondary: '#334155',
    muted: '#64748b',
    subtleText: '#94a3b8',
    title: '#b7791f',
    warning: '#b7791f',
    sent: '#c2740f',
    warningBg: 'rgba(183,121,31,0.10)',
    warningBorder: 'rgba(183,121,31,0.20)',
    danger: '#dc2626',
    dangerBg: 'rgba(220,38,38,0.08)',
    dangerBorder: 'rgba(220,38,38,0.26)',
    success: '#16a34a',
    successStrong: '#15803d',
    info: '#2563eb',
    pending: '#7c3aed',
    marker: '#d946ef',
    disabledBg: 'rgba(15,23,42,0.04)',
    disabledText: '#94a3b8',
    tabBadgeBg: '#eef2f7',
    callPulseShadow: 'rgba(220, 38, 38, 0.10)',
    alertPulseShadow: 'rgba(220, 38, 38, 0.10)',
    alertPulseBorder: 'rgba(220, 38, 38, 0.24)',
    scrollThumb: 'rgba(15, 23, 42, 0.18)',
    floatingShadow: '0 12px 32px rgba(15, 23, 42, 0.18)',
  };
}

/** CSS-переменные кнопок (.tm-btn), флажков выбора и всплывающей панели — из палитры темы. */
export function getTenderControlVars(palette: TenderMonitorPalette): Record<string, string> {
  return {
    '--tm-btn-bg': palette.sectionBg,
    '--tm-btn-border': palette.border,
    '--tm-btn-text': palette.textSecondary,
    '--tm-btn-muted': palette.muted,
    '--tm-text': palette.text,
    '--tm-accent': palette.warning,
    '--tm-accent-bg': palette.warningBg,
    '--tm-accent-border': palette.warningBorder,
    '--tm-section-bg': palette.sectionBg,
    '--tm-border-soft': palette.borderSoft,
    '--tm-tab-badge-bg': palette.tabBadgeBg,
    '--tm-danger': palette.danger,
    '--tm-danger-bg': palette.dangerBg,
    '--tm-danger-border': palette.dangerBorder,
    '--tm-panel-bg': palette.cardBg,
    '--tm-panel-shadow': palette.floatingShadow,
    '--tm-check-mark': palette.cardBg,
    '--tm-scroll-thumb': palette.scrollThumb,
  };
}

/** Сенсорный экран: поля antd крупнее (44px, шрифт 16px — без автозума iOS), как .tm-btn. */
export const isCoarsePointer = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/**
 * Тема antd внутри страницы: поля, списки, календари, переключатель и таблица — в палитре страницы,
 * акцент золотой (как .tm-btn--accent), высоты совпадают с .tm-btn: 30 / 26 (small) / 44 (large, сенсор).
 * Алгоритм светлой/тёмной темы наследуется от ConfigProvider приложения.
 */
export function getTenderAntdTheme(palette: TenderMonitorPalette, isDark: boolean): ThemeConfig {
  // Тёмное золото светлое — белый текст на нём не читается (выбранный день в календаре, «Ок»).
  const onAccent = isDark ? palette.pageBg : '#ffffff';
  return {
    token: {
      colorPrimary: palette.warning,
      colorBgContainer: palette.fieldBg,
      colorBgElevated: palette.panelBg,
      colorBorder: palette.fieldBorder,
      colorBorderSecondary: palette.borderSoft,
      colorText: palette.text,
      colorTextPlaceholder: palette.subtleText,
      colorTextDescription: palette.muted,
      borderRadius: 8,
      borderRadiusSM: 6,
      borderRadiusLG: 12,
      controlHeight: 30,
      controlHeightSM: 26,
      controlHeightLG: 44,
    },
    components: {
      Segmented: {
        trackBg: palette.sectionBg,
        itemColor: palette.muted,
        itemHoverColor: palette.text,
        itemHoverBg: 'transparent',
        itemSelectedBg: palette.warningBg,
        itemSelectedColor: palette.warning,
      },
      DatePicker: { colorTextLightSolid: onAccent },
      Button: { primaryColor: onAccent },
      Table: {
        colorBgContainer: palette.cardBg,
        headerBg: palette.sectionBg,
        headerColor: palette.muted,
        borderColor: palette.borderSoft,
        rowHoverBg: palette.disabledBg,
      },
    },
  };
}
