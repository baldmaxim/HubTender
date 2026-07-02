import React from 'react';
import { Card, Typography, Space, Input, Button, Tabs, Tag, App, message } from 'antd';
import { SaveOutlined, DeleteOutlined, EditOutlined, CloseOutlined, ArrowLeftOutlined, CheckOutlined, CopyOutlined } from '@ant-design/icons';
import type { MarkupParameter, MarkupTactic } from '../../../../lib/supabase';
import type { TabKey } from '../types';

const { Title, Text } = Typography;

// Редактор схемы наценок: шапка (имя/копия/удаление/сохранение), карточка
// базовых процентов и вкладки типов позиций. Confirm-диалоги удаления и
// копирования перенесены сюда из хука (JSX-контент + modal.confirm).
export const TacticEditor: React.FC<{
  tactics: MarkupTactic[];
  currentTacticId: string | null;
  currentTacticName: string;
  isEditingName: boolean;
  editingName: string;
  setEditingName: (name: string) => void;
  onStartEditingName: () => void;
  onSaveName: () => void;
  onCancelEditingName: () => void;
  onBackToList: () => void;
  onSaveTactic: () => void;
  performDeleteTactic: (tacticName: string) => Promise<void>;
  performCopyTactic: (newName: string) => Promise<void>;
  markupParameters: MarkupParameter[];
  activeTab: TabKey;
  setActiveTab: (key: TabKey) => void;
  renderSequenceTab: (tabKey: TabKey) => React.ReactNode;
}> = ({
  tactics,
  currentTacticId,
  currentTacticName,
  isEditingName,
  editingName,
  setEditingName,
  onStartEditingName,
  onSaveName,
  onCancelEditingName,
  onBackToList,
  onSaveTactic,
  performDeleteTactic,
  performCopyTactic,
  markupParameters,
  activeTab,
  setActiveTab,
  renderSequenceTab,
}) => {
  const { modal } = App.useApp();

  // Удаление порядка расчета
  const handleDeleteTactic = () => {
    if (!currentTacticId) {
      message.warning('Выберите порядок расчета для удаления');
      return;
    }

    // Найдем название тактики для отображения в подтверждении
    const tacticToDelete = tactics.find(t => t.id === currentTacticId);
    const tacticName = tacticToDelete?.name || 'Без названия';

    modal.confirm({
      title: 'Удаление порядка расчета',
      content: `Вы уверены, что хотите удалить порядок расчета "${tacticName}"? Это действие необратимо.`,
      okText: 'Удалить',
      okType: 'danger',
      cancelText: 'Отмена',
      onOk: () => performDeleteTactic(tacticName),
    });
  };

  // Функция копирования схемы наценок
  const handleCopyTactic = () => {
    if (!currentTacticId) {
      message.warning('Выберите схему для копирования');
      return;
    }

    // Определяем новое название с версионированием
    let baseName = currentTacticName || 'Схема';
    let version = 2;

    // Проверяем, есть ли уже версия в названии
    const versionMatch = baseName.match(/^(.+)_v(\d+)$/);
    if (versionMatch) {
      baseName = versionMatch[1];
      version = parseInt(versionMatch[2]) + 1;
    }

    // Находим следующую доступную версию
    let defaultNewName = `${baseName}_v${version}`;
    while (tactics.some(t => t.name === defaultNewName)) {
      version++;
      defaultNewName = `${baseName}_v${version}`;
    }

    // Показываем модальное окно с возможностью изменить название
    let newName = defaultNewName;

    modal.confirm({
      title: 'Создание копии схемы',
      icon: <CopyOutlined />,
      content: (
        <div style={{ marginTop: 16 }}>
          <Text style={{ display: 'block', marginBottom: 8 }}>
            Будет создана копия схемы "{currentTacticName}" со всеми настройками порядка расчета.
          </Text>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            Название новой схемы:
          </Text>
          <Input
            defaultValue={defaultNewName}
            onChange={(e) => { newName = e.target.value; }}
            placeholder="Введите название схемы"
            style={{ marginBottom: 8 }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Совет: Используйте суффикс _v2, _v3 для версионирования
          </Text>
        </div>
      ),
      okText: 'Создать копию',
      cancelText: 'Отмена',
      onOk: async () => {
        if (!newName || !newName.trim()) {
          message.warning('Название схемы не может быть пустым');
          return Promise.reject();
        }

        // Проверяем уникальность имени
        if (tactics.some(t => t.name === newName.trim())) {
          message.warning('Схема с таким названием уже существует');
          return Promise.reject();
        }

        try {
          await performCopyTactic(newName);
        } catch (error) {
          return Promise.reject(error);
        }
      }
    });
  };

  return (
    <div>
      <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, maxWidth: '400px' }}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Button
              type="primary"
              icon={<ArrowLeftOutlined />}
              onClick={onBackToList}
            >
              К списку схем
            </Button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              {isEditingName ? (
                <Input
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onPressEnter={onSaveName}
                  style={{ flex: 1 }}
                  suffix={
                    <Space size={4}>
                      <Button
                        type="text"
                        size="small"
                        icon={<CheckOutlined />}
                        onClick={onSaveName}
                        style={{ color: '#52c41a' }}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<CloseOutlined />}
                        onClick={onCancelEditingName}
                      />
                    </Space>
                  }
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Title level={4} style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {currentTacticName || 'Новая схема'}
                    {currentTacticId && tactics.find(t => t.id === currentTacticId)?.is_global && (
                      <Tag color="gold" style={{ margin: 0 }}>глобальная</Tag>
                    )}
                  </Title>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={onStartEditingName}
                  />
                </div>
              )}
            </div>
            <Text type="secondary" style={{ fontSize: '14px' }}>
              Настройте последовательность расчета для каждого типа позиций
            </Text>
          </Space>
        </div>
        <Space>
          {currentTacticId && (
            <Button
              icon={<CopyOutlined />}
              onClick={handleCopyTactic}
            >
              Сделать копию
            </Button>
          )}
          {currentTacticId && !tactics.find(t => t.id === currentTacticId)?.is_global && (
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={handleDeleteTactic}
            >
              Удалить
            </Button>
          )}
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={onSaveTactic}
          >
            Сохранить
          </Button>
        </Space>
      </div>

      {/* Панель с базовыми процентами наценок */}
      {markupParameters.length > 0 && (
        <Card
          size="small"
          title={<Text strong>Базовые проценты наценок</Text>}
          style={{ marginBottom: 16 }}
        >
          <Space wrap size="small">
            {markupParameters.map((param, index) => (
              <Tag key={param.id} color="blue">
                {index + 1}. {param.label}: <Text strong>{parseFloat((param.default_value || 0).toFixed(5))}%</Text>
              </Tag>
            ))}
          </Space>
        </Card>
      )}

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as TabKey)}
        style={{ overflow: 'visible', marginTop: '-8px' }}
        items={[
          {
            key: 'works',
            label: 'Работы',
            children: renderSequenceTab('works'),
          },
          {
            key: 'materials',
            label: 'Материалы',
            children: renderSequenceTab('materials'),
          },
          {
            key: 'subcontract_works',
            label: 'Субподрядные работы',
            children: renderSequenceTab('subcontract_works'),
          },
          {
            key: 'subcontract_materials',
            label: 'Субподрядные материалы',
            children: renderSequenceTab('subcontract_materials'),
          },
          {
            key: 'work_comp',
            label: 'Раб-комп',
            children: renderSequenceTab('work_comp'),
          },
          {
            key: 'material_comp',
            label: 'Мат-комп',
            children: renderSequenceTab('material_comp'),
          },
        ]}
      />
    </div>
  );
};
