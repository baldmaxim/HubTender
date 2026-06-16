import { useState } from 'react';
import { Form, Modal, message } from 'antd';
import type { Tender, TenderMarkupPercentageInsert } from '../../../../lib/supabase';
import {
  createTender,
  adminPatchTender,
  deleteTender,
} from '../../../../lib/api/tenders';
import { fetchCbrRates } from '../../../../lib/api/exchangeRates';
import {
  listActiveMarkupParameters,
  insertTenderMarkupPercentages,
  findGlobalMarkupTacticByName,
  setTenderMarkupTacticId,
} from '../../../../lib/api/markup';
import dayjs from 'dayjs';
import type { TenderRecord } from './useTendersData';

export const useTenderActions = (onRefresh: () => void) => {
  const [form] = Form.useForm();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingTender, setEditingTender] = useState<Tender | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [ratesLoading, setRatesLoading] = useState(false);

  // Подтянуть курсы ЦБ РФ на сегодня и заполнить поля формы. При сбое поля
  // остаются пустыми (их уже очистил resetFields) + предупреждение.
  const loadCbrRates = async () => {
    setRatesLoading(true);
    try {
      const rates = await fetchCbrRates(dayjs().format('YYYY-MM-DD'));
      form.setFieldsValue({
        usd_rate: rates.usd,
        eur_rate: rates.eur,
        cny_rate: rates.cny,
      });
    } catch (err) {
      console.error('Не удалось загрузить курсы ЦБ РФ:', err);
      message.warning('Не удалось загрузить курсы ЦБ РФ — введите вручную');
    } finally {
      setRatesLoading(false);
    }
  };

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
        const hide = message.loading('Удаление тендера…', 0);
        try {
          await deleteTender(record.id);
          hide();
          message.success(`Тендер "${record.tender}" успешно удален`);
          await onRefresh();
        } catch (error) {
          hide();
          console.error('Ошибка при удалении тендера:', error);
          message.error('Не удалось удалить тендер');
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
        try {
          await adminPatchTender(record.id, { is_archived: true });
          message.success(`Тендер "${record.tender}" перемещен в архив`);
          await onRefresh();
        } catch {
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
        try {
          await adminPatchTender(record.id, { is_archived: false });
          message.success(`Тендер "${record.tender}" возвращен в работу`);
          await onRefresh();
        } catch {
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
    void loadCbrRates(); // не блокирует открытие модалки
  };

  const handleModalOk = async () => {
    try {
      const values = await form.validateFields();

      const tenderData = {
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
        construction_scope: values.construction_scope || null,
      };

      if (isEditMode && editingTender) {
        try {
          await adminPatchTender(editingTender.id, tenderData);
          message.success(`Тендер "${values.title}" успешно обновлен`);
          form.resetFields();
          setIsModalVisible(false);
          setIsEditMode(false);
          setEditingTender(null);
          await onRefresh();
        } catch (err) {
          console.error('Ошибка обновления тендера:', err);
          message.error('Ошибка при обновлении тендера');
        }
      } else {
        try {
          const data = await createTender(tenderData);
          try {
            const markupParams = await listActiveMarkupParameters();
            if (markupParams.length > 0) {
              const markupRecords: TenderMarkupPercentageInsert[] = markupParams.map((param) => ({
                tender_id: data.id,
                markup_parameter_id: param.id,
                value: param.default_value || 0,
              }));
              await insertTenderMarkupPercentages(markupRecords);
            }
            const baseTactic = await findGlobalMarkupTacticByName('Базовая схема');
            if (baseTactic) {
              await setTenderMarkupTacticId(data.id, baseTactic.id);
            }
          } catch (markupError) {
            console.error('Ошибка при копировании базовых процентов:', markupError);
          }

          message.success(`Тендер "${values.title}" успешно создан`);
          form.resetFields();
          setIsModalVisible(false);
          await onRefresh();
        } catch (err) {
          console.error('Ошибка сохранения тендера:', err);
          message.error('Ошибка при создании тендера');
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
    ratesLoading,
    handleEdit,
    handleDelete,
    handleArchive,
    handleUnarchive,
    handleCreateNewTender,
    handleModalOk,
    handleModalCancel,
  };
};
