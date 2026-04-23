import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  App,
  Alert,
  Avatar,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Skeleton,
  Space,
  Table,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CloseOutlined } from '@ant-design/icons';
import { supabase } from '../../lib/supabase';
import { setTenderGroupQuality } from '../../lib/api/timeline';
import { useAuth } from '../../contexts/AuthContext';
import UserTimeline from './components/UserTimeline';
import { useTenderAssignableUsers } from './hooks/useTenderAssignableUsers';
import { useTenders, type TimelineTenderListItem } from './hooks/useTenders';
import { useTenderGroups } from './hooks/useTenderGroups';
import type { TimelineGroupItem } from './hooks/useTenderGroups';
import {
  DEFAULT_TENDER_TEAMS,
  TIMELINE_EXCLUDED_FULL_NAMES,
  TIMELINE_PRIVILEGED_ROLE_CODES,
  formatDate,
  getInitials,
  getRoleAvatarColor,
  getScoreColor,
  normalizeFullName,
} from './utils/timeline.utils';

const { Title, Text } = Typography;
const { TextArea, Search } = Input;
const TIMELINE_PANEL_WIDTH = 520;
const QUALITY_READONLY_ROLE_CODES = ['engineer', 'senior_group'] as const;

type ExpectedAutoGroup = {
  name: string;
  color: string;
  sortOrder: number;
  userIds: string[];
};

type GroupQualityFormValues = {
  groups?: Record<string, { quality_level?: number | null; quality_comment?: string | null }>;
};

const QUALITY_LEVEL_DESCRIPTIONS: Record<number, string> = {
  1: 'Расценивали ВОР.',
  2: 'Считали ориентировочно.',
  3: 'Считали качественно, имеются все данные от Заказчика.',
};

function getQualityLabel(level: number | null): string {
  return level == null ? 'Нет оценки' : `${level}/3`;
}

function getQualityTooltipContent(level: number | null, comment?: string | null): React.ReactNode {
  if (level == null) {
    return 'Нет оценки';
  }

  return (
    <div>
      <div>{QUALITY_LEVEL_DESCRIPTIONS[level] || `Уровень ${level}`}</div>
      {comment ? <div style={{ marginTop: 4 }}>{comment}</div> : null}
    </div>
  );
}

function getExpectedAutoGroups(
  users: Array<{ id: string; full_name: string }>
): ExpectedAutoGroup[] {
  const usersByName = new Map(users.map((user) => [normalizeFullName(user.full_name), user]));

  return DEFAULT_TENDER_TEAMS.map((team) => {
    const matchedUserIds = team.members
      .map((fullName) => usersByName.get(normalizeFullName(fullName))?.id || null)
      .filter((userId): userId is string => Boolean(userId));

    return {
      name: team.name,
      color: team.color,
      sortOrder: team.sortOrder,
      userIds: matchedUserIds,
    };
  });
}

