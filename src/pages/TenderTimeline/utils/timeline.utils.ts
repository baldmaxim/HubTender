import type { ApprovalStatus } from '../../../lib/types/types';

export const TIMELINE_PRIVILEGED_ROLE_CODES = [
  'administrator',
  'developer',
  'director',
  'senior_group',
  'veduschiy_inzhener',
] as const;

export const TIMELINE_EXCLUDED_FULL_NAMES = ['Дядя Вася'] as const;

export const DEFAULT_TENDER_TEAMS = [
  {
    name: 'Общестрой',
    color: '#1677ff',
    sortOrder: 10,
    members: [
      'Артамонов Максим Алексеевич',
      'Жук Владислав Владимирович',
      'Голотин Дмитрий Сергеевич',
      'Луис Дженс Жоаким Матиас',
      'Юдин Андрей Борисович',
      'Холодов Александр Андреевич',
      'Куклев Дмитрий Сергеевич',
      'Козлов Артем Валерьевич',
    ],
  },
  {
    name: 'Фасады',
    color: '#13c2c2',
    sortOrder: 20,
    members: [
      'Зинин Вячеслав Александрович',
      'Коваленко Валерий Александрович',
    ],
  },
  {
    name: 'Отделка',
    color: '#fa8c16',
    sortOrder: 30,
    members: [
      'Стефанеев Андрей Игоревич',
      'Шанин Роман Александрович',
      'Карамышев Данил Романович',
    ],
  },
  {
    name: 'ЭОМ/СС',
    color: '#722ed1',
    sortOrder: 40,
    members: [
      'Топчий Анна Ивановна',
      'Мохов Сергей Дмитриевич',
    ],
  },
  {
    name: 'ОВиВК',
    color: '#52c41a',
    sortOrder: 50,
    members: [
      'Казаков Евгений Игоревич',
      'Сапожникова Ксения Викторовна',
    ],
  },
] as const;

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const amountFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

const roleLabels: Record<string, string> = {
  administrator: 'Администратор',
  developer: 'Разработчик',
  director: 'Руководитель',
  senior_group: 'Старший группы',
  engineer: 'Инженер',
  veduschiy_inzhener: 'Ведущий инженер',
  general_director: 'Генеральный директор',
};

const roleColors: Record<string, string> = {
  administrator: '#722ed1',
  developer: '#13c2c2',
  director: '#f5222d',
  senior_group: '#1677ff',
  engineer: '#52c41a',
  veduschiy_inzhener: '#fa8c16',
  general_director: '#eb2f96',
};

export function formatDate(iso?: string | null): string {
  if (!iso) {
    return 'Дата не указана';
  }

  return dateFormatter.format(new Date(iso));
}

export function formatAmount(amount?: number | null): string {
  if (amount == null) {
    return 'Без суммы';
  }

  return amountFormatter.format(amount);
}

export function getScoreColor(score: number): string {
  if (score >= 80) {
    return '#52c41a';
  }

  if (score >= 60) {
    return '#faad14';
  }

  return '#ff4d4f';
}

export function getInitials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function getRoleLabel(roleCode: string): string {
  return roleLabels[roleCode] || roleCode;
}

export function getRoleAvatarColor(roleCode: string): string {
  return roleColors[roleCode] || '#1677ff';
}

export function getStatusTagColor(status: ApprovalStatus): string {
  switch (status) {
    case 'approved':
      return 'success';
    case 'rejected':
      return 'error';
    default:
      return 'warning';
  }
}

export function getStatusLabel(status: ApprovalStatus): string {
  switch (status) {
    case 'approved':
      return 'Согласовано';
    case 'rejected':
      return 'Отказано';
    default:
      return 'На проверке';
  }
}

export function normalizeFullName(fullName: string): string {
  return fullName.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}
