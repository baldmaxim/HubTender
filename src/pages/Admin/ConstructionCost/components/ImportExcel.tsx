import React from 'react';
import { Upload, Button, message, Modal } from 'antd';
import { UploadOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload';
import * as XLSX from 'xlsx';
import {
  upsertImportedUnits,
  findCostCategoryByNameAndUnit,
  createCostCategory,
  createDetailCostCategory,
} from '../../../../lib/api/costs';
import { getErrorMessage } from '../../../../utils/errors';

const { confirm } = Modal;

interface ImportExcelProps {
  availableUnits: string[];
  uploading: boolean;
  setUploading: (uploading: boolean) => void;
  setImportErrors: (errors: string[]) => void;
  setSqlContent: (sql: string) => void;
  setSqlModalOpen: (open: boolean) => void;
  loadUnits: () => Promise<void>;
  loadData: () => Promise<void>;
}

export const ImportExcel: React.FC<ImportExcelProps> = ({
  availableUnits,
  uploading,
  setUploading,
  setImportErrors,
  setSqlContent,
  setSqlModalOpen,
  loadUnits,
  loadData,
}) => {
  const handleExcelImport = async (file: UploadFile) => {
    setUploading(true);
    setImportErrors([]);

    try {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const workbook = XLSX.read(e.target?.result, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

          const rows = jsonData.slice(1) as unknown[][];

          if (rows.length === 0) {
            message.error('Excel файл пуст или имеет неверный формат');
            setUploading(false);
            return;
          }

          interface DetailItem {
            categoryKey: string;
            orderNum: number;
            name: string;
            unit: string;
            location: string;
            rowNum: number;
          }
          const categoriesMap = new Map<string, { name: string; unit: string }>();
          const detailsList: DetailItem[] = [];
          const unknownUnits = new Set<string>();
          const errors: string[] = [];

          rows.forEach((row, index) => {
            const rowNum = index + 2;

            if (!row || row.length < 6) {
              errors.push(`Строка ${rowNum}: неполные данные (требуется 6 столбцов)`);
              return;
            }

            const [orderNum, categoryName, categoryUnit, detailName, detailUnit, location] = row;

            if (!categoryName || !categoryUnit || !detailName || !detailUnit || !location) {
              errors.push(`Строка ${rowNum}: пустые обязательные поля`);
              return;
            }

            const catUnit = String(categoryUnit).trim();
            if (!availableUnits.includes(catUnit)) {
              unknownUnits.add(catUnit);
            }

            const detUnit = String(detailUnit).trim();
            if (!availableUnits.includes(detUnit)) {
              unknownUnits.add(detUnit);
            }

            const categoryKey = `${categoryName}_${catUnit}`;
            if (!categoriesMap.has(categoryKey)) {
              categoriesMap.set(categoryKey, {
                name: String(categoryName).trim(),
                unit: catUnit,
              });
            }

            detailsList.push({
              categoryKey,
              orderNum: Number(orderNum) || 0,
              name: String(detailName).trim(),
              unit: detUnit,
              location: String(location).trim(),
              rowNum,
            });
          });

          if (unknownUnits.size > 0) {
            const newUnits = Array.from(unknownUnits).sort();

            confirm({
              title: 'Найдены новые единицы измерения',
              icon: <ExclamationCircleOutlined />,
              content: (
                <div>
                  <p>Обнаружены неизвестные единицы измерения:</p>
                  <p><strong>{newUnits.join(', ')}</strong></p>
                  <p>Вы можете:</p>
                  <ul>
                    <li>Автоматически добавить их в базу данных (рекомендуется)</li>
                    <li>Получить SQL запрос для ручного добавления</li>
                  </ul>
                </div>
              ),
              okText: 'Добавить автоматически',
              cancelText: 'Показать SQL',
              onOk: async () => {
                try {
                  const unitsToInsert = newUnits.map((unit, index) => ({
                    code: unit,
                    name: unit,
                    name_short: unit,
                    category: 'импортированная',
                    sort_order: 150 + (index * 10),
                    is_active: true,
                  }));

                  await upsertImportedUnits(unitsToInsert);

                  message.success(`Добавлено ${newUnits.length} новых единиц измерения`);
                  await loadUnits();
                  message.info('Повторяем импорт с новыми единицами...');
                  handleExcelImport(file);
                } catch (error) {
                  console.error('Ошибка добавления единиц:', error);
                  message.error('Не удалось добавить новые единицы измерения');
                  setUploading(false);
                }
              },
              onCancel: () => {
                const sqlInserts = newUnits.map((unit, index) => {
                  const nextSortOrder = 150 + (index * 10);
                  return `('${unit}', '${unit}', '${unit}', 'импортированная', ${nextSortOrder})`;
                }).join(',\n  ');

                const sqlQuery = `-- SQL для добавления новых единиц измерения в таблицу units
-- Выполните этот запрос в Supabase перед повторным импортом

INSERT INTO public.units (code, name, name_short, category, sort_order)
VALUES
  ${sqlInserts}
ON CONFLICT (code) DO UPDATE SET
  is_active = true,
  updated_at = NOW();

-- Проверка добавленных единиц:
SELECT * FROM public.units
WHERE code IN (${newUnits.map(u => `'${u}'`).join(', ')})
ORDER BY sort_order;`;

                setSqlContent(sqlQuery);
                setSqlModalOpen(true);
                setImportErrors([
                  `Найдены неизвестные единицы измерения: ${newUnits.join(', ')}`,
                  'Выполните предложенный SQL запрос в Supabase, затем повторите импорт',
                  ...errors
                ]);
                setUploading(false);
              }
            });
            return;
          }

          if (errors.length > 0) {
            setImportErrors(errors);
            message.error('Импорт прерван из-за ошибок в данных');
            setUploading(false);
            return;
          }

          const categoryIdMap = new Map<string, string>();
          const saveErrors: string[] = [];

          for (const [key, category] of categoriesMap.entries()) {
            try {
              const existing = await findCostCategoryByNameAndUnit(category.name, category.unit);
              if (existing) {
                categoryIdMap.set(key, existing.id);
              } else {
                const created = await createCostCategory({ name: category.name, unit: category.unit });
                categoryIdMap.set(key, created.id);
              }
            } catch (err) {
              saveErrors.push(`Ошибка создания категории "${category.name}": ${getErrorMessage(err)}`);
            }
          }

          let successCount = 0;
          for (const detail of detailsList) {
            const categoryId = categoryIdMap.get(detail.categoryKey);
            if (categoryId) {
              try {
                await createDetailCostCategory({
                  cost_category_id: categoryId,
                  order_num: detail.orderNum,
                  name: detail.name,
                  unit: detail.unit,
                  location: detail.location,
                });
                successCount++;
              } catch (err) {
                saveErrors.push(`Строка ${detail.rowNum}: ${getErrorMessage(err)}`);
              }
            }
          }

          if (saveErrors.length > 0) {
            setImportErrors(saveErrors);
            message.warning(`Импортировано ${successCount} из ${detailsList.length} записей. Есть ошибки.`);
          } else {
            message.success(`Успешно импортировано ${successCount} записей`);
          }

          await loadData();
        } catch (error) {
          console.error('Ошибка обработки файла:', error);
          message.error('Ошибка обработки файла Excel: ' + getErrorMessage(error));
          setImportErrors([getErrorMessage(error)]);
        } finally {
          setUploading(false);
        }
      };

      reader.readAsBinaryString(file as unknown as Blob);
    } catch (error) {
      console.error('Ошибка импорта:', error);
      message.error('Ошибка импорта файла');
      setImportErrors([getErrorMessage(error)]);
      setUploading(false);
    }

    return false;
  };

  return (
    <Upload
      accept=".xlsx,.xls"
      beforeUpload={handleExcelImport}
      showUploadList={false}
    >
      <Button
        icon={<UploadOutlined />}
        loading={uploading}
      >
        Импорт из Excel
      </Button>
    </Upload>
  );
};
