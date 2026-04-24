import React, { useState, useEffect } from 'react';
import {
  Card,
  Typography,
  Table,
  Checkbox,
  message,
  Spin,
  Empty,
  Space,
  Tag,
} from 'antd';
import {
  supabase,
  DetailCostCategory,
  CostCategory,
  Location,
} from '../../../lib/supabase';
import { getErrorMessage } from '../../../utils/errors';

const { Title, Text } = Typography;

interface SubcontractGrowthTabProps {
  tenderId: string | null;
}

interface CostCategoryWithDetails extends DetailCostCategory {
  cost_category?: CostCategory;
  location?: Location;
}

interface ExclusionState {
  works: Set<string>;      // Категории исключенные для суб-раб
  materials: Set<string>;  // Категории исключенные для суб-мат
}

type ExclusionType = 'works' | 'materials';

export const SubcontractGrowthTab: React.FC<SubcontractGrowthTabProps> = ({ tenderId }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<CostCategoryWithDetails[]>([]);
  const [exclusions, setExclusions] = useState<ExclusionState>({
    works: new Set(),
    materials: new Set()
  });

  // Загрузка всех категорий затрат
  const fetchCategories = async () => {
    setLoading(true);
    try {
      const { data: detailCategories, error: detailError } = await supabase
        .from('detail_cost_categories')
        .select('*')
        .order('order_num', { ascending: true });

      if (detailError) throw detailError;

      const categoryIds = [...new Set(detailCategories?.map(d => d.cost_category_id) || [])];
      const locationIds = [...new Set(detailCategories?.map(d => d.location_id) || [])];

      const [{ data: costCategories }, { data: locations }] = await Promise.all([
        supabase.from('cost_categories').select('*').in('id', categoryIds),
        supabase.from('locations').select('*').in('id', locationIds),
      ]);

      const categoriesWithRelations = detailCategories?.map(detail => ({
        ...detail,
        cost_category: costCategories?.find(c => c.id === detail.cost_category_id),
        location: locations?.find(l => l.id === detail.location_id),
      })) || [];

      setCategories(categoriesWithRelations);
    } catch (error) {
      console.error('Ошибка загрузки категорий затрат:', error);
      message.error(`Не удалось загрузить категории: ${getErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  // Загрузка исключений для текущего тендера
  const fetchExclusions = async () => {
    if (!tenderId) {
      setExclusions({ works: new Set(), materials: new Set() });
      return;
    }

    try {
      const { data, error } = await supabase
        .from('subcontract_growth_exclusions')
        .select('detail_cost_category_id, exclusion_type')
        .eq('tender_id', tenderId);

      if (error) throw error;

      const newExclusions: ExclusionState = {
        works: new Set(),
        materials: new Set()
      };

      data?.forEach(item => {
        if (item.exclusion_type === 'works') {
          newExclusions.works.add(item.detail_cost_category_id);
        } else if (item.exclusion_type === 'materials') {
          newExclusions.materials.add(item.detail_cost_category_id);
        }
      });

      setExclusions(newExclusions);
    } catch (error) {
      console.error('Ошибка загрузки исключений:', error);
      message.error(`Не удалось загрузить исключения: ${getErrorMessage(error)}`);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    fetchExclusions();
    // fetchExclusions is defined in this component; intentionally excluded to avoid refetch loop on tenderId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId]);

  // Обработка изменения чекбокса для одной категории
  const handleToggle = async (categoryId: string, type: ExclusionType, excluded: boolean) => {
    if (!tenderId) {
      message.warning('Выберите тендер для настройки роста субподряда');
      return;
    }

    setSaving(true);
    try {
      if (excluded) {
        // Добавить в исключения
        const { error } = await supabase
          .from('subcontract_growth_exclusions')
          .insert({
            tender_id: tenderId,
            detail_cost_category_id: categoryId,
            exclusion_type: type,
          });

        if (error) throw error;

        setExclusions(prev => ({
          ...prev,
          [type]: new Set(prev[type]).add(categoryId)
        }));

        const typeLabel = type === 'works' ? 'работ' : 'материалов';
        message.success(`Рост субподряда ${typeLabel} отключён для этой категории`);
      } else {
        // Удалить из исключений
        const { error } = await supabase
          .from('subcontract_growth_exclusions')
          .delete()
          .eq('tender_id', tenderId)
          .eq('detail_cost_category_id', categoryId)
          .eq('exclusion_type', type);

        if (error) throw error;

        setExclusions(prev => {
          const newSet = new Set(prev[type]);
          newSet.delete(categoryId);
          return {
            ...prev,
            [type]: newSet
          };
        });

        const typeLabel = type === 'works' ? 'работ' : 'материалов';
        message.success(`Рост субподряда ${typeLabel} включён для этой категории`);
      }
    } catch (error) {
      console.error('Ошибка изменения настройки:', error);
      message.error(`Не удалось изменить настройку: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  // Обработка изменения чекбокса для всей группы (категории)
  const handleGroupToggle = async (
    categoryItems: CostCategoryWithDetails[],
    type: ExclusionType,
    excluded: boolean
  ) => {
    if (!tenderId) {
      message.warning('Выберите тендер для настройки роста субподряда');
      return;
    }

    setSaving(true);
    try {
      const categoryIds = categoryItems.map(item => item.id);

      if (excluded) {
        // Добавить все элементы группы в исключения
        const insertData = categoryIds.map(id => ({
          tender_id: tenderId,
          detail_cost_category_id: id,
          exclusion_type: type,
        }));

        const { error } = await supabase
          .from('subcontract_growth_exclusions')
          .insert(insertData);

        if (error) throw error;

        setExclusions(prev => {
          const newSet = new Set(prev[type]);
          categoryIds.forEach(id => newSet.add(id));
          return {
            ...prev,
            [type]: newSet
          };
        });

        const typeLabel = type === 'works' ? 'работ' : 'материалов';
        message.success(`Рост субподряда ${typeLabel} отключён для всей категории`);
      } else {
        // Удалить все элементы группы из исключений
        const { error } = await supabase
          .from('subcontract_growth_exclusions')
          .delete()
          .eq('tender_id', tenderId)
          .in('detail_cost_category_id', categoryIds)
          .eq('exclusion_type', type);

        if (error) throw error;

        setExclusions(prev => {
          const newSet = new Set(prev[type]);
          categoryIds.forEach(id => newSet.delete(id));
          return {
            ...prev,
            [type]: newSet
          };
        });

        const typeLabel = type === 'works' ? 'работ' : 'материалов';
        message.success(`Рост субподряда ${typeLabel} включён для всей категории`);
      }
    } catch (error) {
      console.error('Ошибка изменения настройки группы:', error);
      message.error(`Не удалось изменить настройку: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  // Группируем данные по категориям
  const groupedData = categories.reduce((acc, item) => {
    const categoryName = item.cost_category?.name || 'Без категории';
    if (!acc[categoryName]) {
      acc[categoryName] = [];
    }
    acc[categoryName].push(item);
    return acc;
  }, {} as Record<string, CostCategoryWithDetails[]>);

  // Формируем данные для таблицы с группировкой
  const tableData = Object.entries(groupedData).map(([categoryName, items]) => ({
    key: categoryName,
    categoryName,
    children: items.map(item => ({
      key: item.id,
      ...item,
    })),
  }));

  // Колонки таблицы
  const columns = [
    {
      title: 'Категория / Детализация',
      dataIndex: 'name',
      key: 'name',
      width: '35%',
      render: (text: string, record: any) => {
        if (record.children) {
          return <Text strong style={{ fontSize: 16 }}>{record.categoryName}</Text>;
        }
        return <Text>{text}</Text>;
      },
    },
    {
      title: 'Локализация',
      dataIndex: ['location', 'location'],
      key: 'location',
      width: '25%',
      render: (text: string, record: any) => {
        if (record.children) return null;
        return <Tag color="blue">{text}</Tag>;
      },
    },
    {
      title: 'Рост работ субподряда',
      key: 'apply_works_growth',
      width: '20%',
      align: 'center' as const,
      render: (_: any, record: any) => {
        // Для родительской группы (категории)
        if (record.children) {
          const allIds = record.children.map((child: any) => child.id);
          const allExcluded = allIds.every((id: string) => exclusions.works.has(id));
          const someExcluded = allIds.some((id: string) => exclusions.works.has(id));

          return (
            <Checkbox
              checked={!allExcluded}
              indeterminate={someExcluded && !allExcluded}
              onChange={(e) => handleGroupToggle(record.children, 'works', !e.target.checked)}
              disabled={!tenderId || saving}
            />
          );
        }

        // Для дочерних элементов (детализация)
        return (
          <Checkbox
            checked={!exclusions.works.has(record.id)}
            onChange={(e) => handleToggle(record.id, 'works', !e.target.checked)}
            disabled={!tenderId || saving}
          />
        );
      },
    },
    {
      title: 'Рост материалов субподряда',
      key: 'apply_materials_growth',
      width: '20%',
      align: 'center' as const,
      render: (_: any, record: any) => {
        // Для родительской группы (категории)
        if (record.children) {
          const allIds = record.children.map((child: any) => child.id);
          const allExcluded = allIds.every((id: string) => exclusions.materials.has(id));
          const someExcluded = allIds.some((id: string) => exclusions.materials.has(id));

          return (
            <Checkbox
              checked={!allExcluded}
              indeterminate={someExcluded && !allExcluded}
              onChange={(e) => handleGroupToggle(record.children, 'materials', !e.target.checked)}
              disabled={!tenderId || saving}
            />
          );
        }

        // Для дочерних элементов (детализация)
        return (
          <Checkbox
            checked={!exclusions.materials.has(record.id)}
            onChange={(e) => handleToggle(record.id, 'materials', !e.target.checked)}
            disabled={!tenderId || saving}
          />
        );
      },
    },
  ];

  return (
    <div>
      <Card bordered={false}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              Настройка роста субподряда
            </Title>
            <Text type="secondary">
              По умолчанию рост субподряда применяется ко всем категориям затрат.
              Снимите галочку для категорий, на которые НЕ нужно применять рост субподряда.
            </Text>
          </div>

          {!tenderId && (
            <Empty
              description="Выберите тендер для настройки роста субподряда"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}

          {tenderId && (
            <Spin spinning={loading || saving}>
              <Table
                columns={columns}
                dataSource={tableData}
                pagination={false}
                size="small"
                defaultExpandAllRows
                expandable={{
                  defaultExpandAllRows: true,
                }}
              />
            </Spin>
          )}
        </Space>
      </Card>
    </div>
  );
};
