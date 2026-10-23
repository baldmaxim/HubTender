import { useEffect, useState } from 'react';
import type { FC } from 'react';
import { Button, DatePicker, Form, Input, InputNumber, Modal, Select, message, theme as antdTheme } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { EnvironmentOutlined } from '@ant-design/icons';
import { listProjects } from '../../../lib/api/projects';
import type { ProjectWithTender } from '../../../lib/api/projects';
import type {
  ConstructionObjectStatus,
  IConstructionObject,
  IConstructionObjectInput,
} from '../../../lib/types/types';
import { geocodeAddress, roundCoord } from '../utils/geocode';
import type { IGeoPoint } from '../utils/geocode';
import { getObjectsCssVars } from '../utils/cssVars';
import { PointPickerMap } from './PointPickerMap';
import styles from '../Objects.module.css';

interface IObjectModalProps {
  open: boolean;
  editing: IConstructionObject | null;
  onClose: () => void;
  onSave: (input: IConstructionObjectInput, id?: string) => Promise<boolean>;
}

interface IFormValues {
  name: string;
  customer: string | null;
  area: number | null;
  address: string;
  status: ConstructionObjectStatus;
  project_id: string | null;
  /** Первая очередь (необязательно), если комплекс вводился этапами. */
  commissioning_start_date: Dayjs | null;
  /** Дата ввода (последней очереди). */
  commissioning_date: Dayjs | null;
}

const API_DATE_FORMAT = 'YYYY-MM-DD';

const STATUS_OPTIONS = [
  { value: 'archive', label: 'Построен' },
  { value: 'current', label: 'Текущий' },
];

const getInitialValues = (editing: IConstructionObject | null): Partial<IFormValues> =>
  editing
    ? {
        name: editing.name,
        customer: editing.customer,
        area: editing.area,
        address: editing.address,
        status: editing.status,
        project_id: editing.project_id,
        commissioning_start_date: editing.commissioning_start_date
          ? dayjs(editing.commissioning_start_date)
          : null,
        commissioning_date: editing.commissioning_date ? dayjs(editing.commissioning_date) : null,
      }
    : { status: 'archive' };

