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

export function getGroupsSignature(groups: TimelineGroupItem[]): string {
  return groups
    .map((group) => ({
      name: group.name,
      color: group.color,
      sortOrder: group.sort_order,
      userIds: group.members.map((member) => member.user_id).sort(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ru-RU'))
    .map((group) => `${group.name}|${group.color}|${group.sortOrder}|${group.userIds.join(',')}`)
    .join(';');
}

export function getExpectedSignature(expectedGroups: ExpectedAutoGroup[]): string {
  return expectedGroups
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, 'ru-RU'))
    .map((group) => `${group.name}|${group.color}|${group.sortOrder}|${group.userIds.slice().sort().join(',')}`)
    .join(';');
}
