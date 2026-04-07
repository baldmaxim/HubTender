import { useState } from 'react';
import { Form, Modal, message } from 'antd';
import { supabase, type Tender, type TenderInsert, type MarkupParameter, type TenderMarkupPercentageInsert } from '../../../../lib/supabase';
import dayjs from 'dayjs';
import type { TenderRecord } from './useTendersData';

export const useTenderActions = (onRefresh: () => void) => {
  const [form] = Form.useForm();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingTender, setEditingTender] = useState<Tender | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  const handleEdit = (record: TenderRecord) => {
    const data = record.raw;
    setEditingTender(data);
    setIsEditMode(true);
    form.setFieldsValue({
      title: data.title,
      tender_number: data.tender_number,
      housing_class: data.housing_class,
      construction_scope: data.construction_scope,
      description: data.description,
      client_name: data.client_name,
      submission_deadline: data.submission_deadline ? dayjs(data.submission_deadline) : null,
      version: data.version,
      area_client: data.area_client,
      area_sp: data.area_sp,
      usd_rate: data.usd_rate,
      eur_rate: data.eur_rate,
      cny_rate: data.cny_rate,
      upload_folder: data.upload_folder,
      bsm_link: data.bsm_link,
      tz_link: data.tz_link,
      qa_form_link: data.qa_form_link,
      project_folder_link: data.project_folder_link,
    });
    setIsModalVisible(true);
  };

  const handleDelete = (record: TenderRecord) => {
    const theme = localStorage.getItem('tenderHub_theme') || 'light';

    Modal.confirm({
      title: 'Удаление тендера',
      content: `Вы уверены, что хотите удалить тендер "${record.tender}"? Это действие нельзя будет отменить.`,
      okText: 'Удалить',
      okType: 'danger',
      cancelText: 'Отмена',
      rootClassName: theme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        try {
          const { error } = await supabase
            .from('tenders')
            .delete()
            .eq('id', record.id);

          if (error) {
            console.error('Ошибка удаления тендера:', error);
            message.error('Не удалось удалить тендер');
          } else {
            message.success(`Тендер "${record.tender}" успешно удален`);
            await onRefresh();
          }
        } catch (error) {
          console.error('Ошибка при удалении тендера:', error);
          message.error('Произошла ошибка при удалении тендера');
        }
      },
    });
  };

  const handleArchive = (record: TenderRecord) => {
    const theme = localStorage.getItem('tenderHub_theme') || 'light';

    Modal.confirm({
      title: 'Архивация тендера',
      content: `Вы уверены, что хотите переместить тендер "${record.tender}" в архив?`,
      okText: 'В архив',
      cancelText: 'Отмена',
      rootClassName: theme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        const { error } = await supabase
          .from('tenders')
          .update({ is_archived: true })
          .eq('id', record.id);

        if (!error) {
          message.success(`Тендер "${record.tender}" перемещен в архив`);
          await onRefresh();
        } else {
          message.error('Не удалось переместить тендер в архив');
        }
      },
    });
  };

  const handleUnarchive = (record: TenderRecord) => {
    const theme = localStorage.getItem('tenderHub_theme') || 'light';

    Modal.confirm({
      title: 'Возврат из архива',
      content: `Вы уверены, что хотите вернуть тендер "${record.tender}" в работу?`,
      okText: 'Вернуть в работу',
      cancelText: 'Отмена',
      rootClassName: theme === 'dark' ? 'dark-modal' : '',
      onOk: async () => {
        const { error } = await supabase
          .from('tenders')
          .update({ is_archived: false })
          .eq('id', record.id);

        if (!error) {
          message.success(`Тендер "${record.tender}" возвращен в работу`);
          await onRefresh();
        } else {
          message.error('Не удалось вернуть тендер из архива');
        }
      },
    });
  };

  const handleCreateNewTender = () => {
    setIsEditMode(false);
    setEditingTender(null);
    form.resetFields();
    setIsModalVisible(true);
  };

  const handleModalOk = async () => {
    try {
      const values = await form.validateFields();

      const tenderData: TenderInsert = {
        title: values.title,
        description: values.description || null,
        client_name: values.client_name,
        tender_number: values.tender_number,
        submission_deadline: values.submission_deadline ? values.submission_deadline.toISOString() : null,
        version: values.version || 1,
        area_client: values.area_client || null,
        area_sp: values.area_sp || null,
        usd_rate: values.usd_rate || null,
        eur_rate: values.eur_rate || null,
        cny_rate: values.cny_rate || null,
        upload_folder: values.upload_folder || null,
        bsm_link: values.bsm_link || null,
        tz_link: values.tz_link || null,
        qa_form_link: values.qa_form_link || null,
        project_folder_link: values.project_folder_link || null,
        housing_class: values.housing_class || null,
        construction_scope: values.construction_scope || null
      };

      if (isEditMode && editingTender) {
        const { data, error } = await supabase
          .from('tenders')
          .update(tenderData)
          .eq('id', editingTender.id)
          .select()
          .single();

        if (error) {
          console.error('Ошибка обновления тендера:', error);
          message.error(`Ошибка при обновлении тендера: ${error.message}`);
        } else if (data) {
          message.success(`Тендер "${values.title}" успешно обновлен`);
          form.resetFields();
          setIsModalVisible(false);
          setIsEditMode(false);
          setEditingTender(null);
          await onRefresh();
        }
      } else {
        const { data, error } = await supabase
          .from('tenders')
          .insert([tenderData])
          .select()
          .single();

        if (error) {
          console.error('Ошибка сохранения тендера:', error);
          message.error(`Ошибка при создании тендера: ${error.message}`);
        } else if (data) {
          try {
            const { data: markupParams, error: paramsError } = await supabase
              .from('markup_parameters')
              .select('*')
              .eq('is_active', true);

            if (!paramsError && markupParams && markupParams.length > 0) {
              const markupRecords: TenderMarkupPercentageInsert[] = markupParams.map((param: MarkupParameter) => ({
                tender_id: data.id,
                markup_parameter_id: param.id,
                value: param.default_value || 0,
              }));

              const { error: insertError } = await supabase
                .from('tender_markup_percentage')
                .insert(markupRecords);

              if (insertError) {
                console.error('Ошибка копирования базовых процентов:', insertError);
              }
            }

            const { data: baseTactic, error: tacticError } = await supabase
              .from('markup_tactics')
              .select('id')
              .eq('name', 'Базовая схема')
              .eq('is_global', true)
              .single();

            if (!tacticError && baseTactic) {
              const { error: updateError } = await supabase
                .from('tenders')
                .update({ markup_tactic_id: baseTactic.id })
                .eq('id', data.id);

              if (updateError) {
                console.error('Ошибка установки базовой схемы наценок:', updateError);
              }
            }
          } catch (markupError) {
            console.error('Ошибка при копировании базовых процентов:', markupError);
          }

          message.success(`Тендер "${values.title}" успешно создан`);
          form.resetFields();
          setIsModalVisible(false);
          await onRefresh();
        }
      }
    } catch (error) {
      console.error('Ошибка валидации:', error);
    }
  };

  const handleModalCancel = () => {
    form.resetFields();
    setIsModalVisible(false);
    setIsEditMode(false);
    setEditingTender(null);
  };

  return {
    form,
    isModalVisible,
    isEditMode,
    handleEdit,
    handleDelete,
    handleArchive,
    handleUnarchive,
    handleCreateNewTender,
    handleModalOk,
    handleModalCancel,
  };
};
