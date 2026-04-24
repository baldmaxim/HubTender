import { useState, useEffect } from 'react';
import { message } from 'antd';
import { supabase } from '../../../lib/supabase';
import { getErrorMessage } from '../../../utils/errors';
import type { Template } from '../../../lib/supabase';

export interface TemplateWithDetails extends Template {
  cost_category_name?: string;
  detail_category_name?: string;
  location?: string;
  cost_category_full?: string;
  folder_id?: string | null;
}

export const useTemplates = () => {
  const [templates, setTemplates] = useState<TemplateWithDetails[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('templates')
        .select('*, detail_cost_categories(name, location, cost_categories(name))')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedTemplates: TemplateWithDetails[] = (data || []).map((item: any) => {
        const costCategoryName = item.detail_cost_categories?.cost_categories?.name || '';
        const detailCategoryName = item.detail_cost_categories?.name || '';
        const location = item.detail_cost_categories?.location || '';
        const costCategoryFull = costCategoryName && detailCategoryName && location
          ? `${costCategoryName} / ${detailCategoryName} / ${location}`
          : '';

        return {
          ...item,
          cost_category_name: costCategoryName,
          detail_category_name: detailCategoryName,
          location: location,
          cost_category_full: costCategoryFull,
        };
      });

      setTemplates(formattedTemplates);
    } catch (error) {
      message.error('Ошибка загрузки шаблонов: ' + getErrorMessage(error));
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    try {
      const { error } = await supabase
        .from('templates')
        .delete()
        .eq('id', templateId);

      if (error) throw error;

      message.success('Шаблон удален');
      fetchTemplates();
    } catch (error) {
      message.error('Ошибка удаления шаблона: ' + getErrorMessage(error));
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  return {
    templates,
    loading,
    setLoading,
    fetchTemplates,
    handleDeleteTemplate,
  };
};