function getGroupsSignature(groups: TimelineGroupItem[]): string {
  return groups
    .map((group) => ({
      name: group.name,
      color: group.color,
      sortOrder: group.sort_order,
      userIds: group.members.map((member) => member.user_id).sort(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ru-RU'))
    .map((group) => `${group.name}|${group.color}|${group.sortOrder}|${group.userIds.join(',')}`)
    .join(';');
}

function getExpectedSignature(expectedGroups: ExpectedAutoGroup[]): string {
  return expectedGroups
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, 'ru-RU'))
    .map((group) => `${group.name}|${group.color}|${group.sortOrder}|${group.userIds.slice().sort().join(',')}`)
    .join(';');
}

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
  const { tenders, loading: tendersLoading, error: tendersError, refetch: refetchTenders } = useTenders();
  const [qualityForm] = Form.useForm<GroupQualityFormValues>();
  const [searchValue, setSearchValue] = useState('');
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [expandedTenderIds, setExpandedTenderIds] = useState<React.Key[]>([]);
  const [qualityModalOpen, setQualityModalOpen] = useState(false);
  const [qualitySaving, setQualitySaving] = useState(false);
  const [qualityTenderId, setQualityTenderId] = useState<string | null>(null);
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
      .sort((left, right) => left.sort_order - right.sort_order);

    const sortedGroups =
      matchingGroups.length > 0 ? matchingGroups : [...groups].sort((left, right) => left.sort_order - right.sort_order);

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
        const existingByName = new Map(groups.map((group) => [group.name, group]));
        let hasChanges = false;

        for (const expectedGroup of autoExpectedGroups) {
          let currentGroup = existingByName.get(expectedGroup.name) || null;

          if (!currentGroup) {
            const { data, error } = await supabase
              .from('tender_groups')
              .upsert(
                {
                  tender_id: selectedTenderId,
                  name: expectedGroup.name,
                  color: expectedGroup.color,
                  sort_order: expectedGroup.sortOrder,
                },
                { onConflict: 'tender_id,name' }
              )
              .select('id')
              .single();

            if (error) {
              throw error;
            }

            currentGroup = {
              id: data.id,
              tender_id: selectedTenderId,
              name: expectedGroup.name,
              color: expectedGroup.color,
              sort_order: expectedGroup.sortOrder,
              created_at: '',
              updated_at: '',
              members: [],
              iterationsCount: 0,
              qualityScore: 0,
              qualityLevel: null,
              iterationUserIds: [],
              status: 'pending',
            };
            existingByName.set(expectedGroup.name, currentGroup);
            hasChanges = true;
          } else if (
            currentGroup.color !== expectedGroup.color ||
            currentGroup.sort_order !== expectedGroup.sortOrder
          ) {
            const { error } = await supabase
              .from('tender_groups')
              .update({
                color: expectedGroup.color,
                sort_order: expectedGroup.sortOrder,
              })
              .eq('id', currentGroup.id);

            if (error) {
              throw error;
            }

            hasChanges = true;
          }

          const currentMemberIds = currentGroup.members.map((member) => member.user_id);
          const cleanupUserIds = Array.from(new Set([...currentMemberIds, ...currentGroup.iterationUserIds])).filter(
            (userId) => excludedTimelineUserIds.includes(userId)
          );

          if (cleanupUserIds.length > 0) {
            const { error: deleteIterationsError } = await supabase
              .from('tender_iterations')
              .delete()
              .eq('group_id', currentGroup.id)
              .in('user_id', cleanupUserIds);

            if (deleteIterationsError) {
              throw deleteIterationsError;
            }

            const { error: deleteMembersError } = await supabase
              .from('tender_group_members')
              .delete()
              .eq('group_id', currentGroup.id)
              .in('user_id', cleanupUserIds);

            if (deleteMembersError) {
              throw deleteMembersError;
            }

            hasChanges = true;
          }

          const sanitizedCurrentMemberIds = currentMemberIds.filter((userId) => !cleanupUserIds.includes(userId));
          const sanitizedIterationUserIds = currentGroup.iterationUserIds.filter(
            (userId) => !cleanupUserIds.includes(userId)
          );
          const toAdd = expectedGroup.userIds.filter((userId) => !sanitizedCurrentMemberIds.includes(userId));
          const protectedIds = new Set(sanitizedIterationUserIds);
          const toRemove = sanitizedCurrentMemberIds.filter(
            (userId) => !expectedGroup.userIds.includes(userId) && !protectedIds.has(userId)
          );

          if (toAdd.length > 0) {
            const { error } = await supabase
              .from('tender_group_members')
              .upsert(
                toAdd.map((userId) => ({
                  group_id: currentGroup.id,
                  user_id: userId,
                })),
                { onConflict: 'group_id,user_id' }
              );

            if (error) {
              throw error;
            }

            hasChanges = true;
          }

          if (toRemove.length > 0) {
            const { error } = await supabase
              .from('tender_group_members')
              .delete()
              .eq('group_id', currentGroup.id)
              .in('user_id', toRemove);

            if (error) {
              throw error;
            }

            hasChanges = true;
          }
        }

        lastSyncSignatureRef.current = expectedSignature;

        if (hasChanges) {
          await Promise.all([refetchGroups(), refetchTenders()]);
        }
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

  const columns: ColumnsType<TimelineTenderListItem> = [
    {
      title: '№',
      width: 56,
      render: (_, __, index) => index + 1,
    },
    {
      title: 'Тендер',
      dataIndex: 'title',
      render: (_, tender) => (
        <Space direction="vertical" size={2}>
          <Text strong>{tender.title}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {tender.tender_number}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Уровень расчета',
      width: 260,
      render: (_, tender) => (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
            <Text strong>{getQualityLabel(tender.qualityLevel)}</Text>
            <Text type="secondary">{tender.overallScore}%</Text>
          </div>
          <Progress
            percent={tender.overallScore}
            showInfo={false}
            size="small"
            strokeColor={getScoreColor(tender.overallScore)}
            trailColor={colorFillSecondary}
          />
        </div>
      ),
    },
    {
      title: 'Команд',
      dataIndex: 'groupsCount',
      width: 100,
      align: 'center',
    },
    {
      title: 'Последняя активность',
      width: 210,
      render: (_, tender) => (
        <Text type="secondary">
          {tender.lastActivityAt ? formatDate(tender.lastActivityAt) : 'Пока нет'}
        </Text>
      ),
    },
    {
      title: 'Действия',
      width: 160,
      render: (_, tender) => (
        <Button
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            handleOpenQualityModal(tender.id);
          }}
        >
          {canEditQuality ? 'Оценить уровень' : 'Просмотр уровня'}
        </Button>
      ),
    },
  ];

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
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div>
          <Text strong>Команды тендера</Text>
          <Text type="secondary" style={{ display: 'block' }}>
            Команды и состав участников фиксированы для каждого тендера и не зависят от данных на других страницах.
          </Text>
          {assignableUsersError ? (
            <Text type="secondary" style={{ display: 'block' }}>
              Не удалось загрузить часть пользователей из фиксированного состава: {assignableUsersError}
            </Text>
          ) : null}
        </div>

        {displayedGroups.length === 0 ? (
          <Empty description="Для тендера пока не удалось собрать фиксированный состав команд" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {displayedGroups.map((group) => {
              const isSelected = selectedGroupId === group.id;

              return (
                <Card
                  key={group.id}
                  size="small"
                  hoverable
                  onClick={() => handleSelectGroup(group.id)}
                  style={{
                    borderColor: isSelected ? colorPrimary : colorBorderSecondary,
                    background: isSelected ? colorPrimaryBg : colorBgContainer,
                  }}
                >
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: group.color,
                            flexShrink: 0,
                            marginTop: 5,
                          }}
                        />
                        <div style={{ minWidth: 0 }}>
                          <Text strong style={{ display: 'block' }}>
                            {group.name}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {group.members.length} участн. · {group.iterationsCount} данных
                          </Text>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <Text type="secondary">Уровень расчета</Text>
                        <Tooltip title={getQualityTooltipContent(group.qualityLevel, group.quality_comment)}>
                          <Text strong style={{ cursor: 'help' }}>
                            {group.qualityLevel != null ? `${group.qualityLevel}/3` : 'Нет оценки'}
                          </Text>
                        </Tooltip>
                      </div>
                      <Progress
                        percent={group.qualityScore}
                        showInfo={false}
                        size="small"
                        strokeColor={getScoreColor(group.qualityScore)}
                        trailColor={colorFillSecondary}
                      />
                      {group.quality_comment ? (
                        <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                          {group.quality_comment}
                        </Text>
                      ) : null}
                    </div>

                    <div>
                      <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                        Участники команды
                      </Text>
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        {group.members.map((member) => (
                          <div
                            key={member.id}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}
                          >
                            <Avatar
                              size="small"
                              style={{ backgroundColor: getRoleAvatarColor(member.user?.role_code || '') }}
                            >
                              {getInitials(member.user?.full_name || '')}
                            </Avatar>
                            <Text ellipsis style={{ minWidth: 0 }}>
                              {member.user?.full_name || 'Пользователь'}
                            </Text>
                          </div>
                        ))}
                      </Space>
                    </div>
                  </Space>
                </Card>
              );
            })}
          </div>
        )}
      </Space>
    );
  };

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, position: 'relative' }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          height: '100%',
          overflow: 'hidden',
          transition: 'margin-right 0.3s ease',
          marginRight: timelineOpen ? TIMELINE_PANEL_WIDTH : 0,
        }}
      >
        <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <Title level={3} style={{ marginBottom: 4 }}>
              Хронология расчёта тендеров
            </Title>
            <Text type="secondary" style={{ display: 'none' }}>
              Реестр тендеров с уровнем качества, автоматически собранными командами и хронологией согласования по каждому участнику.
            </Text>
          </div>

          {tendersError ? (
            <Alert type="error" showIcon message="Ошибка загрузки тендеров" description={tendersError} />
          ) : null}

          <Search
            allowClear
            placeholder="Поиск по наименованию или номеру тендера"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            style={{ maxWidth: 420 }}
          />

          <Card
            size="small"
            title="Реестр тендеров"
            style={{ flex: 1, minHeight: 0, background: colorBgContainer, borderColor: colorBorderSecondary }}
            styles={{ body: { height: 'calc(100% - 57px)', padding: 0, minHeight: 0, overflow: 'auto' } }}
          >
            <Table
              rowKey="id"
              size="middle"
              pagination={false}
              loading={tendersLoading}
              columns={columns}
              dataSource={filteredTenders}
              expandable={{
                expandedRowKeys: expandedTenderIds,
                expandRowByClick: true,
                expandedRowRender: renderExpandedGroups,
                onExpand: (expanded, record) => {
                  if (expanded) {
                    handleSelectTender(record.id);
                  } else {
                    handleCollapseTender(record.id);
                  }
                },
              }}
              onRow={(record) => ({
                style:
                  expandedTenderIds.includes(record.id)
                    ? { background: colorFillAlter }
                    : undefined,
              })}
              scroll={{ x: 860 }}
            />
          </Card>
        </div>
      </div>

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
          <>
            <div
              style={{
                padding: '20px 22px 14px',
                borderBottom: `1px solid ${colorBorderSecondary}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: colorText,
                      lineHeight: 1.35,
                    }}
                  >
                    {selectedGroup.name}
                  </div>
                  <Text type="secondary" style={{ display: 'block', marginTop: 6 }}>
                    {selectedTender.title}
                  </Text>
                  <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    {selectedTender.tender_number}
                  </Text>
                </div>
                <Button type="text" icon={<CloseOutlined />} onClick={handleCloseTimeline} />
              </div>
            </div>

            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <UserTimeline
                group={selectedGroup}
                selectedUserId={selectedUserId}
                onUserSelect={setSelectedUserId}
                currentUserId={user?.id || null}
                currentUserRoleCode={user?.role_code || null}
                canRespond={canRespondToIterations}
                onDataChanged={refreshAll}
              />
            </div>
          </>
        ) : null}
      </div>

      <Modal
        title={qualityTender ? `Уровень расчета · ${qualityTender.title}` : 'Уровень расчета'}
        open={qualityModalOpen}
        onCancel={handleCloseQualityModal}
        onOk={canEditQuality ? handleSaveGroupQuality : handleCloseQualityModal}
        confirmLoading={qualitySaving}
        okText={canEditQuality ? 'Сохранить' : 'Закрыть'}
        cancelText="Отмена"
        width={760}
        footer={
          canEditQuality
            ? undefined
            : [
                <Button key="close" onClick={handleCloseQualityModal}>
                  Закрыть
                </Button>,
              ]
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Шкала уровня расчета"
            description={
              <div>
                <div>1 — расценивали ВОР.</div>
                <div>2 — считали ориентировочно.</div>
                <div>3 — считали качественно, имеются все данные от Заказчика.</div>
              </div>
            }
          />

          {qualityTenderId && qualityTenderId === selectedTenderId && groupsLoading ? (
            <Skeleton active paragraph={{ rows: 5 }} />
          ) : (
            <Form form={qualityForm} layout="vertical">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {displayedGroups.map((group) => (
                  <Card
                    key={group.id}
                    size="small"
                    title={group.name}
                    style={{ background: colorBgContainer, borderColor: colorBorderSecondary }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16 }}>
                      <Form.Item
                        name={['groups', group.id, 'quality_level']}
                        label="Уровень 1–3"
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber
                          min={1}
                          max={3}
                          step={1}
                          precision={0}
                          disabled={!canEditQuality}
                          style={{ width: '100%' }}
                          placeholder="Например, 2"
                        />
                      </Form.Item>
                      <Form.Item
                        name={['groups', group.id, 'quality_comment']}
                        label="Комментарий"
                        style={{ marginBottom: 0 }}
                      >
                        <TextArea
                          rows={2}
                          disabled={!canEditQuality}
                          placeholder="Краткое пояснение по уровню расчета этой команды"
                        />
                      </Form.Item>
                    </div>
                  </Card>
                ))}
              </Space>
            </Form>
          )}
        </Space>
      </Modal>
    </div>
  );
};

export default TenderTimeline;
