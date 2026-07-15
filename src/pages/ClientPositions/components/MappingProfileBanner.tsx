import { Alert, Button, Checkbox, Input, Select, Space, Tag, Typography } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import type { SmartAnalyzeMemory } from '../../../lib/api/boqSmartImport';
import {
  PROFILE_CHANGED_BADGE, PROFILE_REQUIRES_REVIEW_TEXT, mappingDiffersFromProfile,
  profileChoiceState, profileStatusDisplay,
} from '../../../lib/quality/smartImportMemoryPolicy';

const { Text } = Typography;

export interface ProfileSaveState {
  saveAsNew: boolean;
  saveOrUpdate: boolean;
  name: string;
}

interface Props {
  memory: SmartAnalyzeMemory | undefined;
  appliedProfileId: string | undefined;
  overrides: Record<string, string>;
  saveState: ProfileSaveState;
  onApply: (profileId: string) => void;   // reanalyze с mapping_profile_id
  onReject: () => void;                   // «Не использовать»
  onSaveStateChange: (next: ProfileSaveState) => void;
}

/** Этап 2.3 (§11): найденные профили сопоставления. Ничего не применяется
 *  автоматически — только явные действия пользователя. */
export default function MappingProfileBanner({
  memory, appliedProfileId, overrides, saveState, onApply, onReject, onSaveStateChange,
}: Props) {
  const choice = profileChoiceState(memory);
  const applied = memory?.applied_profile_status === 'applied' && appliedProfileId;
  const changed = mappingDiffersFromProfile(memory, overrides);

  if (memory?.applied_profile_status === 'requires_review') {
    return <Alert type="warning" showIcon message="Профиль требует проверки" description={PROFILE_REQUIRES_REVIEW_TEXT} />;
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      {applied && (
        <Alert
          type="success" showIcon
          message={(
            <Space size={6} wrap>
              <span>Применён сохранённый профиль</span>
              {(memory?.applied_fields?.length ?? 0) > 0 && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  поля: {(memory?.applied_fields ?? []).join(', ')}
                </Text>
              )}
              {(memory?.skipped_fields?.length ?? 0) > 0 && (
                <Text type="warning" style={{ fontSize: 12 }}>
                  требуют проверки: {(memory?.skipped_fields ?? []).join(', ')}
                </Text>
              )}
              {changed && <Tag color="orange">{PROFILE_CHANGED_BADGE}</Tag>}
            </Space>
          )}
          action={<Button size="small" onClick={onReject}>Не использовать</Button>}
        />
      )}
      {!applied && choice.mode === 'one' && (
        <Alert
          type="info" showIcon
          message={(
            <Space size={6} wrap>
              <span>Найден сохранённый профиль сопоставления: «{choice.profiles[0].name}»</span>
              <Tag color={profileStatusDisplay(choice.profiles[0].status).color}>
                {profileStatusDisplay(choice.profiles[0].status).label}
              </Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                использований: {choice.profiles[0].use_count}
                {choice.profiles[0].last_used_at ? ` · последнее: ${choice.profiles[0].last_used_at}` : ''}
              </Text>
            </Space>
          )}
          action={(
            <Space>
              <Button size="small" type="primary"
                disabled={choice.profiles[0].status !== 'usable'}
                onClick={() => onApply(choice.profiles[0].id)}>
                Применить
              </Button>
              <Button size="small" onClick={onReject}>Не использовать</Button>
            </Space>
          )}
        />
      )}
      {!applied && choice.mode === 'multiple' && (
        <Alert
          type="info" showIcon
          message={`Найдено ${choice.profiles.length} сохранённых профиля с такой же структурой заголовков — выберите нужный.`}
          description={(
            <Select
              style={{ minWidth: 340 }} placeholder="Выбрать профиль" value={undefined}
              options={choice.profiles.map((p) => ({
                value: p.id,
                label: `${p.name} (исп.: ${p.use_count}${p.last_used_at ? `, ${p.last_used_at}` : ''})`,
                disabled: p.status !== 'usable',
              }))}
              onChange={(id) => id && onApply(id)}
            />
          )}
        />
      )}

      <Space wrap size={12}>
        {applied && (
          <Checkbox
            checked={saveState.saveOrUpdate}
            onChange={(e) => onSaveStateChange({ ...saveState, saveOrUpdate: e.target.checked, saveAsNew: false })}
          >
            Обновить профиль после успешного импорта
          </Checkbox>
        )}
        <Checkbox
          checked={saveState.saveAsNew}
          onChange={(e) => onSaveStateChange({ ...saveState, saveAsNew: e.target.checked, saveOrUpdate: false })}
        >
          <SaveOutlined /> Сохранить это сопоставление как профиль
        </Checkbox>
        {saveState.saveAsNew && (
          <Input
            size="small" style={{ width: 260 }} placeholder="Имя профиля (обязательно)"
            value={saveState.name} maxLength={120}
            onChange={(e) => onSaveStateChange({ ...saveState, name: e.target.value })}
          />
        )}
        <Text type="secondary" style={{ fontSize: 11 }}>
          Профиль сохраняется только после успешного импорта; финансовые данные в него не входят.
        </Text>
      </Space>
    </Space>
  );
}
