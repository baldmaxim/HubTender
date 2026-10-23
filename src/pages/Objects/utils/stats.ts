import type { IConstructionObject } from '../../../lib/types/types';

export interface IObjectsStats {
  total: number;
  current: number;
  archive: number;
  area: number;
}

export const getObjectsStats = (objects: readonly IConstructionObject[]): IObjectsStats => {
  let current = 0;
  let area = 0;
  for (const o of objects) {
    if (o.status === 'current') current += 1;
    area += o.area ?? 0;
  }
  return { total: objects.length, current, archive: objects.length - current, area };
};
