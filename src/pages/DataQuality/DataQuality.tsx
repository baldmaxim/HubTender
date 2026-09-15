import React from 'react';
import { Card, Select, Button, Space, Typography, Tag, Collapse, Empty, Spin, Switch, Alert, Popconfirm } from 'antd';
import { ReloadOutlined, SafetyCertificateOutlined, CheckOutlined } from '@ant-design/icons';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useQualityReport } from './hooks/useQualityReport';
import { FindingsTable } from './components/FindingsTable';
import { ProposalReadinessCard } from './components/ProposalReadinessCard';
import { CheckpointBar } from './components/CheckpointBar';
import { SectionsPanel } from './components/SectionsPanel';
import { CostBenchmarkPanel } from './components/CostBenchmarkPanel';

const { Title, Text, Paragraph } = Typography;

const SEVERITY_META = {
  error: { color: 'red', label: 'Ошибки' },
  warning: { color: 'orange', label: 'Предупреждения' },
  info: { color: 'blue', label: 'Информация' },
} as const;

const DataQuality: React.FC = () => {
  const { isPhone } = useIsMobile();
  const {
    tenders,
    selectedTenderId,
    setSelectedTenderId,
    report,
    rules,
    groups,
    counts,
    loading,
    showAccepted,
    setShowAccepted,
    showOnlyNew,
    setShowOnlyNew,
    checkpointing,
    markCheckpoint,
    recheck,
    submitVerdict,
    submitGroupVerdict,
  } = useQualityReport();

  return (
    <div style={{ padding: isPhone ? 12 : 24 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Title level={isPhone ? 4 : 3} style={{ marginBottom: 4 }}>
            <SafetyCertificateOutlined /> Проверка данных
          </Title>
          <Text type="secondary">
            Находки правил по выбранному тендеру. Отмечайте, что реально ошибка, а что
            легитимный случай — это и есть замер точности правил.
          </Text>
        </div>

        <Card size="small">
          <Space direction={isPhone ? 'vertical' : 'horizontal'} size={12} style={{ width: '100%' }} wrap>
            <Select
              showSearch
              style={{ width: isPhone ? '100%' : 420 }}
              placeholder="Выберите тендер"
              value={selectedTenderId}
              onChange={setSelectedTenderId}
              optionFilterProp="label"
              options={tenders.map((t) => ({
                value: t.id,
                label: t.version ? `${t.title} — версия ${t.version}` : t.title,
              }))}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={recheck}
              disabled={!selectedTenderId || loading}
            >
              Перепроверить
            </Button>
            <Space size={8}>
              <Switch checked={showAccepted} onChange={setShowAccepted} size="small" />
              <Text>Показывать принятые</Text>
            </Space>
          </Space>
        </Card>

        {/* Разделы грузятся отдельно от находок и не пересоздаются, пока идёт
            перепрогон правил, — иначе панель мигала бы на каждой правке тендера. */}
        {selectedTenderId && <SectionsPanel tenderId={selectedTenderId} isPhone={isPhone} />}
        {selectedTenderId && <CostBenchmarkPanel tenderId={selectedTenderId} isPhone={isPhone} />}

        {loading && (
          <Card>
            <Spin tip="Выполняются правила…">
              <div style={{ minHeight: 80 }} />
            </Spin>
          </Card>
        )}

        {!loading && !selectedTenderId && (
          <Card>
            <Empty description="Выберите тендер, чтобы увидеть находки" />
          </Card>
        )}

        {!loading && selectedTenderId && report && (
          <>
            <Card size="small">
              <Space size={12} wrap>
                <Tag color="red">Ошибки: {counts.error}</Tag>
                <Tag color="orange">Предупреждения: {counts.warning}</Tag>
                <Tag color="blue">Информация: {counts.info}</Tag>
                <Tag color="green">Принято: {counts.accepted}</Tag>
                {counts.money > 0 && (
                  <Tag color="volcano">
                    Денежный эффект: {Math.round(counts.money).toLocaleString('ru-RU')} ₽
                  </Tag>
                )}
              </Space>
            </Card>

            <CheckpointBar
              report={report}
              newCount={counts.new}
              showOnlyNew={showOnlyNew}
              onShowOnlyNewChange={setShowOnlyNew}
              checkpointing={checkpointing}
              onCheckpoint={() => void markCheckpoint()}
              isPhone={isPhone}
            />

            <ProposalReadinessCard
              findings={report.findings}
              rules={rules}
              isPhone={isPhone}
            />

            {report.errors.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message="Часть правил не отработала"
                description={report.errors.map((e) => `${e.rule_code}: ${e.message}`).join('; ')}
              />
            )}

            {groups.length === 0 ? (
              <Card>
                <Empty
                  description={
                    showOnlyNew
                      ? 'Новых находок с последней отметки проверки нет'
                      : showAccepted
                        ? 'Находок нет'
                        : 'Активных находок нет — возможно, все отмечены как норма'
                  }
                />
              </Card>
            ) : (
              <Collapse
                items={groups.map((g) => ({
                  key: g.ruleCode,
                  label: (
                    <Space size={8} wrap>
                      <Tag color={SEVERITY_META[g.severity].color}>{g.ruleCode}</Tag>
                      <Text strong>{g.ruleTitle}</Text>
                      <Text type="secondary">({g.findings.length})</Text>
                      {g.moneyTotal > 0 && (
                        <Tag color="volcano">
                          {Math.round(g.moneyTotal).toLocaleString('ru-RU')} ₽
                        </Tag>
                      )}
                      {g.acceptedCount > 0 && (
                        <Tag color="green">принято: {g.acceptedCount}</Tag>
                      )}
                    </Space>
                  ),
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <Paragraph
                        type="secondary"
                        style={{ marginBottom: 0, whiteSpace: 'pre-line', fontSize: 13 }}
                      >
                        {g.summary}
                      </Paragraph>
                      {(() => {
                        const pending = g.findings.filter((f) => f.verdict !== 'accepted').length;
                        if (pending === 0) return null;
                        return (
                          <Popconfirm
                            title="Принять всю группу как норму?"
                            description={`Будет отмечено находок: ${pending}. Каждую можно переоткрыть по отдельности.`}
                            okText="Принять"
                            cancelText="Отмена"
                            onConfirm={() => void submitGroupVerdict(g.findings, 'accepted')}
                          >
                            <Button size="small" icon={<CheckOutlined />}>
                              Принять всю группу как норму ({pending})
                            </Button>
                          </Popconfirm>
                        );
                      })()}
                      <FindingsTable
                        findings={g.findings}
                        isPhone={isPhone}
                        onVerdict={submitVerdict}
                      />
                    </Space>
                  ),
                }))}
              />
            )}
          </>
        )}
      </Space>
    </div>
  );
};

export default DataQuality;
