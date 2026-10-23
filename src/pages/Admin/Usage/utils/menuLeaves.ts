import type { ReactNode } from 'react';
import { menuItems } from '../../../../components/Layout/menuItems';

/** Лист бокового меню: страница, её подпись и раздел-родитель. */
export interface IMenuLeaf {
  page: string;
  label: string;
  group: string;
}

/** Раздел для пунктов верхнего уровня меню (без родителя-группы). */
export const TOP_LEVEL_GROUP = 'Без раздела';

interface IMenuNode {
  key?: unknown;
  label?: ReactNode;
  type?: string;
  children?: IMenuNode[];
}

const asText = (label: ReactNode, fallback: string): string => (typeof label === 'string' ? label : fallback);

const toLeaf = (node: IMenuNode, group: string): IMenuLeaf | null => {
  if (node.type === 'divider' || typeof node.key !== 'string' || !node.key.startsWith('/')) return null;
  return { page: node.key, label: asText(node.label, node.key), group };
};

/** Все страницы бокового меню в порядке меню; группы-родители задают «Раздел меню». */
export const getMenuLeaves = (): IMenuLeaf[] => {
  const leaves: IMenuLeaf[] = [];
  for (const node of menuItems as IMenuNode[]) {
    if (node.children) {
      const group = asText(node.label, TOP_LEVEL_GROUP);
      for (const child of node.children) {
        const leaf = toLeaf(child, group);
        if (leaf) leaves.push(leaf);
      }
    } else {
      const leaf = toLeaf(node, TOP_LEVEL_GROUP);
      if (leaf) leaves.push(leaf);
    }
  }
  return leaves;
};
