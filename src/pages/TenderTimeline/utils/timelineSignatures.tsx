import React from 'react';
import { DEFAULT_TENDER_TEAMS, normalizeFullName } from './timeline.utils';
import type { TimelineGroupItem } from '../hooks/useTenderGroups';

export type ExpectedAutoGroup = {
  name: string;
  color: string;
  sortOrder: number;
  userIds: string[];
};

export const QUALITY_LEVEL_DESCRIPTIONS: Record<number, string> = {
  1: 'Расценивали ВОР.',
  2: 'Считали ориентировочно.',
  3: 'Считали качественно, имеются все данные от Заказчика.',
};

export function getQualityLabel(level: number | null): string {
  return level == null ? 'Нет оценки' : `${level}/3`;
}

export function getQualityTooltipContent(level: number | null, comment?: string | null): React.ReactNode {
  if (level == null) {
    return 'Нет оценки';
  }

  return (
    <div>
      <div>{QUALITY_LEVEL_DESCRIPTIONS[level] || `Уровень ${level}`}</div>
      {comment ? <div style={{ marginTop: 4 }}>{comment}</div> : null}
    </div>
  );
}

export function getExpectedAutoGroups(
  users: Array<{ id: string; full_name: string }>
): ExpectedAutoGroup[] {
  const usersByName = new Map(users.map((user) => [normalizeFullName(user.full_name), user]));

  return DEFAULT_TENDER_TEAMS.map((team) => {
    const matchedUserIds = team.members
      .map((fullName) => usersByName.get(normalizeFullName(fullName))?.id || null)
      .filter((userId): userId is string => Boolean(userId));

    return {
      name: team.name,
      color: team.color,
      sortOrder: team.sortOrder,
      userIds: matchedUserIds,
    };
  });
}

/**
 * Возвращает true, когда ReconcileTenderGroups на сервере затронул бы НОЛЬ строк
 * для текущего состояния групп — то есть авто-синхронизация не нужна. Зеркалит
 * решение бэкенда (backend/internal/repository/timeline_reconcile.go): вставка
 * группы, UPDATE цвета/порядка, add/remove участника (с защитой владельцев
 * итераций), очистка excluded-пользователей. В отличие от сравнения сигнатур
 * «ожидаемое == фактическое», предикат корректно учитывает защищённых
 * итерациями участников, поэтому сошедшийся тендер стабильно даёт true и не
 * запускает бесконечную петлю reconcile при каждом развороте карточки.
 */
export function isReconciled(
  expected: ExpectedAutoGroup[],
  groups: TimelineGroupItem[],
  excludedUserIds: string[],
): boolean {
  const excluded = new Set(excludedUserIds);

  for (const exp of expected) {
    const group = groups.find((candidate) => candidate.name === exp.name);
    if (!group) {
      return false; // группы нет → сервер сделает INSERT
    }
    if (group.color !== exp.color || (group.sort_order ?? 0) !== exp.sortOrder) {
      return false; // сервер сделает UPDATE цвета/порядка
    }

    const memberIds = new Set(group.members.map((member) => member.user_id));
    const protectedIds = new Set(group.iterationUserIds); // владельцы итераций — защищены от удаления
    const expectedIds = new Set(exp.userIds);

    for (const uid of exp.userIds) {
      if (!memberIds.has(uid)) {
        return false; // сервер добавит участника
      }
    }
    for (const uid of memberIds) {
      if (!expectedIds.has(uid) && !protectedIds.has(uid)) {
        return false; // сервер удалит лишнего участника
      }
      if (excluded.has(uid)) {
        return false; // сервер вычистит excluded-участника
      }
    }
    for (const uid of protectedIds) {
      if (excluded.has(uid)) {
        return false; // сервер вычистит excluded-итерации
      }
    }
  }

  return true;
}
