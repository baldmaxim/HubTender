import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App, Drawer, Form, Segmented, Skeleton, Typography, theme, Input } from 'antd';
import { reconcileTenderGroups, setTenderGroupQuality } from '../../lib/api/timeline';
import { useRealtimeTopic } from '../../lib/realtime/useRealtimeTopic';
import { useAuth } from '../../contexts/AuthContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useHorizontalSwipe } from '../../hooks/useHorizontalSwipe';
import { useTenderAssignableUsers } from './hooks/useTenderAssignableUsers';
import { useTenders, type TimelineTenderListItem } from './hooks/useTenders';
import { useTenderGroups } from './hooks/useTenderGroups';
import {
  DEFAULT_TENDER_TEAMS,
  TIMELINE_EXCLUDED_FULL_NAMES,
  TIMELINE_PRIVILEGED_ROLE_CODES,
  normalizeFullName,
} from './utils/timeline.utils';
import {
  getExpectedAutoGroups,
  getExpectedSignature,
  getGroupsSignature,
} from './utils/timelineSignatures';
import { TenderTeamsView } from './components/TenderTeamsView';
import { TimelinePanel } from './components/TimelinePanel';
import { TimelineTenderTable } from './components/TimelineTenderTable';
import { TimelineTenderCards } from './components/TimelineTenderCards';
import { GroupQualityModal, type GroupQualityFormValues } from './components/GroupQualityModal';

const { Title, Text } = Typography;
const { Search } = Input;
const TIMELINE_PANEL_WIDTH = 520;
const QUALITY_READONLY_ROLE_CODES = ['engineer', 'senior_group'] as const;

