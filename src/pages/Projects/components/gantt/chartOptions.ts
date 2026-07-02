// Опции chart.js для мини-графиков и модальных графиков Ганта.
// Тема-зависимые опции — фабрики; в компоненте оборачиваются в useMemo([theme]),
// чтобы сохранить referential identity, как в исходном коде.

// Mini chart options - completely minimal, no text at all
export const miniChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  plugins: {
    legend: { display: false },
    tooltip: { enabled: false },
    title: { display: false },
  },
  scales: {
    x: { display: false },
    y: { display: false },
  },
  elements: {
    point: { radius: 0 },
    line: { borderWidth: 1.5 },
  },
};

// Full chart options for modal - with legend and tooltips
export const buildFullChartOptions = (theme: string) => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      labels: {
        color: theme === 'dark' ? '#ffffff85' : '#00000073',
      },
    },
    tooltip: {
      enabled: true,
      callbacks: {
        label: (context: { parsed: { y: number } }) => {
          const value = context.parsed.y;
          if (value >= 1000) {
            return `${(value / 1000).toFixed(2)} млрд ₽`;
          }
          return `${value.toFixed(2)} млн ₽`;
        },
      },
    },
  },
  scales: {
    x: {
      grid: { color: theme === 'dark' ? '#303030' : '#f0f0f0' },
      ticks: { color: theme === 'dark' ? '#ffffff85' : '#00000073' },
    },
    y: {
      grid: { color: theme === 'dark' ? '#303030' : '#f0f0f0' },
      ticks: {
        color: theme === 'dark' ? '#ffffff85' : '#00000073',
        callback: (value: number | string) => {
          const num = typeof value === 'number' ? value : parseFloat(value);
          if (num >= 1000) {
            return `${(num / 1000).toFixed(1)} млрд`;
          }
          return `${num} млн`;
        },
      },
    },
  },
  interaction: {
    intersect: false,
    mode: 'index' as const,
  },
});

// Summary chart options (визуально совпадают с full, но остаются отдельной
// фабрикой — как в исходном коде, чтобы не менять referential identity).
export const buildSummaryChartOptions = (theme: string) => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      labels: {
        color: theme === 'dark' ? '#ffffff85' : '#00000073',
      },
    },
    tooltip: {
      enabled: true,
      callbacks: {
        label: (context: { parsed: { y: number } }) => {
          const value = context.parsed.y;
          if (value >= 1000) {
            return `${(value / 1000).toFixed(2)} млрд ₽`;
          }
          return `${value.toFixed(2)} млн ₽`;
        },
      },
    },
  },
  scales: {
    x: {
      grid: { color: theme === 'dark' ? '#303030' : '#f0f0f0' },
      ticks: { color: theme === 'dark' ? '#ffffff85' : '#00000073' },
    },
    y: {
      grid: { color: theme === 'dark' ? '#303030' : '#f0f0f0' },
      ticks: {
        color: theme === 'dark' ? '#ffffff85' : '#00000073',
        callback: (value: number | string) => {
          const num = typeof value === 'number' ? value : parseFloat(value);
          if (num >= 1000) {
            return `${(num / 1000).toFixed(1)} млрд`;
          }
          return `${num} млн`;
        },
      },
    },
  },
  interaction: {
    intersect: false,
    mode: 'index' as const,
  },
});
