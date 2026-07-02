import type { UnitType, BoqItemType } from '../../../lib/types';

export const getUnitColor = (unit: UnitType): string => {
  const colors: Record<UnitType, string> = {
    'шт': 'blue',
    'м': 'green',
    'м2': 'cyan',
    'м3': 'purple',
    'кг': 'orange',
    'т': 'red',
    'л': 'magenta',
    'компл': 'volcano',
    'м.п.': 'geekblue',
  };
  return colors[unit] || 'default';
};

// Item type colors (из ItemsTable.tsx)
export const getItemTypeStyle = (type: BoqItemType): { backgroundColor: string; color: string } => {
  const isWork = ['раб', 'суб-раб', 'раб-комп.'].includes(type);

  if (isWork) {
    switch (type) {
      case 'раб':
        return { backgroundColor: 'rgba(239, 108, 0, 0.12)', color: '#f57c00' };
      case 'суб-раб':
        return { backgroundColor: 'rgba(106, 27, 154, 0.12)', color: '#7b1fa2' };
      case 'раб-комп.':
        return { backgroundColor: 'rgba(198, 40, 40, 0.12)', color: '#d32f2f' };
    }
  } else {
    switch (type) {
      case 'мат':
        return { backgroundColor: 'rgba(21, 101, 192, 0.12)', color: '#1976d2' };
      case 'суб-мат':
        return { backgroundColor: 'rgba(104, 159, 56, 0.12)', color: '#7cb342' };
      case 'мат-комп.':
        return { backgroundColor: 'rgba(0, 105, 92, 0.12)', color: '#00897b' };
    }
  }

  return { backgroundColor: 'rgba(0, 0, 0, 0.06)', color: '#000' };
};

// Material type colors (из ItemsTable.tsx)
export const getMaterialTypeStyle = (
  type?: 'основн.' | 'вспомогат.'
): { backgroundColor: string; color: string } => {
  if (!type) return { backgroundColor: 'transparent', color: 'inherit' };

  if (type === 'основн.') {
    return { backgroundColor: 'rgba(255, 152, 0, 0.12)', color: '#fb8c00' };
  }
  return { backgroundColor: 'rgba(21, 101, 192, 0.12)', color: '#1976d2' };
};

export const isMaterial = (type: BoqItemType) =>
  ['мат', 'суб-мат', 'мат-комп.'].includes(type);
