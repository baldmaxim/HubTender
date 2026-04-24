import React, { useState } from 'react';
import { Modal, Upload, message, Table, Alert } from 'antd';
import type { UploadFile } from 'antd/es/upload';
import { InboxOutlined } from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { supabase, type ConstructionScope, type TenderStatus } from '../../lib/supabase';
import dayjs from 'dayjs';

interface ImportTendersModalProps {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  constructionScopes: ConstructionScope[];
  statuses: TenderStatus[];
}

interface ParsedTender {
  tender_number?: string;
  title: string;
  client_name: string;
  object_address?: string;
  construction_scope?: string;
  area?: number;
  submission_date?: string;
  chronology?: string;
  construction_start_date?: string;
  site_visit_date?: string;
  site_visit_photo_url?: string;
  has_tender_package?: string;
  invitation_date?: string;
  status?: string;
}

const ImportTendersModal: React.FC<ImportTendersModalProps> = ({
  open,
  onCancel,
  onSuccess,
  constructionScopes,
  statuses,
}) => {
  const [parsedData, setParsedData] = useState<ParsedTender[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const parseExcelDate = (excelDate: unknown): string | null => {
    if (!excelDate) return null;

    // Если это уже строка в формате даты
    if (typeof excelDate === 'string') {
      const parsed = dayjs(excelDate, ['DD.MM.YYYY', 'YYYY-MM-DD'], true);
      return parsed.isValid() ? parsed.toISOString() : null;
    }

    // Если это число (Excel serial date)
    if (typeof excelDate === 'number') {
      const date = XLSX.SSF.parse_date_code(excelDate);
      if (date) {
        return dayjs(`${date.y}-${date.m}-${date.d}`).toISOString();
      }
    }

    return null;
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);

        // Отладка: показываем первую строку для проверки названий колонок
        if (jsonData.length > 0) {
          console.log('Первая строка Excel:', jsonData[0]);
          console.log('Найденные колонки:', Object.keys(jsonData[0]));
        }

        const parsed: ParsedTender[] = (jsonData as Record<string, unknown>[]).map((row) => {
          const str = (v: unknown): string | undefined => v ? String(v) : undefined;
          return {
            tender_number: str(row['Номер тендера'] ?? row['Номер']),
            title: str(row['Наименование ЖК'] ?? row['Наименование']) ?? '',
            client_name: str(row['Заказчик']) ?? '',
            object_address: str(row['Адрес объекта'] ?? row['Адрес']),
            construction_scope: str(row['Работа'] ?? row['Объем строительства']),
            area: row['Площадь по СП, м2'] ? parseFloat(String(row['Площадь по СП, м2'])) : (row['Площадь'] ? parseFloat(String(row['Площадь'])) : undefined),
            submission_date: parseExcelDate(row['Дата подачи КП']) || undefined,
            chronology: str(row['Хронологии тендеров (дата выхода на площадку)'] ?? row['Хронология']),
            construction_start_date: parseExcelDate(row['Дата выхода на строительную площадку']) || undefined,
            site_visit_date: parseExcelDate(row['Дата посещения площадки']) || undefined,
            site_visit_photo_url: str(row['Фото посещения площадки']),
            has_tender_package: str(row['Наличие тендерного пакета']),
            invitation_date: parseExcelDate(row['Когда поступило приглашение']) || parseExcelDate(row['Дата приглашения']) || undefined,
            status: str(row['Статус']),
          };
        });

        setParsedData(parsed);
        message.success(`Загружено ${parsed.length} записей из файла`);
      } catch (error) {
        message.error('Ошибка чтения файла: ' + (error as Error).message);
      }
    };

    reader.readAsArrayBuffer(file);
    return false;
  };

  const handleImport = async () => {
    if (parsedData.length === 0) {
      message.warning('Нет данных для импорта');
      return;
    }

    setLoading(true);

    try {
      // Получить максимальный sort_order
      const { data: maxData } = await supabase
        .from('tender_registry')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1);

      let nextSortOrder = maxData && maxData.length > 0 ? maxData[0].sort_order + 1 : 1;

      // Создаем маппинг для объемов строительства
      const scopeMap = new Map(
        constructionScopes.map(scope => [scope.name.toLowerCase(), scope.id])
      );

      // Создаем маппинг для статусов
      const statusMap = new Map(
        statuses.map(status => [status.name.toLowerCase(), status.id])
      );

      const tendersToInsert = parsedData.map(tender => {
        const construction_scope_id = tender.construction_scope
          ? scopeMap.get(tender.construction_scope.toLowerCase())
          : undefined;

        const status_id = tender.status
          ? statusMap.get(tender.status.toLowerCase())
          : undefined;

        // Конвертация старого текстового поля chronology в JSONB массив
        const chronology_items = tender.chronology && tender.chronology.trim()
          ? [{ date: null, text: tender.chronology, type: 'default' }]
          : [];

        // Конвертация старого текстового поля has_tender_package в JSONB массив
        const tender_package_items = tender.has_tender_package && tender.has_tender_package.trim()
          ? [{ date: null, text: tender.has_tender_package }]
          : [];

        return {
          tender_number: tender.tender_number || null,
          title: tender.title,
          client_name: tender.client_name,
          object_address: tender.object_address || null,
          construction_scope_id: construction_scope_id || null,
          area: tender.area || null,
          submission_date: tender.submission_date || null,
          chronology_items,
          construction_start_date: tender.construction_start_date || null,
          site_visit_date: tender.site_visit_date || null,
          site_visit_photo_url: tender.site_visit_photo_url || null,
          tender_package_items,
          invitation_date: tender.invitation_date || null,
          status_id: status_id || null,
          sort_order: nextSortOrder++,
          is_archived: false,
        };
      });

      const { error } = await supabase
        .from('tender_registry')
        .insert(tendersToInsert);

      if (error) {
        message.error('Ошибка импорта: ' + error.message);
      } else {
        message.success(`Успешно импортировано ${tendersToInsert.length} тендеров`);
        setParsedData([]);
        setFileList([]);
        onSuccess();
      }
    } catch (error) {
      message.error('Ошибка при импорте: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setParsedData([]);
    setFileList([]);
    onCancel();
  };

  const previewColumns = [
    {
      title: 'Номер тендера',
      dataIndex: 'tender_number',
      key: 'tender_number',
      width: 120,
      render: (val: string) => val || '-',
    },
    {
      title: 'Наименование',
      dataIndex: 'title',
      key: 'title',
      width: 150,
    },
    {
      title: 'Заказчик',
      dataIndex: 'client_name',
      key: 'client_name',
      width: 150,
    },
    {
      title: 'Адрес объекта',
      dataIndex: 'object_address',
      key: 'object_address',
      width: 120,
      render: (val: string) => val || '-',
    },
    {
      title: 'Объем строит-ва',
      dataIndex: 'construction_scope',
      key: 'construction_scope',
      width: 120,
    },
    {
      title: 'Площадь',
      dataIndex: 'area',
      key: 'area',
      width: 80,
      render: (val: number) => val ? `${val.toFixed(2)}` : '-',
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      width: 120,
    },
    {
      title: 'Дата подачи КП',
      dataIndex: 'submission_date',
      key: 'submission_date',
      width: 100,
      render: (val: string) => val ? dayjs(val).format('DD.MM.YYYY') : '-',
    },
  ];

  return (
    <Modal
      title="Импорт тендеров из Excel"
      open={open}
      onCancel={handleCancel}
      onOk={handleImport}
      okText="Импортировать"
      cancelText="Отмена"
      width={900}
      confirmLoading={loading}
      okButtonProps={{ disabled: parsedData.length === 0 }}
    >
      <Alert
        message="Формат Excel файла"
        description="Файл должен содержать следующие колонки: Номер тендера, Наименование ЖК, Заказчик, Адрес объекта, Работа, Площадь по СП м2, Дата подачи КП, Хронологии тендеров (дата выхода на площадку), Дата выхода на строительную площадку, Дата посещения площадки, Фото посещения площадки, Наличие тендерного пакета, Когда поступило приглашение, Статус"
        type="info"
        style={{ marginBottom: 16 }}
      />

      <Upload.Dragger
        fileList={fileList}
        beforeUpload={handleFileUpload}
        onRemove={() => {
          setFileList([]);
          setParsedData([]);
        }}
        accept=".xlsx,.xls"
        maxCount={1}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Нажмите или перетащите файл Excel для загрузки</p>
        <p className="ant-upload-hint">
          Поддерживаются файлы форматов .xlsx и .xls
        </p>
      </Upload.Dragger>

      {parsedData.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4>Предварительный просмотр ({parsedData.length} записей)</h4>
          <Table
            dataSource={parsedData}
            columns={previewColumns}
            rowKey={(record, index) => index?.toString() || '0'}
            pagination={{ pageSize: 5 }}
            scroll={{ x: 600 }}
            size="small"
          />
        </div>
      )}
    </Modal>
  );
};

export default ImportTendersModal;
