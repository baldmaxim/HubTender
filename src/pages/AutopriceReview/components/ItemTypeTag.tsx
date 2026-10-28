import type { FC } from 'react';
import { Tag, Tooltip } from 'antd';
import { getBoqTypeTagStyle } from '../../PositionItems/components/boqColors';
import type { IPositionItem } from '../types';
import { isBoqItemType, isMaterialItemType, shortMaterialType } from '../utils/itemTypes';
import styles from '../AutopriceReview.module.css';

interface IItemTypeTagProps {
  type: string;
}

/** Цветной тег типа строки; цвета — общий хелпер getBoqTypeTagStyle. */
export const ItemTypeTag: FC<IItemTypeTagProps> = ({ type }) => {
  if (!isBoqItemType(type)) return <Tag className={styles.typeTag}>{type}</Tag>;
  const { bgColor, textColor } = getBoqTypeTagStyle(type);
  return (
    <Tag className={styles.typeTag} style={{ backgroundColor: bgColor, color: textColor }}>
      {type}
    </Tag>
  );
};

interface IItemTypeCellProps {
  item: IPositionItem;
  linked: boolean;
}

/** Ячейка «Тип»: тег + у материалов «осн./вспом.»; несвязанный материал — подсказка. */
export const ItemTypeCell: FC<IItemTypeCellProps> = ({ item, linked }) => {
  const material = isMaterialItemType(item.boq_item_type);
  const kind = material ? shortMaterialType(item.material_type) : null;
  const tag = <ItemTypeTag type={item.boq_item_type} />;
  return (
    <span className={styles.typeCell}>
      {material && !linked ? <Tooltip title="не привязан к работе">{tag}</Tooltip> : tag}
      {kind && <span className={styles.typeKind}>{kind}</span>}
    </span>
  );
};
