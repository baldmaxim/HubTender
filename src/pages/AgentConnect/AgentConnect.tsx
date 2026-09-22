import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Result, Space, Spin, Typography } from 'antd';
import { Navigate, useLocation } from 'react-router-dom';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { approveOAuthConsent } from '../../lib/api/oauthAgents';

const { Title, Text } = Typography;

export default function AgentConnect() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const required = ['client_id', 'redirect_uri', 'scope', 'state', 'code_challenge'];
  const valid = required.every((key) => Boolean(params.get(key))) && params.get('code_challenge_method') === 'S256';

  useEffect(() => { setError(null); }, [location.search]);
  if (loading) return <Spin fullscreen tip="Проверяем учётную запись TenderHUB..." />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user.access_status !== 'approved' || !user.access_enabled) return <Navigate to="/login" replace />;
  if (!valid) return <Result status="error" title="Некорректный OAuth-запрос" subTitle="Вернитесь в агент и повторите подключение." />;

  const scopeList = (params.get('scope') ?? '').split(/\s+/).filter(Boolean);
  const approve = async () => {
    setSubmitting(true); setError(null);
    try {
      const redirect = await approveOAuthConsent({
        client_id: params.get('client_id')!, redirect_uri: params.get('redirect_uri')!, scope: params.get('scope')!,
        state: params.get('state')!, code_challenge: params.get('code_challenge')!, code_challenge_method: 'S256',
      });
      window.location.assign(redirect);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось подтвердить подключение');
      setSubmitting(false);
    }
  };
  const decline = () => {
    const target = new URL(params.get('redirect_uri')!);
    target.searchParams.set('error', 'access_denied');
    target.searchParams.set('state', params.get('state')!);
    target.searchParams.set('iss', window.location.origin);
    window.location.assign(target.toString());
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f5f7fa' }}>
      <Card style={{ width: '100%', maxWidth: 680 }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Space><SafetyCertificateOutlined style={{ fontSize: 32, color: '#10b981' }} /><Title level={3} style={{ margin: 0 }}>Подключение агента</Title></Space>
          <Alert type="info" showIcon message="Агент получит только перечисленные разрешения. Пароль TenderHUB ему не передаётся." />
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="Инженер">{user.full_name} ({user.email})</Descriptions.Item>
            <Descriptions.Item label="Клиент"><Text code>{params.get('client_id')}</Text></Descriptions.Item>
            <Descriptions.Item label="Разрешения">{scopeList.join(', ')}</Descriptions.Item>
          </Descriptions>
          {error && <Alert type="error" showIcon message={error} />}
          <Space>
            <Button type="primary" loading={submitting} onClick={approve}>Разрешить подключение</Button>
            <Button disabled={submitting} onClick={decline}>Отказать</Button>
          </Space>
        </Space>
      </Card>
    </div>
  );
}
