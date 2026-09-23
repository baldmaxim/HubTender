import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, List, Popconfirm, Space, Spin, Tag, Typography, message } from 'antd';
import { DisconnectOutlined, RobotOutlined } from '@ant-design/icons';
import { listOAuthGrants, OAuthGrant, revokeOAuthGrant } from '../../lib/api/oauthAgents';

const { Title, Text } = Typography;

export default function AgentConnections() {
  const [rows, setRows] = useState<OAuthGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listOAuthGrants()); }
    catch (e) { message.error(e instanceof Error ? e.message : 'Не удалось загрузить подключения'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const revoke = async (id: string) => {
    try { await revokeOAuthGrant(id); message.success('Доступ агента отозван'); await load(); }
    catch (e) { message.error(e instanceof Error ? e.message : 'Не удалось отозвать доступ'); }
  };
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div><Title level={2}><RobotOutlined /> Подключённые агенты</Title><Text type="secondary">OAuth-доступы можно отозвать в любой момент.</Text></div>
      <Alert type="warning" showIcon message="Отзыв немедленно блокирует grant и refresh-токены. Каждый MCP-вызов повторно проверяет grant и текущий статус пользователя." />
      <Card>{loading ? <Spin /> : rows.length === 0 ? <Empty description="Подключённых агентов нет" /> : <List dataSource={rows} renderItem={(row) => (
        <List.Item actions={[<Popconfirm key="revoke" title="Отозвать доступ этого агента?" onConfirm={() => void revoke(row.client_id)}><Button danger icon={<DisconnectOutlined />}>Отозвать</Button></Popconfirm>] }>
          <List.Item.Meta title={row.client_name} description={<Space direction="vertical" size={4}><Text code>{row.client_id}</Text><Space wrap>{row.scopes.map((s) => <Tag key={s}>{s}</Tag>)}</Space><Text type="secondary">Выдан: {new Date(row.granted_at).toLocaleString('ru-RU')}{row.last_used_at ? ` · использован: ${new Date(row.last_used_at).toLocaleString('ru-RU')}` : ''}</Text></Space>} />
        </List.Item>
      )} />}</Card>
    </Space>
  );
}
