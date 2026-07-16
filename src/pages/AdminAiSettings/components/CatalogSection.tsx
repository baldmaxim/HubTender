import { useMemo, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Input, InputNumber, Select, Space, Table, Tag, Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DatabaseOutlined, ReloadOutlined } from '@ant-design/icons';
import type { AiCatalogModel, AiCatalogView, AiSettingsView } from '../../../lib/api/adminAi';
import {
  FREE_VARIANT_WARNING,
  ModelFilters,
  catalogStateDisplay,
  expirationDisplay,
  filterModels,
  modelAuthors,
  pricePerMillionDisplay,
  sortModels,
} from '../../../lib/quality/openRouterAdminPolicy';

const { Text } = Typography;

interface Props {
  catalog: AiCatalogView | null;
  settings: AiSettingsView | null;
  loading: boolean;
  selectedModelId: string | null;
  onSelect: (modelId: string) => void;
  onRefresh: () => void;
}

/** §18.B/§19: каталог моделей. Выбор строки — ЕДИНСТВЕННЫЙ способ задать
 *  модель: free-text ввода model ID нет по построению. */
export default function CatalogSection({
  catalog, settings, loading, selectedModelId, onSelect, onRefresh,
}: Props) {
  const [filters, setFilters] = useState<ModelFilters>({ testState: 'all' });

  const models = useMemo(
    () => sortModels(filterModels(catalog?.models, filters, settings)),
    [catalog?.models, filters, settings]
  );
  const authors = useMemo(() => modelAuthors(catalog?.models), [catalog?.models]);
  const state = catalogStateDisplay(catalog);
  const catalogUnavailable = !catalog || catalog.status === 'unavailable';

  const columns: ColumnsType<AiCatalogModel> = [
    {
      title: 'Название',
      key: 'name',
      width: 260,
      render: (_, m) => (
        <Space direction="vertical" size={0}>
          <Space size={6}>
            <Text strong>{m.name}</Text>
            {m.is_free_variant && (
              <Tooltip title={FREE_VARIANT_WARNING}>
                <Tag color="orange">free</Tag>
              </Tooltip>
            )}
          </Space>
          <Text type="secondary" copyable={{ text: m.id }} style={{ fontSize: 12 }}>
            {m.id}
          </Text>
        </Space>
      ),
    },
    { title: 'Организация', dataIndex: 'author', key: 'author', width: 110 },
    {
      title: 'Контекст',
      key: 'context',
      width: 100,
      align: 'right',
      render: (_, m) => (m.context_length === null ? '—' : m.context_length.toLocaleString('ru-RU')),
    },
    {
      title: 'Макс. вывод',
      key: 'maxout',
      width: 100,
      align: 'right',
      render: (_, m) =>
        m.max_completion_tokens === null ? '—' : m.max_completion_tokens.toLocaleString('ru-RU'),
    },
    {
      title: 'Вход / 1M',
      key: 'inprice',
      width: 100,
      align: 'right',
      render: (_, m) => pricePerMillionDisplay(m.price_per_1m_input_tokens),
    },
    {
      title: 'Выход / 1M',
      key: 'outprice',
      width: 100,
      align: 'right',
      render: (_, m) => pricePerMillionDisplay(m.price_per_1m_output_tokens),
    },
    {
      title: 'Модальности',
      key: 'modality',
      width: 130,
      render: (_, m) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {(m.input_modalities ?? []).join('+')} → {(m.output_modalities ?? []).join('+')}
        </Text>
      ),
    },
    {
      title: 'Structured output',
      key: 'structured',
      width: 120,
      align: 'center',
      render: (_, m) =>
        m.structured_outputs_indicated ? (
          <Tooltip title="Предварительный признак каталога: фактическая поддержка подтверждается проверкой модели HUBTender">
            <Tag color="blue">каталог: да</Tag>
          </Tooltip>
        ) : (
          <Tag>нет данных</Tag>
        ),
    },
    {
      title: 'Истекает',
      key: 'exp',
      width: 100,
      render: (_, m) => {
        const e = expirationDisplay(m.expiration_date);
        return e.expiring ? <Tag color="orange">{e.text}</Tag> : <Text type="secondary">—</Text>;
      },
    },
    {
      title: 'Тест HUBTender',
      key: 'test',
      width: 120,
      render: (_, m) => {
        const test = settings?.model_test;
        if (test?.tested_model_id === m.id && test.status === 'passed')
          return <Tag color="green">пройден</Tag>;
        if (test?.tested_model_id === m.id && test.status === 'failed')
          return <Tag color="red">провален</Tag>;
        return <Tag>не проверялась</Tag>;
      },
    },
  ];

  return (
    <Card
      size="small"
      title={
        <Space>
          <DatabaseOutlined />
          <span>Каталог моделей OpenRouter</span>
          <Tag>{catalog?.total_count ?? 0}</Tag>
        </Space>
      }
      extra={
        <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading} data-testid="ai-refresh-models">
          Обновить каталог
        </Button>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Alert type={state.tone} showIcon message={state.text} data-testid="ai-catalog-state" />
        <Space wrap size={8}>
          <Input.Search
            allowClear
            placeholder="Поиск: название / ID / описание"
            style={{ width: 260 }}
            onSearch={(v) => setFilters((f) => ({ ...f, search: v }))}
            onChange={(e) => {
              if (!e.target.value) setFilters((f) => ({ ...f, search: '' }));
            }}
            data-testid="ai-model-search"
          />
          <Select
            allowClear
            placeholder="Организация"
            style={{ width: 160 }}
            options={authors.map((a) => ({ value: a, label: a }))}
            onChange={(v) => setFilters((f) => ({ ...f, author: v ?? undefined }))}
          />
          <InputNumber
            placeholder="Мин. контекст"
            min={0}
            style={{ width: 130 }}
            onChange={(v) => setFilters((f) => ({ ...f, minContext: v === null ? null : Number(v) }))}
          />
          <InputNumber
            placeholder="Вход ≤ $/1M"
            min={0}
            style={{ width: 120 }}
            onChange={(v) =>
              setFilters((f) => ({ ...f, maxInputPricePer1M: v === null ? null : Number(v) }))
            }
          />
          <InputNumber
            placeholder="Выход ≤ $/1M"
            min={0}
            style={{ width: 120 }}
            onChange={(v) =>
              setFilters((f) => ({ ...f, maxOutputPricePer1M: v === null ? null : Number(v) }))
            }
          />
          <Select
            value={filters.testState ?? 'all'}
            style={{ width: 150 }}
            options={[
              { value: 'all', label: 'Все модели' },
              { value: 'tested', label: 'Тест пройден' },
              { value: 'failed', label: 'Тест провален' },
              { value: 'untested', label: 'Не проверялись' },
            ]}
            onChange={(v) => setFilters((f) => ({ ...f, testState: v }))}
          />
          <Checkbox
            checked={!!filters.structuredOutputsOnly}
            onChange={(e) => setFilters((f) => ({ ...f, structuredOutputsOnly: e.target.checked }))}
          >
            Только structured output
          </Checkbox>
          <Checkbox
            checked={!!filters.selectedOnly}
            onChange={(e) => setFilters((f) => ({ ...f, selectedOnly: e.target.checked }))}
          >
            Выбранная
          </Checkbox>
        </Space>
        <Table<AiCatalogModel>
          size="small"
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={models}
          scroll={{ x: 1250 }}
          pagination={{ pageSize: 15, showSizeChanger: true, showTotal: (t) => `Всего: ${t}` }}
          rowSelection={{
            type: 'radio',
            selectedRowKeys: selectedModelId ? [selectedModelId] : [],
            onChange: (keys) => {
              if (keys.length > 0) onSelect(String(keys[0]));
            },
            getCheckboxProps: () => ({ disabled: catalogUnavailable }),
          }}
          onRow={(m) => ({
            onClick: () => {
              if (!catalogUnavailable) onSelect(m.id);
            },
            style: { cursor: catalogUnavailable ? 'not-allowed' : 'pointer' },
          })}
          data-testid="ai-models-table"
        />
      </Space>
    </Card>
  );
}
