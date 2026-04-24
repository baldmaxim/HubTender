import { useState } from 'react';
import { message, Form } from 'antd';
import { supabase } from '../../../lib/supabase';
import type { WorkLibraryFull, MaterialLibraryFull } from '../../../lib/supabase';
import type { TemplateItemWithDetails } from './useTemplateItems';
import type { TemplateWithDetails } from './useTemplates';

interface CostCategoryOption {
  value: string;
  label: string;
}

export const useTemplateEditing = (
  loadedTemplateItems: Record<string, TemplateItemWithDetails[]>,
  setLoadedTemplateItems: (fn: (prev: Record<string, TemplateItemWithDetails[]>) => Record<string, TemplateItemWithDetails[]>) => void,
  costCategories: CostCategoryOption[]
) => {
  const [editingTemplateForm] = Form.useForm();
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [editingTemplateCostCategorySearchText, setEditingTemplateCostCategorySearchText] = useState('');
  const [editingItems, setEditingItems] = useState<TemplateItemWithDetails[]>([]);

  const startEditing = (template: TemplateWithDetails) => {
    setEditingTemplate(template.id);
    editingTemplateForm.setFieldsValue({
      name: template.name,
      detail_cost_category_id: template.detail_cost_category_id,
    });
    const category = costCategories.find(c => c.value === template.detail_cost_category_id);
    if (category) {
      setEditingTemplateCostCategorySearchText(category.label);
    }
    const items = loadedTemplateItems[template.id] || [];
    setEditingItems([...items]);
  };

  const cancelEditing = () => {
    setEditingTemplate(null);
    editingTemplateForm.resetFields();
    setEditingTemplateCostCategorySearchText('');
    setEditingItems([]);
  };

  const saveEditing = async (templateId: string, setOpenedTemplate: (id: string) => void, fetchTemplates: () => void, refetchTemplateItems: (id: string) => void) => {
    const values = await editingTemplateForm.validateFields();

    const { error: templateError } = await supabase
      .from('templates')
      .update({
        name: values.name,
        detail_cost_category_id: values.detail_cost_category_id,
      })
      .eq('id', templateId);

    if (templateError) throw templateError;

    // Batch update: один запрос через upsert вместо цикла
    if (editingItems.length > 0) {
      const { error: itemsError } = await supabase
        .from('template_items')
        .upsert(
          editingItems.map(item => ({
            id: item.id,
            parent_work_item_id: item.parent_work_item_id,
            conversation_coeff: item.conversation_coeff,
            detail_cost_category_id: item.detail_cost_category_id,
          }))
        );
      if (itemsError) throw itemsError;
    }

    message.success('Шаблон обновлен');
    cancelEditing();
    setOpenedTemplate(templateId);
    fetchTemplates();
    refetchTemplateItems(templateId);
  };

  const addWorkToTemplate = async (templateId: string, work: WorkLibraryFull) => {
    const currentItems = loadedTemplateItems[templateId] || [];
    const newPosition = currentItems.length;

    const { data, error } = await supabase
      .from('template_items')
      .insert({
        template_id: templateId,
        kind: 'work',
        work_library_id: work.id,
        material_library_id: null,
        parent_work_item_id: null,
        conversation_coeff: null,
        position: newPosition,
        note: null,
      })
      .select(`
        *,
        works_library:work_library_id(*, work_names(name, unit)),
        detail_cost_categories:detail_cost_category_id(name, location, cost_categories(name))
      `)
      .single();

    if (error) throw error;

    if (data) {
      const newItem: TemplateItemWithDetails = {
        ...data,
        work_name: data.works_library?.work_names?.name,
        work_unit: data.works_library?.work_names?.unit,
        work_item_type: data.works_library?.item_type,
        work_unit_rate: data.works_library?.unit_rate,
        work_currency_type: data.works_library?.currency_type,
      };

      setLoadedTemplateItems(prev => ({
        ...prev,
        [templateId]: [...currentItems, newItem],
      }));
    }

    message.success('Работа добавлена');
  };

  const addMaterialToTemplate = async (templateId: string, material: MaterialLibraryFull) => {
    const currentItems = loadedTemplateItems[templateId] || [];
    const newPosition = currentItems.length;

    const { data, error } = await supabase
      .from('template_items')
      .insert({
        template_id: templateId,
        kind: 'material',
        work_library_id: null,
        material_library_id: material.id,
        parent_work_item_id: null,
        conversation_coeff: null,
        position: newPosition,
        note: null,
      })
      .select(`
        *,
        materials_library:material_library_id(*, material_names(name, unit)),
        detail_cost_categories:detail_cost_category_id(name, location, cost_categories(name))
      `)
      .single();

    if (error) throw error;

    if (data) {
      const newItem: TemplateItemWithDetails = {
        ...data,
        material_name: data.materials_library?.material_names?.name,
        material_unit: data.materials_library?.material_names?.unit,
        material_item_type: data.materials_library?.item_type,
        material_type: data.materials_library?.material_type,
        material_consumption_coefficient: data.materials_library?.consumption_coefficient,
        material_unit_rate: data.materials_library?.unit_rate,
        material_currency_type: data.materials_library?.currency_type,
        material_delivery_price_type: data.materials_library?.delivery_price_type,
        material_delivery_amount: data.materials_library?.delivery_amount,
      };

      setLoadedTemplateItems(prev => ({
        ...prev,
        [templateId]: [...currentItems, newItem],
      }));
    }

    message.success('Материал добавлен');
  };

  return {
    editingTemplateForm,
    editingTemplate,
    editingTemplateCostCategorySearchText,
    setEditingTemplateCostCategorySearchText,
    editingItems,
    setEditingItems,
    startEditing,
    cancelEditing,
    saveEditing,
    addWorkToTemplate,
    addMaterialToTemplate,
  };
};