const TenderTimeline: React.FC = () => {
  const {
    token: {
      colorBgContainer,
      colorBorderSecondary,
      colorFillAlter,
      colorFillSecondary,
      colorPrimary,
      colorPrimaryBg,
      colorText,
    },
  } = theme.useToken();
  const { message } = App.useApp();
  const { user } = useAuth();
  const { isPhoneDevice } = useIsMobile();
  const { tenders, loading: tendersLoading, error: tendersError, refetch: refetchTenders } = useTenders();
  const [qualityForm] = Form.useForm<GroupQualityFormValues>();
  const [searchValue, setSearchValue] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'archive'>('active');
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [expandedTenderIds, setExpandedTenderIds] = useState<React.Key[]>([]);
  const [qualityModalOpen, setQualityModalOpen] = useState(false);
  const [qualitySaving, setQualitySaving] = useState(false);
  const [qualityTenderId, setQualityTenderId] = useState<string | null>(null);
  const [realtimeSignal, setRealtimeSignal] = useState(0);
  const syncInFlightRef = useRef(false);
  const lastSyncSignatureRef = useRef<string>('');

  const {
    groups,
    loading: groupsLoading,
    error: groupsError,
    refetch: refetchGroups,
  } = useTenderGroups(selectedTenderId);
  const {
    users: assignableUsers,
    loading: assignableUsersLoading,
    error: assignableUsersError,
  } = useTenderAssignableUsers();

  const canManageTimeline = TIMELINE_PRIVILEGED_ROLE_CODES.includes(
    (user?.role_code || '') as (typeof TIMELINE_PRIVILEGED_ROLE_CODES)[number]
  );
  const canEditQuality =
    canManageTimeline &&
    !QUALITY_READONLY_ROLE_CODES.includes(
      (user?.role_code || '') as (typeof QUALITY_READONLY_ROLE_CODES)[number]
    );
  const canRespondToIterations =
    canManageTimeline &&
    !QUALITY_READONLY_ROLE_CODES.includes(
      (user?.role_code || '') as (typeof QUALITY_READONLY_ROLE_CODES)[number]
    );

  const filteredTenders = useMemo(() => {
    const normalizedQuery = searchValue.trim().toLocaleLowerCase('ru-RU');

    if (!normalizedQuery) {
      return tenders;
    }

    return tenders.filter((tender) => {
      const title = tender.title.toLocaleLowerCase('ru-RU');
      const tenderNumber = tender.tender_number.toLocaleLowerCase('ru-RU');
      const compactTenderNumber = tenderNumber.replace(/\s+/g, '');
      const compactQuery = normalizedQuery.replace(/\s+/g, '');

      return (
        title.includes(normalizedQuery) ||
        tenderNumber.includes(normalizedQuery) ||
        compactTenderNumber.includes(compactQuery)
      );
    });
  }, [searchValue, tenders]);

  const tabCounts = useMemo(
    () => ({
      active: filteredTenders.filter((tender) => !tender.is_archived).length,
      archive: filteredTenders.filter((tender) => tender.is_archived).length,
    }),
    [filteredTenders]
  );

  const visibleTenders = useMemo(
    () =>
      filteredTenders.filter((tender) =>
        activeTab === 'archive' ? tender.is_archived : !tender.is_archived
      ),
    [filteredTenders, activeTab]
  );

  const goToTabOffset = useCallback(
    (delta: number) => {
      const tabs = ['active', 'archive'] as const;
      const index = tabs.indexOf(activeTab);
      const next = (((index + delta) % tabs.length) + tabs.length) % tabs.length;
      if (next !== index) {
        setActiveTab(tabs[next]);
      }
    },
    [activeTab]
  );

  const tabSwipe = useHorizontalSwipe({
    onSwipeLeft: () => goToTabOffset(1),
    onSwipeRight: () => goToTabOffset(-1),
  });

  const selectedTender = useMemo(
    () => tenders.find((tender) => tender.id === selectedTenderId) || null,
    [selectedTenderId, tenders]
  );
  const autoExpectedGroups = useMemo(
    () => getExpectedAutoGroups(assignableUsers),
    [assignableUsers]
  );
  const excludedTimelineUserIds = useMemo(() => {
    const excludedNames = new Set(TIMELINE_EXCLUDED_FULL_NAMES.map((fullName) => normalizeFullName(fullName)));
    return assignableUsers
      .filter((assignableUser) => excludedNames.has(normalizeFullName(assignableUser.full_name)))
      .map((assignableUser) => assignableUser.id);
  }, [assignableUsers]);
  const restrictGroupsToCurrentUser =
    (user?.role_code === 'engineer' || user?.role_code === 'senior_group') && Boolean(user?.id);
  const displayedGroups = useMemo(() => {
    const expectedNames = new Set(autoExpectedGroups.map((group) => group.name));
    const matchingGroups = groups
      .filter((group) => expectedNames.has(group.name))
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0));

    const sortedGroups =
      matchingGroups.length > 0 ? matchingGroups : [...groups].sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0));

    if (!restrictGroupsToCurrentUser || !user?.id) {
      return sortedGroups;
    }

    return sortedGroups.filter((group) => group.members.some((member) => member.user_id === user.id));
  }, [autoExpectedGroups, groups, restrictGroupsToCurrentUser, user?.id]);
  const selectedGroup = useMemo(
    () => displayedGroups.find((group) => group.id === selectedGroupId) || null,
    [displayedGroups, selectedGroupId]
  );
  const qualityTender = useMemo(
    () => tenders.find((tender) => tender.id === qualityTenderId) || null,
    [qualityTenderId, tenders]
  );
  const timelineOpen = Boolean(
    selectedTender &&
      selectedGroup &&
      selectedTenderId &&
      expandedTenderIds.includes(selectedTenderId)
  );

  useEffect(() => {
    if (selectedTenderId && !tenders.some((tender) => tender.id === selectedTenderId)) {
      setSelectedTenderId(null);
      setSelectedGroupId(null);
      setSelectedUserId(null);
      setExpandedTenderIds([]);
    }
  }, [selectedTenderId, tenders]);

  useEffect(() => {
    if (selectedTenderId && !filteredTenders.some((tender) => tender.id === selectedTenderId)) {
      setSelectedTenderId(null);
      setSelectedGroupId(null);
      setSelectedUserId(null);
      setExpandedTenderIds([]);
    }
  }, [filteredTenders, selectedTenderId]);

  useEffect(() => {
    if (!selectedGroup) {
      setSelectedUserId(null);
      return;
    }

    const memberIds = selectedGroup.members.map((member) => member.user_id);
    if (user?.role_code === 'engineer' && user.id) {
      setSelectedUserId(memberIds.includes(user.id) ? user.id : null);
      return;
    }

    if (!selectedUserId || !memberIds.includes(selectedUserId)) {
      setSelectedUserId(memberIds[0] || null);
    }
  }, [selectedGroup, selectedUserId, user?.id, user?.role_code]);

  useEffect(() => {
    if (!qualityModalOpen || !qualityTenderId || qualityTenderId !== selectedTenderId || groupsLoading) {
      return;
    }

    qualityForm.setFieldsValue({
      groups: Object.fromEntries(
        displayedGroups.map((group) => [
          group.id,
          {
            quality_level: group.qualityLevel ?? undefined,
            quality_comment: group.quality_comment ?? undefined,
          },
        ])
      ),
    });
  }, [displayedGroups, groupsLoading, qualityForm, qualityModalOpen, qualityTenderId, selectedTenderId]);

  useEffect(() => {
    if (!selectedTenderId) {
      lastSyncSignatureRef.current = '';
      return;
    }

    if (!canManageTimeline || groupsLoading || assignableUsersLoading || syncInFlightRef.current) {
      return;
    }

    const expectedSignature = `${selectedTenderId}::${getExpectedSignature(autoExpectedGroups)}`;
    const actualSignature = `${selectedTenderId}::${getGroupsSignature(
      groups.filter((group) => DEFAULT_TENDER_TEAMS.some((team) => team.name === group.name))
    )}`;

    if (expectedSignature === actualSignature || lastSyncSignatureRef.current === expectedSignature) {
      return;
    }

    const syncGroups = async () => {
      syncInFlightRef.current = true;

      try {
        await reconcileTenderGroups(selectedTenderId, {
          excluded_user_ids: excludedTimelineUserIds,
          expected_groups: autoExpectedGroups.map((g) => ({
            name: g.name,
            color: g.color,
            sort_order: g.sortOrder,
            user_ids: g.userIds,
          })),
        });

        lastSyncSignatureRef.current = expectedSignature;
        await Promise.all([refetchGroups(), refetchTenders()]);
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Не удалось автоматически синхронизировать команды');
      } finally {
        syncInFlightRef.current = false;
      }
    };

    void syncGroups();
    // message is a stable antd module import; intentionally excluded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoExpectedGroups,
    canManageTimeline,
    excludedTimelineUserIds,
    groups,
    groupsLoading,
    assignableUsersLoading,
    refetchGroups,
    refetchTenders,
    selectedTenderId,
  ]);

  const refreshAll = async () => {
    await Promise.all([refetchTenders(), refetchGroups()]);
  };

  // Realtime: при изменении timeline-строк выбранного тендера (создание/ответ по
  // записи, оценка качества — фан-аут через pgnotify в топик tender:<id>)
  // перезапрашиваем список/группы и сигналим открытой панели обновить итерации.
  useRealtimeTopic(selectedTenderId ? `tender:${selectedTenderId}` : null, () => {
    void refreshAll();
    setRealtimeSignal((signal) => signal + 1);
  });

  const handleSelectTender = (tenderId: string) => {
    if (tenderId !== selectedTenderId) {
      setSelectedGroupId(null);
      setSelectedUserId(null);
      lastSyncSignatureRef.current = '';
    }

    setSelectedTenderId(tenderId);
    setExpandedTenderIds([tenderId]);
  };

  const handleCollapseTender = (tenderId: string) => {
    if (selectedTenderId === tenderId) {
      setSelectedTenderId(null);
      setSelectedGroupId(null);
      setSelectedUserId(null);
    }

    setExpandedTenderIds([]);
  };

  const handleToggleTenderCard = (tenderId: string) => {
    if (selectedTenderId === tenderId && expandedTenderIds.includes(tenderId)) {
      handleCollapseTender(tenderId);
    } else {
      handleSelectTender(tenderId);
    }
  };

  const handleSelectGroup = (groupId: string) => {
    setSelectedGroupId(groupId);
    setSelectedUserId(null);
  };

  const handleCloseTimeline = () => {
    setSelectedGroupId(null);
    setSelectedUserId(null);
  };

  const handleOpenQualityModal = (tenderId: string) => {
    setQualityTenderId(tenderId);
    setQualityModalOpen(true);
    setSelectedTenderId(tenderId);
    setSelectedGroupId(null);
    setSelectedUserId(null);
    lastSyncSignatureRef.current = '';
  };

  const handleCloseQualityModal = () => {
    setQualityModalOpen(false);
    setQualityTenderId(null);
    qualityForm.resetFields();
  };

  const handleSaveGroupQuality = async () => {
    const formValues = qualityForm.getFieldValue('groups') || {};

    if (!qualityTenderId || qualityTenderId !== selectedTenderId) {
      return;
    }

    setQualitySaving(true);

    try {
      for (const group of displayedGroups) {
        const draft = formValues[group.id] || {};
        const rawLevel = draft.quality_level;
        const qualityLevel = typeof rawLevel === 'number' ? rawLevel : null;
        const qualityComment = typeof draft.quality_comment === 'string' ? draft.quality_comment : null;

        await setTenderGroupQuality(group.id, qualityLevel, qualityComment);
      }

      message.success('Уровень расчета обновлен');
      handleCloseQualityModal();
      await refreshAll();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Не удалось обновить уровень расчета');
    } finally {
      setQualitySaving(false);
    }
  };

  const renderExpandedGroups = (tender: TimelineTenderListItem) => {
    if (selectedTenderId !== tender.id || groupsLoading || assignableUsersLoading) {
      return (
        <div style={{ padding: 12 }}>
          <Skeleton active paragraph={{ rows: 3 }} />
        </div>
      );
    }

    if (groupsError) {
      return <Alert type="error" showIcon message="Не удалось загрузить команды" description={groupsError} />;
    }

    return (
      <TenderTeamsView
        displayedGroups={displayedGroups}
        selectedGroupId={selectedGroupId}
        assignableUsersError={assignableUsersError}
        onSelectGroup={handleSelectGroup}
        colorPrimary={colorPrimary}
        colorBorderSecondary={colorBorderSecondary}
        colorPrimaryBg={colorPrimaryBg}
        colorBgContainer={colorBgContainer}
        colorFillSecondary={colorFillSecondary}
      />
    );
  };

  const expandedCardId =
    selectedTenderId && expandedTenderIds.includes(selectedTenderId) ? selectedTenderId : null;

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, position: 'relative' }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          height: '100%',
          overflow: 'hidden',
          transition: 'margin-right 0.3s ease',
          marginRight: !isPhoneDevice && timelineOpen ? TIMELINE_PANEL_WIDTH : 0,
        }}
      >
        <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!isPhoneDevice && (
            <div>
              <Title level={3} style={{ marginBottom: 4 }}>
                Хронология расчёта тендеров
              </Title>
              <Text type="secondary" style={{ display: 'none' }}>
                Реестр тендеров с уровнем качества, автоматически собранными командами и хронологией согласования по каждому участнику.
              </Text>
            </div>
          )}

          {tendersError ? (
            <Alert type="error" showIcon message="Ошибка загрузки тендеров" description={tendersError} />
          ) : null}

          <Search
            allowClear
            placeholder="Поиск по наименованию или номеру тендера"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            style={{ maxWidth: isPhoneDevice ? '100%' : 420 }}
          />

          <Segmented
            block={isPhoneDevice}
            value={activeTab}
            onChange={(value) => setActiveTab(value as 'active' | 'archive')}
            options={[
              { label: `В работе (${tabCounts.active})`, value: 'active' },
              { label: `В архиве (${tabCounts.archive})`, value: 'archive' },
            ]}
            style={{ maxWidth: isPhoneDevice ? '100%' : 420, alignSelf: isPhoneDevice ? undefined : 'flex-start' }}
          />

          {isPhoneDevice ? (
            <div
              {...tabSwipe}
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-y',
              }}
            >
              <TimelineTenderCards
                tenders={visibleTenders}
                loading={tendersLoading}
                expandedTenderId={expandedCardId}
                canEditQuality={canEditQuality}
                colorFillSecondary={colorFillSecondary}
                colorBorderSecondary={colorBorderSecondary}
                colorBgContainer={colorBgContainer}
                onToggle={handleToggleTenderCard}
                onOpenQuality={handleOpenQualityModal}
                renderExpanded={renderExpandedGroups}
              />
            </div>
          ) : (
            <TimelineTenderTable
              tenders={visibleTenders}
              loading={tendersLoading}
              expandedTenderIds={expandedTenderIds}
              canEditQuality={canEditQuality}
              colorFillSecondary={colorFillSecondary}
              colorBgContainer={colorBgContainer}
              colorBorderSecondary={colorBorderSecondary}
              colorFillAlter={colorFillAlter}
              onOpenQuality={handleOpenQualityModal}
              onExpand={handleSelectTender}
              onCollapse={handleCollapseTender}
              renderExpanded={renderExpandedGroups}
            />
          )}
        </div>
      </div>

      {/* Десктоп: боковая панель; телефон: полноэкранный Drawer */}
      {!isPhoneDevice && (
        <div
          style={{
            width: timelineOpen ? TIMELINE_PANEL_WIDTH : 0,
            height: '100%',
            overflow: timelineOpen ? 'auto' : 'hidden',
            background: colorBgContainer,
            borderLeft: timelineOpen ? `1px solid ${colorBorderSecondary}` : 'none',
            transition: 'width 0.3s ease',
            display: 'flex',
            flexDirection: 'column',
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
          }}
        >
          {timelineOpen && selectedTender && selectedGroup ? (
            <TimelinePanel
              selectedTender={selectedTender}
              selectedGroup={selectedGroup}
              selectedUserId={selectedUserId}
              onUserSelect={setSelectedUserId}
              currentUserId={user?.id || null}
              currentUserRoleCode={user?.role_code || null}
              canRespond={canRespondToIterations}
              onDataChanged={refreshAll}
              refreshSignal={realtimeSignal}
              onClose={handleCloseTimeline}
              colorText={colorText}
              colorBorderSecondary={colorBorderSecondary}
            />
          ) : null}
        </div>
      )}

      {isPhoneDevice && (
        <Drawer
          open={timelineOpen}
          placement="right"
          width="100%"
          onClose={handleCloseTimeline}
          styles={{ body: { padding: 0 } }}
        >
          {selectedTender && selectedGroup ? (
            <TimelinePanel
              selectedTender={selectedTender}
              selectedGroup={selectedGroup}
              selectedUserId={selectedUserId}
              onUserSelect={setSelectedUserId}
              currentUserId={user?.id || null}
              currentUserRoleCode={user?.role_code || null}
              canRespond={canRespondToIterations}
              onDataChanged={refreshAll}
              refreshSignal={realtimeSignal}
              onClose={handleCloseTimeline}
              colorText={colorText}
              colorBorderSecondary={colorBorderSecondary}
              hideClose
            />
          ) : null}
        </Drawer>
      )}

      <GroupQualityModal
        open={qualityModalOpen}
        qualityTender={qualityTender}
        qualityTenderId={qualityTenderId}
        selectedTenderId={selectedTenderId}
        groupsLoading={groupsLoading}
        displayedGroups={displayedGroups}
        form={qualityForm}
        canEditQuality={canEditQuality}
        qualitySaving={qualitySaving}
        isPhone={isPhoneDevice}
        colorBgContainer={colorBgContainer}
        colorBorderSecondary={colorBorderSecondary}
        onCancel={handleCloseQualityModal}
        onOk={handleSaveGroupQuality}
      />
    </div>
  );
};

export default TenderTimeline;
