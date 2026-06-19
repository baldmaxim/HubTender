import { useState, useEffect } from 'react';
import { message } from 'antd';
import { useRealtimeAwareLoading } from '../../../lib/realtime/useRealtimeAwareLoading';
import {
  listTendersForUserAccess,
  listPendingUsers,
  listAllUsers,
  approveUser,
  deleteUser as apiDeleteUser,
  setUserAccessEnabled,
  syncUsersAllowedPagesByRole,
  countUsersWithRole,
  sendUserNotification,
  listRoles,
  deleteRole,
} from '../../../lib/api/userAdmin';
import { getErrorMessage } from '../../../utils/errors';
import { useRealtimeTopic } from '../../../lib/realtime/useRealtimeTopic';
import type { PendingRequest, UserRecord, RoleRecord } from '../types';

interface CurrentUser {
  id: string;
}

// Доступные цвета для ролей (Ant Design Tag colors)
const AVAILABLE_COLORS = [
  'blue', 'green', 'cyan', 'purple', 'magenta', 'volcano',
  'orange', 'gold', 'lime', 'geekblue', 'red', 'pink',
];

const TRANSLIT_MAP: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
};

export function useUserAdmin(currentUser: CurrentUser | null, enabled: boolean) {
  const [activeTab, setActiveTab] = useState('pending');
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [tendersList, setTendersList] = useState<{ id: string; tender_number: string; title: string; version: number }[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useRealtimeAwareLoading(false);

  const loadTendersList = async () => {
    try {
      const data = await listTendersForUserAccess();
      setTendersList(data);
    } catch (error) {
      console.error('Ошибка загрузки списка тендеров:', error);
    }
  };

  const loadPendingRequests = async () => {
    setLoading(true);
    try {
      const data = await listPendingUsers();
      const requests: PendingRequest[] = data.map((item) => {
        const role = Array.isArray(item.roles) ? item.roles[0] : item.roles;
        return {
          id: item.id,
          full_name: item.full_name,
          email: item.email,
          role_code: item.role_code,
          role_name: role?.name,
          role_color: role?.color ?? undefined,
          registration_date: item.registration_date,
        };
      });
      setPendingRequests(requests);

      const initialRoles: Record<string, string> = {};
      requests.forEach((request) => { initialRoles[request.id] = request.role_code; });
      setSelectedRoles(initialRoles);
    } catch (err) {
      console.error('Ошибка загрузки запросов:', err);
      message.error('Не удалось загрузить запросы на регистрацию');
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await listAllUsers();
      const usersData: UserRecord[] = data.map((item) => {
        const role = Array.isArray(item.roles) ? item.roles[0] : item.roles;
        const rest = { ...item };
        delete rest.roles;
        return { ...rest, role_name: role?.name, role_color: role?.color ?? undefined } as UserRecord;
      });
      setUsers(usersData);
    } catch (err) {
      console.error('Ошибка загрузки пользователей:', err);
      message.error('Не удалось загрузить пользователей');
    } finally {
      setLoading(false);
    }
  };

  const loadRoles = async () => {
    setLoading(true);
    try {
      const data = await listRoles();
      setRoles(data);
    } catch (err) {
      console.error('Ошибка загрузки ролей:', err);
      message.error('Не удалось загрузить роли');
    } finally {
      setLoading(false);
    }
  };

  const approveRequest = async (request: PendingRequest) => {
    if (!currentUser) return;
    const selectedRoleCode = selectedRoles[request.id];
    if (!selectedRoleCode) {
      message.error('Выберите роль для пользователя');
      return;
    }
    try {
      const role = roles.find(r => r.code === selectedRoleCode);
      if (!role) {
        message.error('Выбранная роль не найдена');
        return;
      }
      try {
        await approveUser(request.id, currentUser.id, selectedRoleCode, role.allowed_pages || []);
      } catch (updateError) {
        console.error('Ошибка одобрения:', updateError);
        message.error('Не удалось одобрить запрос');
        return;
      }
      try {
        await sendUserNotification({
          userId: request.id,
          type: 'success',
          title: 'Регистрация одобрена',
          message: `Ваш запрос на регистрацию одобрен. Роль: ${role.name}`,
        });
      } catch (notificationError) {
        console.error('Ошибка отправки уведомления:', notificationError);
      }
      message.success(`Пользователь ${request.full_name} одобрен с ролью "${role.name}"`);
      loadPendingRequests();
      loadUsers();
    } catch (err) {
      console.error('Неожиданная ошибка:', err);
      message.error('Произошла ошибка при одобрении');
    }
  };

  const rejectRequest = async (request: PendingRequest) => {
    try {
      await apiDeleteUser(request.id);
      message.success(`Запрос от ${request.full_name} отклонен`);
      loadPendingRequests();
    } catch (err) {
      console.error('Ошибка отклонения:', err);
      message.error('Не удалось отклонить запрос');
    }
  };

  const deleteUser = async (user: UserRecord) => {
    try {
      await apiDeleteUser(user.id);
      message.success(`Пользователь ${user.full_name} удален`);
      loadUsers();
    } catch (err) {
      console.error('Ошибка удаления:', err);
      message.error('Не удалось удалить пользователя');
    }
  };

  const toggleAccess = async (user: UserRecord) => {
    const newAccessValue = !user.access_enabled;
    try {
      await setUserAccessEnabled(user.id, newAccessValue);
      message.success(newAccessValue ? `Доступ для ${user.full_name} открыт` : `Доступ для ${user.full_name} закрыт`);
      loadUsers();
    } catch (err) {
      console.error('Ошибка переключения доступа:', err);
      message.error('Не удалось изменить доступ');
    }
  };

  const handleRoleChangeInTable = (requestId: string, newRoleCode: string) => {
    setSelectedRoles((prev) => ({ ...prev, [requestId]: newRoleCode }));
  };

  const syncUsersPagesFromRole = async (roleCode: string, allowedPages: string[]) => {
    try {
      await syncUsersAllowedPagesByRole(roleCode, allowedPages);
    } catch (err) {
      console.error('Ошибка синхронизации прав пользователей:', err);
    }
  };

  const handleDeleteRole = async (role: RoleRecord) => {
    try {
      let usersCount: number;
      try {
        usersCount = await countUsersWithRole(role.code);
      } catch (checkError) {
        console.error('Ошибка проверки пользователей:', checkError);
        message.error('Не удалось проверить роль');
        return;
      }
      if (usersCount > 0) {
        message.error(`Невозможно удалить роль "${role.name}": есть пользователи с этой ролью (${usersCount})`);
        return;
      }
      if (role.is_system_role) {
        message.error('Системные роли нельзя удалять');
        return;
      }
      try {
        await deleteRole(role.code);
      } catch (deleteError) {
        console.error('Ошибка удаления роли:', deleteError);
        message.error(`Не удалось удалить роль: ${getErrorMessage(deleteError)}`);
        return;
      }
      message.success(`Роль "${role.name}" удалена`);
      loadRoles();
    } catch (err) {
      console.error('Неожиданная ошибка при удалении роли:', err);
      message.error('Произошла ошибка при удалении роли');
    }
  };

  // Генерация кода роли из названия (транслитерация кириллицы в латиницу)
  const generateRoleCode = (roleName: string): string =>
    roleName
      .toLowerCase()
      .split('')
      .map(char => TRANSLIT_MAP[char] || char)
      .join('')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

  // Генерация случайного цвета, исключая уже использованные
  const generateRandomColor = (): string => {
    const usedColors = roles.map(r => r.color).filter(Boolean);
    const availableColors = AVAILABLE_COLORS.filter(color => !usedColors.includes(color));
    const colorsPool = availableColors.length > 0 ? availableColors : AVAILABLE_COLORS;
    const randomIndex = Math.floor(Math.random() * colorsPool.length);
    return colorsPool[randomIndex];
  };

  useEffect(() => {
    if (enabled) {
      if (activeTab === 'pending') {
        loadPendingRequests();
      } else if (activeTab === 'all') {
        loadUsers();
      } else if (activeTab === 'roles') {
        loadRoles();
      } else if (activeTab === 'tender-access') {
        loadTendersList();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, enabled]);

  // Загружаем роли при монтировании для модального окна редактирования пользователя
  useEffect(() => {
    if (enabled) {
      loadRoles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Native WS hub — обновляем активную вкладку при изменениях users (topic `users`).
  useRealtimeTopic(enabled ? 'users' : null, () => {
    if (activeTab === 'pending') loadPendingRequests();
    else if (activeTab === 'all') loadUsers();
    else if (activeTab === 'roles') loadRoles();
  });

  return {
    activeTab,
    setActiveTab,
    pendingRequests,
    users,
    roles,
    tendersList,
    selectedRoles,
    loading,
    loadPendingRequests,
    loadUsers,
    loadRoles,
    loadTendersList,
    approveRequest,
    rejectRequest,
    deleteUser,
    toggleAccess,
    handleRoleChangeInTable,
    handleDeleteRole,
    syncUsersPagesFromRole,
    generateRoleCode,
    generateRandomColor,
  };
}
