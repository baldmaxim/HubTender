import { useCallback, useEffect, useState } from 'react';
import { Space, Typography, message } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import {
  AiCatalogView,
  AiConnectionView,
  AiModelTestReport,
  AiRolloutView,
  AiSettingsView,
  activateAiNomenclature,
  deactivateAiNomenclature,
  fetchAiNomenclatureSettings,
  fetchAiRollout,
  fetchOpenRouterModels,
  fetchOpenRouterStatus,
  refreshOpenRouterModels,
  saveAiNomenclatureDraft,
  testAiNomenclatureModel,
  testOpenRouterConnection,
} from '../../lib/api/adminAi';
import { getErrorMessage } from '../../utils/errors';
import {
  ConnectionSection, CatalogSection, SelectedModelSection, RolloutSection, PilotOperationsSection,
} from './components';

const { Title, Paragraph } = Typography;

/**
 * Этап 2.5: Администрирование → AI и нейросети → Сопоставление номенклатуры.
 *
 * Инварианты страницы:
 *   - поля ввода API key НЕТ (ключ — server secret OPENROUTER_API_KEY);
 *   - model ID выбирается ТОЛЬКО из server-returned каталога (radio в
 *     таблице), free-text ввода модели нет;
 *   - активация доступна только когда server-side гейты пройдены
 *     (can_activate); rollout для пользователей в 2.5 всегда off.
 */
export default function AdminAiSettings() {
  const [connection, setConnection] = useState<AiConnectionView | null>(null);
  const [catalog, setCatalog] = useState<AiCatalogView | null>(null);
  const [settings, setSettings] = useState<AiSettingsView | null>(null);
  const [rollout, setRollout] = useState<AiRolloutView | null>(null);
  const [lastReport, setLastReport] = useState<AiModelTestReport | null>(null);
  const [draftModelId, setDraftModelId] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [activating, setActivating] = useState(false);

  const loadInitial = useCallback(async () => {
    try {
      const s = await fetchAiNomenclatureSettings();
      setSettings(s);
      setDraftModelId(s.selected_model?.id ?? null);
    } catch (e) {
      message.error(getErrorMessage(e));
    }
    try {
      setConnection(await fetchOpenRouterStatus());
    } catch (e) {
      message.error(getErrorMessage(e));
    }
    try {
      setRollout(await fetchAiRollout());
    } catch (e) {
      message.error(getErrorMessage(e));
    }
    setCatalogLoading(true);
    try {
      setCatalog(await fetchOpenRouterModels());
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const handleTestConnection = async () => {
    setChecking(true);
    try {
      setConnection(await testOpenRouterConnection());
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  const handleRefreshModels = async () => {
    setCatalogLoading(true);
    try {
      setCatalog(await refreshOpenRouterModels());
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setCatalogLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!draftModelId) return;
    setSaving(true);
    try {
      const s = await saveAiNomenclatureDraft(draftModelId);
      setSettings(s);
      setDraftModelId(s.selected_model?.id ?? null);
      setLastReport(null);
      message.success('Черновик сохранён. Перед активацией проверьте модель.');
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleTestModel = async () => {
    setTesting(true);
    try {
      const { report, settings: s } = await testAiNomenclatureModel();
      setSettings(s);
      setLastReport(report);
      if (report.status === 'passed') {
        message.success('Проверка модели пройдена. Теперь конфигурацию можно активировать.');
      } else {
        message.warning('Проверка модели не пройдена — смотрите результаты сценариев.');
      }
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  const handleActivate = async () => {
    setActivating(true);
    try {
      const s = await activateAiNomenclature();
      setSettings(s);
      message.success(
        'Конфигурация активирована. Пользовательские AI-запросы будут включены на этапе контролируемого запуска.'
      );
    } catch (e) {
      message.error(getErrorMessage(e));
    } finally {
      setActivating(false);
    }
  };

  const handleDeactivate = async () => {
    try {
      const s = await deactivateAiNomenclature();
      setSettings(s);
      setLastReport(null);
      message.success('OpenRouter отключён. Ручной Smart Import продолжает работать.');
    } catch (e) {
      message.error(getErrorMessage(e));
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <div>
          <Title level={4} style={{ marginBottom: 4 }}>
            <RobotOutlined /> AI и нейросети — сопоставление номенклатуры
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Подключение OpenRouter к AI-подбору номенклатуры Smart Import. Модель выбирается из
            каталога, тестируется на синтетических данных и активируется вручную. Пользовательские
            AI-запросы остаются выключенными до этапа контролируемого запуска.
          </Paragraph>
        </div>

        <ConnectionSection
          connection={connection}
          checking={checking}
          onTestConnection={handleTestConnection}
        />

        <CatalogSection
          catalog={catalog}
          settings={settings}
          loading={catalogLoading}
          selectedModelId={draftModelId}
          onSelect={setDraftModelId}
          onRefresh={handleRefreshModels}
        />

        <SelectedModelSection
          settings={settings}
          lastReport={lastReport}
          draftModelId={draftModelId}
          saving={saving}
          testing={testing}
          activating={activating}
          onSaveDraft={handleSaveDraft}
          onTestModel={handleTestModel}
          onActivate={handleActivate}
          onDeactivate={handleDeactivate}
        />

        {/* Этап 2.6: контролируемый запуск (state machine, пилот, usage,
            evaluation, circuit, emergency off). */}
        <RolloutSection rollout={rollout} onChanged={setRollout} />
        <PilotOperationsSection
          onRolloutChanged={() => {
            fetchAiRollout().then(setRollout).catch(() => undefined);
          }}
        />
      </Space>
    </div>
  );
}
