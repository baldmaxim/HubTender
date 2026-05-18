import { useState, useEffect } from 'react';
import { message } from 'antd';
import { listTemplates, deleteTemplate } from '../../../lib/api/library';
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
      const data = await listTemplates();

      const formattedTemplates: TemplateWithDetails[] = (data || []).map((item) => {
        const dcc = Array.isArray(item.detail_cost_categories) ? item.detail_cost_categories[0] : item.detail_cost_categories;
        const costCats = dcc ? (Array.isArray(dcc.cost_categories) ? dcc.cost_categories[0] : dcc.cost_categories) : undefined;
        const costCategoryName = costCats?.name || '';
        const detailCategoryName = dcc?.name || '';
        const location = dcc?.location || '';
        const costCategoryFull = costCategoryName && detailCategoryName && location
          ? `${costCategoryName} / ${detailCategoryName} / ${location}`
          : '';

        return {
          ...(item as unknown as Template),
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
      await deleteTemplate(templateId);

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
