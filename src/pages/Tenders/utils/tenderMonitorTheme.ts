export interface TenderMonitorPalette {
  pageBg: string;
  pageGlowPrimary: string;
  pageGlowSecondary: string;
  cardBg: string;
  cardBgAlt: string;
  sectionBg: string;
  panelBg: string;
  fieldBg: string;
  border: string;
  borderSoft: string;
  text: string;
  textSecondary: string;
  muted: string;
  subtleText: string;
  title: string;
  warning: string;
  warningBg: string;
  warningBorder: string;
  danger: string;
  dangerBg: string;
  dangerBorder: string;
  success: string;
  successStrong: string;
  info: string;
  marker: string;
  disabledBg: string;
  disabledText: string;
  tabBadgeBg: string;
  callPulseShadow: string;
  alertPulseShadow: string;
  alertPulseBorder: string;
}

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
      border: 'rgba(255,255,255,0.08)',
      borderSoft: 'rgba(255,255,255,0.06)',
      text: '#f5efe4',
      textSecondary: '#d8dbea',
      muted: '#8b93a7',
      subtleText: '#6f7589',
      title: '#f0c45a',
      warning: '#f0c45a',
      warningBg: 'rgba(240,196,90,0.10)',
      warningBorder: 'rgba(240,196,90,0.24)',
      danger: '#e24b4a',
      dangerBg: 'rgba(226,75,74,0.10)',
      dangerBorder: 'rgba(226,75,74,0.34)',
      success: '#3db87a',
      successStrong: '#49d28c',
      info: '#4a90e2',
      marker: '#ff4db8',
      disabledBg: 'rgba(255,255,255,0.05)',
      disabledText: '#5f6578',
      tabBadgeBg: '#222636',
      callPulseShadow: 'rgba(226, 75, 74, 0.08)',
      alertPulseShadow: 'rgba(226, 75, 74, 0.08)',
      alertPulseBorder: 'rgba(226, 75, 74, 0.28)',
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
    border: 'rgba(15,23,42,0.10)',
    borderSoft: 'rgba(15,23,42,0.08)',
    text: '#172033',
    textSecondary: '#334155',
    muted: '#64748b',
    subtleText: '#94a3b8',
    title: '#b7791f',
    warning: '#b7791f',
    warningBg: 'rgba(183,121,31,0.10)',
    warningBorder: 'rgba(183,121,31,0.20)',
    danger: '#dc2626',
    dangerBg: 'rgba(220,38,38,0.08)',
    dangerBorder: 'rgba(220,38,38,0.26)',
    success: '#16a34a',
    successStrong: '#15803d',
    info: '#2563eb',
    marker: '#d946ef',
    disabledBg: 'rgba(15,23,42,0.04)',
    disabledText: '#94a3b8',
    tabBadgeBg: '#eef2f7',
    callPulseShadow: 'rgba(220, 38, 38, 0.10)',
    alertPulseShadow: 'rgba(220, 38, 38, 0.10)',
    alertPulseBorder: 'rgba(220, 38, 38, 0.24)',
  };
}
