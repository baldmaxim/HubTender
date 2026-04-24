import { useState } from 'react';
import { message, Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import { supabase } from '../../../../lib/supabase';

const { confirm } = Modal;

export interface TreeNode {
  key: string;
  structure: string;
  type: 'category' | 'detail';
  unit: string;
  description: string;
  children?: TreeNode[];
  categoryId?: string;
  detailId?: string;
  location?: string;
  orderNum?: number;
}

export const useConstructionCost = () => {
  const [data, setData] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: categories, error: catError } = await supabase
        .from('cost_categories')
        .select('*')
        .order('name');

      if (catError) throw catError;

      const { data: details, error: detError } = await supabase
        .from('detail_cost_categories')
        .select('*, cost_categories(*)')
        .order('order_num');

      if (detError) throw detError;

      const treeData: TreeNode[] = [];
      const categoryMap = new Map<string, TreeNode>();
      const categoryMinOrderNum = new Map<string, number>();

      details?.forEach(detail => {
        const currentMin = categoryMinOrderNum.get(detail.cost_category_id);
        if (currentMin === undefined || detail.order_num < currentMin) {
          categoryMinOrderNum.set(detail.cost_category_id, detail.order_num);
        }
      });

      categories?.forEach(cat => {
        const node: TreeNode = {
          key: `cat_${cat.id}`,
          structure: cat.name,
          type: 'category',
          unit: cat.unit,
          description: 'Нет описания',
          categoryId: cat.id,
          orderNum: categoryMinOrderNum.get(cat.id) || 999999,
          children: [],
        };
        categoryMap.set(cat.id, node);
        treeData.push(node);
      });

      details?.forEach(detail => {
        const categoryNode = categoryMap.get(detail.cost_category_id);
        if (categoryNode && categoryNode.children) {
          const detailKey = `${detail.name}_${detail.unit}`;
          let detailNode = categoryNode.children.find(
            child => child.structure === detail.name && child.unit === detail.unit
          );

          if (!detailNode) {
            detailNode = {
              key: `detail_group_${detailKey}_${detail.cost_category_id}`,
              structure: detail.name,
              type: 'detail',
              unit: detail.unit,
              description: 'Нет описания',
              categoryId: detail.cost_category_id,
              orderNum: detail.order_num,
              children: [],
            };
            categoryNode.children.push(detailNode);
          }

          if (detailNode.children) {
            detailNode.children.push({
              key: `location_${detail.id}`,
              structure: `📍 ${detail.location}`,
              type: 'detail',
              unit: detail.unit,
              description: 'Локация',
              detailId: detail.id,
              categoryId: detail.cost_category_id,
              location: detail.location,
              orderNum: detail.order_num,
            });
          }
        }
      });

      treeData.sort((a, b) => (a.orderNum || 0) - (b.orderNum || 0));

      treeData.forEach(cat => {
        if (cat.children) {
          cat.children.sort((a, b) => (a.orderNum || 0) - (b.orderNum || 0));
          cat.children.forEach(detail => {
            if (detail.children) {
              detail.children.sort((a, b) => (a.orderNum || 0) - (b.orderNum || 0));
            }
          });
        }
      });

      setData(treeData);

      const allKeys: string[] = [];
      treeData.forEach(cat => {
        allKeys.push(cat.key);
        if (cat.children) {
          cat.children.forEach(detail => {
            allKeys.push(detail.key);
          });
        }
      });
      setExpandedKeys(allKeys);
    } catch (error) {
      console.error('Ошибка загрузки данных:', error);
      message.error('Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  };

  const deleteItem = (record: TreeNode) => {
    confirm({
      title: 'Подтверждение удаления',
      icon: <ExclamationCircleOutlined />,
      content: `Вы уверены, что хотите удалить "${record.structure}"?`,
      okText: 'Удалить',
      cancelText: 'Отмена',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          if (record.type === 'category' && record.categoryId) {
            const { error } = await supabase
              .from('cost_categories')
              .delete()
              .eq('id', record.categoryId);

            if (error) throw error;
          } else if (record.type === 'detail' && record.detailId) {
            const { error } = await supabase
              .from('detail_cost_categories')
              .delete()
              .eq('id', record.detailId);

            if (error) throw error;
          }

          message.success('Запись успешно удалена');
          await loadData();
        } catch (error) {
          console.error('Ошибка удаления:', error);
          message.error('Ошибка удаления записи');
        }
      },
    });
  };

  const saveEdit = async (values: { name?: string; unit?: string; location?: string }, editingItem: TreeNode | null) => {
    try {
      if (editingItem?.type === 'category' && editingItem.categoryId) {
        const { error } = await supabase
          .from('cost_categories')
          .update({
            name: values.name,
            unit: values.unit,
          })
          .eq('id', editingItem.categoryId);

        if (error) throw error;
      } else if (editingItem?.type === 'detail' && editingItem.detailId) {
        const { error } = await supabase
          .from('detail_cost_categories')
          .update({
            name: values.name,
            unit: values.unit,
            location: values.location,
          })
          .eq('id', editingItem.detailId);

        if (error) throw error;
      }

      message.success('Изменения сохранены');
      await loadData();
      return true;
    } catch (error) {
      console.error('Ошибка сохранения:', error);
      message.error('Ошибка сохранения изменений');
      return false;
    }
  };

  const deleteAll = async () => {
    try {
      const { error: detailError } = await supabase
        .from('detail_cost_categories')
        .delete()
        .not('id', 'is', null);

      if (detailError) throw detailError;

      const { error: categoryError } = await supabase
        .from('cost_categories')
        .delete()
        .not('id', 'is', null);

      if (categoryError) throw categoryError;

      message.success('Все затраты успешно удалены');
      await loadData();
    } catch (error) {
      console.error('Ошибка удаления:', error);
      message.error('Ошибка при удалении затрат');
    }
  };

  const expandAll = () => {
    const allKeys: string[] = [];
    data.forEach(cat => {
      allKeys.push(cat.key);
      if (cat.children) {
        cat.children.forEach(detail => {
          allKeys.push(detail.key);
        });
      }
    });
    setExpandedKeys(allKeys);
  };

  const collapseAll = () => {
    setExpandedKeys([]);
  };

  return {
    data,
    loading,
    expandedKeys,
    setExpandedKeys,
    loadData,
    deleteItem,
    saveEdit,
    deleteAll,
    expandAll,
    collapseAll,
  };
};
