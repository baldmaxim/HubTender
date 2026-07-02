import React from 'react';
import { Card, Typography, Space, Input, Button, Spin, List, Tag, theme } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { MarkupTactic } from '../../../../lib/types';

const { Title, Text } = Typography;

/** Список схем наценок (карточки) с поиском и созданием новой схемы. */
export const TacticsList: React.FC<{
  tactics: MarkupTactic[];
  loadingTactics: boolean;
  tacticSearchText: string;
  setTacticSearchText: (text: string) => void;
  onSelectTactic: (tacticId: string) => void;
  onCreateNew: () => void;
}> = ({ tactics, loadingTactics, tacticSearchText, setTacticSearchText, onSelectTactic, onCreateNew }) => {
  const { token } = theme.useToken();

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Схемы наценок
          </Title>
          <Text type="secondary" style={{ fontSize: '14px' }}>
            Выберите схему для редактирования или создайте новую
          </Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={onCreateNew}
          size="large"
        >
          Создать новую схему
        </Button>
      </div>

      <Input
        placeholder="Поиск по названию схемы..."
        value={tacticSearchText}
        onChange={(e) => setTacticSearchText(e.target.value)}
        allowClear
        style={{ marginBottom: 16 }}
        prefix={<span style={{ color: token.colorTextTertiary }}>🔍</span>}
      />

      <Spin spinning={loadingTactics}>
        <List
          grid={{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3, xl: 4, xxl: 4 }}
          dataSource={
            tactics
              .filter(t =>
                !tacticSearchText ||
                t.name?.toLowerCase().includes(tacticSearchText.toLowerCase())
              )
              .sort((a, b) => {
                // Глобальные схемы первыми
                if (a.is_global && !b.is_global) return -1;
                if (!a.is_global && b.is_global) return 1;
                // Затем по алфавиту
                return (a.name || '').localeCompare(b.name || '');
              })
          }
          locale={{ emptyText: 'Нет доступных схем наценок. Создайте новую схему.' }}
          renderItem={(tactic) => (
            <List.Item>
              <Card
                hoverable
                onClick={() => onSelectTactic(tactic.id)}
                style={{
                  height: '100%',
                  cursor: 'pointer',
                  border: tactic.is_global ? `2px solid ${token.colorPrimary}` : undefined
                }}
                bodyStyle={{ padding: 16 }}
              >
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Title level={5} style={{ margin: 0, flex: 1 }}>
                      {tactic.name || 'Без названия'}
                    </Title>
                    {tactic.is_global && (
                      <Tag color="gold" style={{ margin: 0 }}>глобальная</Tag>
                    )}
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {tactic.created_at ? `Создана: ${dayjs(tactic.created_at).format('DD.MM.YYYY')}` : ''}
                  </Text>
                  {tactic.updated_at && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Обновлена: {dayjs(tactic.updated_at).format('DD.MM.YYYY HH:mm')}
                    </Text>
                  )}
                </Space>
              </Card>
            </List.Item>
          )}
        />
      </Spin>
    </div>
  );
};