export const ObjectModal: FC<IObjectModalProps> = ({ open, editing, onClose, onSave }) => {
  const { token } = antdTheme.useToken();
  const [form] = Form.useForm<IFormValues>();
  const status = Form.useWatch('status', form);
  const [point, setPoint] = useState<IGeoPoint | null>(null);
  const [centerNonce, setCenterNonce] = useState(0);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState<ProjectWithTender[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  // Точка и счётчик центрирования — отдельно от формы (поля lat/lng руками не вводятся).
  useEffect(() => {
    if (!open) return;
    setPoint(
      editing && editing.latitude !== null && editing.longitude !== null
        ? { lat: editing.latitude, lng: editing.longitude }
        : null,
    );
    setCenterNonce(0);
  }, [open, editing]);

  // Список договоров для привязки текущего объекта.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setProjectsLoading(true);
    listProjects()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch((e) => {
        console.error('Error loading projects:', e);
        if (!cancelled) message.error('Не удалось загрузить список договоров');
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleFindByAddress = async () => {
    const address = (form.getFieldValue('address') as string | undefined)?.trim();
    if (!address) {
      message.warning('Введите адрес');
      return;
    }
    setSearching(true);
    try {
      const found = await geocodeAddress(address);
      if (!found) {
        message.warning('Адрес не найден, поставьте точку на карте');
        return;
      }
      setPoint({ lat: roundCoord(found.lat), lng: roundCoord(found.lng) });
      setCenterNonce((n) => n + 1);
    } catch (e) {
      console.error('Geocoding failed:', e);
      message.error('Не удалось выполнить поиск адреса');
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = async () => {
    let values: IFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const input: IConstructionObjectInput = {
      name: values.name.trim(),
      customer: values.customer?.trim() || null,
      area: values.area ?? null,
      address: values.address.trim(),
      latitude: point ? roundCoord(point.lat) : null,
      longitude: point ? roundCoord(point.lng) : null,
      status: values.status,
      project_id: values.status === 'current' ? (values.project_id ?? null) : null,
      commissioning_start_date: values.commissioning_start_date
        ? values.commissioning_start_date.format(API_DATE_FORMAT)
        : null,
      commissioning_date: values.commissioning_date
        ? values.commissioning_date.format(API_DATE_FORMAT)
        : null,
    };
    setSaving(true);
    try {
      const ok = await onSave(input, editing?.id);
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={editing ? 'Изменить объект' : 'Добавить объект'}
      okText="Сохранить"
      cancelText="Отмена"
      confirmLoading={saving}
      onOk={handleSubmit}
      onCancel={onClose}
      destroyOnClose
      maskClosable={false}
      width={640}
      className={styles.modal}
    >
      <Form<IFormValues>
        key={editing?.id ?? 'new'}
        form={form}
        layout="vertical"
        className={styles.form}
        // Модалка рендерится в портале вне страницы — переменные темы задаём здесь.
        style={getObjectsCssVars(token)}
        initialValues={getInitialValues(editing)}
      >
        <Form.Item
          name="name"
          label="Название"
          rules={[{ required: true, whitespace: true, message: 'Укажите название' }]}
        >
          <Input allowClear />
        </Form.Item>
        <Form.Item name="customer" label="Заказчик">
          <Input allowClear placeholder="Заказчик или девелопер" />
        </Form.Item>
        <Form.Item name="area" label="Площадь, м²">
          <InputNumber<number> min={0} decimalSeparator="," />
        </Form.Item>
        <Form.Item
          name="address"
          label="Адрес"
          rules={[{ required: true, whitespace: true, message: 'Укажите адрес' }]}
        >
          <Input allowClear />
        </Form.Item>
        <Form.Item name="status" label="Статус">
          <Select options={STATUS_OPTIONS} />
        </Form.Item>
        {status === 'current' && (
          <Form.Item name="project_id" label="Договор">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              loading={projectsLoading}
              placeholder="Не выбран"
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Form.Item>
        )}
        <div className={styles.dateRow}>
          <Form.Item
            name="commissioning_start_date"
            label="Ввод: с"
            tooltip="Дата ввода первой очереди — только если комплекс вводился этапами"
            dependencies={['commissioning_date']}
            rules={[
              ({ getFieldValue }) => ({
                validator: (_rule, value: Dayjs | null | undefined) => {
                  const end = getFieldValue('commissioning_date') as Dayjs | null | undefined;
                  if (value && end && value.isAfter(end, 'day')) {
                    return Promise.reject(new Error('Не позже даты ввода'));
                  }
                  return Promise.resolve();
                },
              }),
            ]}
          >
            <DatePicker format="DD.MM.YYYY" placeholder="Необязательно" />
          </Form.Item>
          <Form.Item
            name="commissioning_date"
            label="Ввод: по / дата ввода"
            dependencies={['commissioning_start_date']}
            rules={[
              ({ getFieldValue }) => ({
                validator: (_rule, value: Dayjs | null | undefined) => {
                  const start = getFieldValue('commissioning_start_date') as Dayjs | null | undefined;
                  if (start && !value) {
                    return Promise.reject(new Error('Укажите дату ввода'));
                  }
                  return Promise.resolve();
                },
              }),
            ]}
          >
            <DatePicker format="DD.MM.YYYY" />
          </Form.Item>
        </div>
        <Form.Item label="Координаты" className={styles.lastItem}>
          <div className={styles.pickerActions}>
            <Button icon={<EnvironmentOutlined />} loading={searching} onClick={handleFindByAddress}>
              Найти по адресу
            </Button>
            <Button disabled={!point} onClick={() => setPoint(null)}>
              Убрать точку
            </Button>
          </div>
          <PointPickerMap point={point} centerNonce={centerNonce} onChange={setPoint} />
          <div className={styles.pickerHint}>
            {point
              ? `Точка: ${roundCoord(point.lat)}, ${roundCoord(point.lng)}. Её можно перетащить.`
              : 'Точка не задана: кликните по карте или найдите адрес.'}
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
};
