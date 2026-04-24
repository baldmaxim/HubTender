import React, { useState, useEffect } from 'react';
import { Card, Tabs, Table, Button, Space, Tag, Modal, Form, Checkbox, Select, message, Popconfirm, Typography, Alert, Input, Radio, Tooltip, AutoComplete } from 'antd';
import { CheckOutlined, CloseOutlined, EditOutlined, UserOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { canManageUsers, ALL_PAGES, PAGE_LABELS, PAGES_STRUCTURE, type AccessStatus } from '../../lib/supabase/types';
import dayjs from 'dayjs';
import TenderAccessTab from './components/TenderAccessTab';

const { TabPane } = Tabs;
const { Text } = Typography;

interface PendingRequest {
  id: string;
  full_name: string;
  email: string;
  role_code: string;
  role_name?: string;
  role_color?: string;
  registration_date: string;
}

interface UserRecord {
  id: string;
  full_name: string;
  email: string;
  role_code: string;
  role_name?: string;
  role_color?: string;
  access_status: AccessStatus;
  allowed_pages: string[] | null;
  registration_date: string;
  approved_by?: string;
  approved_at?: string;
  password: string | null;
  access_enabled: boolean;
}

interface RoleRecord {
  code: string;
  name: string;
  allowed_pages: string[];
  is_system_role: boolean;
  color?: string;
  created_at: string;
  updated_at: string;
}

const Users: React.FC = () => {
  const { user: currentUser } = useAuth();
  const { theme } = useTheme();
  const currentTheme = theme;
  const [activeTab, setActiveTab] = useState('pending');
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [form] = Form.useForm();

  // Состояние для хранения выбранных role_code для каждого запроса на регистрацию
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});

  // Состояние для вкладки "Роли"
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [isRoleModalVisible, setIsRoleModalVisible] = useState(false);
  const [isCreateRoleModalVisible, setIsCreateRoleModalVisible] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRecord | null>(null);
  const [roleForm] = Form.useForm();
  const [createRoleForm] = Form.useForm();

  // Состояние для поиска тендеров
  const [tenderSearchText, setTenderSearchText] = useState('');
  const [tendersList, setTendersList] = useState<{ id: string; tender_number: string; title: string; version: number }[]>([]);

  // Проверка доступа
  const hasAccess = currentUser && canManageUsers(currentUser.role);

  // Загрузка списка тендеров для поиска
  const loadTendersList = async () => {
    try {
      const { data, error } = await supabase
        .from('tenders')
        .select('id, tender_number, title, version')
        .order('submission_deadline', { ascending: false });

      if (error) throw error;
      setTendersList(data || []);
    } catch (error) {
      console.error('Ошибка загрузки списка тендеров:', error);
    }
  };

  // Загрузка запросов на регистрацию
  const loadPendingRequests = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select(`
          id,
          full_name,
          email,
          role_code,
          registration_date,
          roles:role_code (
            name,
            color
          )
        `)
        .eq('access_status', 'pending')
        .order('registration_date', { ascending: false });

      if (error) {
        console.error('Ошибка загрузки запросов:', error);
        message.error('Не удалось загрузить запросы на регистрацию');
        return;
      }

      // Преобразуем данные для удобства использования
      const requests: PendingRequest[] = (data || []).map((item) => ({
        id: item.id,
        full_name: item.full_name,
        email: item.email,
        role_code: item.role_code,
        role_name: (Array.isArray(item.roles) ? item.roles[0] : item.roles)?.name,
        role_color: (Array.isArray(item.roles) ? item.roles[0] : item.roles)?.color,
        registration_date: item.registration_date,
      }));

      setPendingRequests(requests);

      // Инициализируем selectedRoles с role_code по умолчанию из запросов
      const initialRoles: Record<string, string> = {};
      requests.forEach((request) => {
        initialRoles[request.id] = request.role_code;
      });
      setSelectedRoles(initialRoles);
    } catch (err) {
      console.error('Неожиданная ошибка:', err);
      message.error('Произошла ошибка при загрузке данных');
    } finally {
      setLoading(false);
    }
  };

  // Загрузка всех пользователей
  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select(`
          *,
          roles:role_code (
            name,
            color
          )
        `)
        .order('registration_date', { ascending: false });

      if (error) {
        console.error('Ошибка загрузки пользователей:', error);
        message.error('Не удалось загрузить пользователей');
        return;
      }

      // Преобразуем данные для удобства использования
      const usersData: UserRecord[] = (data || []).map((item) => ({
        ...item,
        role_name: (Array.isArray(item.roles) ? item.roles[0] : item.roles)?.name,
        role_color: (Array.isArray(item.roles) ? item.roles[0] : item.roles)?.color,
        roles: undefined, // Удаляем вложенный объект
      }));

      setUsers(usersData);
    } catch (err) {
      console.error('Неожиданная ошибка:', err);
      message.error('Произошла ошибка при загрузке данных');
    } finally {
      setLoading(false);
    }
  };

  // Загрузка ролей
  const loadRoles = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('roles')
        .select('*')
        .order('name');

      if (error) {
        console.error('Ошибка загрузки ролей:', error);
        message.error('Не удалось загрузить роли');
        return;
      }

      setRoles(data || []);
    } catch (err) {
      console.error('Неожиданная ошибка:', err);
      message.error('Произошла ошибка при загрузке ролей');
    } finally {
      setLoading(false);
    }
  };

  // Одобрение запроса
  const approveRequest = async (request: PendingRequest) => {
    if (!currentUser) return;

    // Получаем выбранный role_code из state
    const selectedRoleCode = selectedRoles[request.id];
    if (!selectedRoleCode) {
      message.error('Выберите роль для пользователя');
      return;
    }

    try {
      // Находим роль в массиве roles
      const role = roles.find(r => r.code === selectedRoleCode);
      if (!role) {
        message.error('Выбранная роль не найдена');
        return;
      }

      const { error: updateError } = await supabase
        .from('users')
        .update({
          access_status: 'approved',
          approved_by: currentUser.id,
          approved_at: new Date().toISOString(),
          role_code: selectedRoleCode,
          allowed_pages: role.allowed_pages || [],
        })
        .eq('id', request.id);

      if (updateError) {
        console.error('Ошибка одобрения:', updateError);
        message.error('Не удалось одобрить запрос');
        return;
      }

      // Отправляем уведомление пользователю
      const { error: notificationError } = await supabase.from('notifications').insert({
        user_id: request.id,
        type: 'success',
        title: 'Регистрация одобрена',
        message: `Ваш запрос на регистрацию одобрен. Роль: ${role.name}`,
        is_read: false,
      });

      if (notificationError) {
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

  // Отклонение запроса
  const rejectRequest = async (request: PendingRequest) => {
    try {
      // Удаляем пользователя из public.users
      const { error: deleteError } = await supabase
        .from('users')
        .delete()
        .eq('id', request.id);

      if (deleteError) {
        console.error('Ошибка отклонения:', deleteError);
        message.error('Не удалось отклонить запрос');
        return;
      }

      // auth.users удалится автоматически через FK constraint ON DELETE CASCADE
      message.success(`Запрос от ${request.full_name} отклонен`);
      loadPendingRequests();
    } catch (err) {
      console.error('Неожиданная ошибка:', err);
      message.error('Произошла ошибка при отклонении');
    }
  };

  // Удаление пользователя
  const deleteUser = async (user: UserRecord) => {
    try {
      // Удаление из public.users автоматически удалит из auth.users через FK constraint ON DELETE CASCADE
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', user.id);

      if (error) {
        console.error('Ошибка удаления:', error);
        message.error('Не удалось удалить пользователя');
        return;
      }

      message.success(`Пользователь ${user.full_name} удален`);
      loadUsers();
    } catch (err) {
      console.error('Неожиданная ошибка:', err);
      message.error('Произошла ошибка при удалении');
    }
  };

  // Переключение доступа пользователя
  const toggleAccess = async (user: UserRecord) => {
    const newAccessValue = !user.access_enabled;

    try {
      const { error } = await supabase
        .from('users')
        .update({ access_enabled: newAccessValue })
        .eq('id', user.id);

      if (error) {
        console.error('Ошибка переключения доступа:', error);
        message.error('Не удалось изменить доступ');
        return;
      }

      message.success(
        newAccessValue
          ? `Доступ для ${user.full_name} открыт`
          : `Доступ для ${user.full_name} закрыт`
      );
      loadUsers();
    } catch (err) {
      console.error('Неожиданная ошибка:', err);
      message.error('Произошла ошибка при изменении доступа');
    }
  };

  // Открытие модального окна редактирования
  const openEditModal = (user: UserRecord) => {
    setEditingUser(user);
    form.setFieldsValue({
      full_name: user.full_name,
      email: user.email,
      role_code: user.role_code,
    });
    setIsEditModalVisible(true);
  };

  // Обработка изменения роли
  const handleRoleChange = async () => {
    // Роль изменена, права доступа будут обновлены при сохранении
    // Уведомления убраны по запросу пользователя
  };

  // Сохранение изменений
  const handleSaveEdit = async () => {
    if (!editingUser) return;

    try {
      const values = await form.validateFields();

      // Находим роль для получения allowed_pages
      const role = roles.find(r => r.code === values.role_code);

      if (!role) {
        message.error('Выбранная роль не найдена');
        return;
      }

      const allowedPages = role.allowed_pages || [];

      // Формируем объект обновления
      const updateData: Record<string, unknown> = {
        full_name: values.full_name,
        email: values.email,
        role_code: values.role_code,
        allowed_pages: allowedPages,
      };

      const { error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', editingUser.id);

      if (error) {
        console.error('Ошибка обновления:', error);
        message.error('Не удалось обновить пользователя');
        return;
      }

      message.success(`Пользователь ${values.full_name} обновлен`);
      setIsEditModalVisible(false);
      setEditingUser(null);
      form.resetFields();
      loadUsers();
    } catch (err) {
      console.error('Ошибка валидации:', err);
    }
  };

  // Обработчик изменения роли в таблице запросов
  const handleRoleChangeInTable = (requestId: string, newRoleCode: string) => {
    setSelectedRoles((prev) => ({
      ...prev,
      [requestId]: newRoleCode,
    }));
  };

  // Открытие модального окна редактирования роли
  const openRoleModal = (role: RoleRecord) => {
    setEditingRole(role);
    roleForm.setFieldsValue({
      allowed_pages: role.allowed_pages || [],
    });
    setIsRoleModalVisible(true);
  };

  // Сохранение изменений прав роли
  const handleSaveRole = async () => {
    if (!editingRole) return;

    try {
      const values = await roleForm.validateFields();

      const { error } = await supabase
        .from('roles')
        .update({
          allowed_pages: values.allowed_pages || [],
          updated_at: new Date().toISOString(),
        })
        .eq('code', editingRole.code);

      if (error) {
        console.error('Ошибка обновления роли:', error);
        message.error('Не удалось обновить роль');
        return;
      }

      message.success(`Права роли "${editingRole.name}" обновлены`);

      // Синхронизируем allowed_pages для всех пользователей с этой ролью
      await syncUsersPagesFromRole(editingRole.code, values.allowed_pages || []);

      setIsRoleModalVisible(false);
      setEditingRole(null);
      roleForm.resetFields();
      loadRoles();
      loadUsers(); // Перезагружаем пользователей, чтобы отобразить обновленные права
    } catch (err) {
      console.error('Ошибка валидации:', err);
    }
  };

  // Синхронизация allowed_pages пользователей с ролью
  const syncUsersPagesFromRole = async (roleCode: string, allowedPages: string[]) => {
    try {
      const { error } = await supabase
        .from('users')
        .update({ allowed_pages: allowedPages })
        .eq('role_code', roleCode);

      if (error) {
        console.error('Ошибка синхронизации прав пользователей:', error);
      }
    } catch (err) {
      console.error('Неожиданная ошибка при синхронизации:', err);
    }
  };

  // Удаление роли
  const handleDeleteRole = async (role: RoleRecord) => {
    try {
      // Проверяем, нет ли пользователей с этой ролью
      const { data: usersWithRole, error: checkError } = await supabase
        .from('users')
        .select('id')
        .eq('role_code', role.code);

      if (checkError) {
        console.error('Ошибка проверки пользователей:', checkError);
        message.error('Не удалось проверить роль');
        return;
      }

      if (usersWithRole && usersWithRole.length > 0) {
        message.error(`Невозможно удалить роль "${role.name}": есть пользователи с этой ролью (${usersWithRole.length})`);
        return;
      }

      // Системные роли нельзя удалять
      if (role.is_system_role) {
        message.error('Системные роли нельзя удалять');
        return;
      }

      // Удаляем роль
      const { error: deleteError } = await supabase
        .from('roles')
        .delete()
        .eq('code', role.code);

      if (deleteError) {
        console.error('Ошибка удаления роли:', deleteError);
        message.error(`Не удалось удалить роль: ${deleteError.message}`);
        return;
      }

      message.success(`Роль "${role.name}" удалена`);
      loadRoles();
    } catch (err) {
      console.error('Неожиданная ошибка при удалении роли:', err);
      message.error('Произошла ошибка при удалении роли');
    }
  };

  // Генерация кода роли из названия
  const generateRoleCode = (roleName: string): string => {
    // Транслитерация кириллицы в латиницу
    const translitMap: Record<string, string> = {
      'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
      'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
      'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
      'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
    };

    return roleName
      .toLowerCase()
      .split('')
      .map(char => translitMap[char] || char)
      .join('')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  };

  // Доступные цвета для ролей (Ant Design Tag colors)
  const AVAILABLE_COLORS = [
    'blue', 'green', 'cyan', 'purple', 'magenta', 'volcano',
    'orange', 'gold', 'lime', 'geekblue', 'red', 'pink'
  ];

  // Генерация случайного цвета, исключая уже использованные
  const generateRandomColor = (): string => {
    const usedColors = roles.map(r => r.color).filter(Boolean);
    const availableColors = AVAILABLE_COLORS.filter(color => !usedColors.includes(color));

    // Если все цвета использованы, выбираем случайный из всех
    const colorsPool = availableColors.length > 0 ? availableColors : AVAILABLE_COLORS;
    const randomIndex = Math.floor(Math.random() * colorsPool.length);
    return colorsPool[randomIndex];
  };

  // Открытие модального окна создания роли
  const openCreateRoleModal = () => {
    createRoleForm.resetFields();
    setIsCreateRoleModalVisible(true);
  };

  // Создание новой роли
  const handleCreateRole = async () => {
    try {
      const values = await createRoleForm.validateFields();
      const roleCode = generateRoleCode(values.name);

      // Проверяем, не существует ли роль с таким кодом или названием
      const { data: existingByCode, error: checkCodeError } = await supabase
        .from('roles')
        .select('code')
        .eq('code', roleCode);

      if (checkCodeError) {
        console.error('Ошибка проверки кода роли:', checkCodeError);
        message.error('Ошибка проверки роли');
        return;
      }

      if (existingByCode && existingByCode.length > 0) {
        message.error('Роль с таким названием уже существует');
        return;
      }

      // Проверяем по имени
      const { data: existingByName, error: checkNameError } = await supabase
        .from('roles')
        .select('code')
        .eq('name', values.name);

      if (checkNameError) {
        console.error('Ошибка проверки имени роли:', checkNameError);
        message.error('Ошибка проверки роли');
        return;
      }

      if (existingByName && existingByName.length > 0) {
        message.error('Роль с таким именем уже существует');
        return;
      }

      // Генерируем случайный цвет для новой роли
      const randomColor = generateRandomColor();

      // Создаем новую роль (не передаем allowed_pages и is_system_role - используем значения по умолчанию)
      const { data: newRole, error } = await supabase
        .from('roles')
        .insert([{
          code: roleCode,
          name: values.name,
          color: randomColor,
        }])
        .select()
        .single();

      if (error) {
        console.error('Ошибка создания роли:', error);
        message.error(`Не удалось создать роль: ${error.message}`);
        return;
      }

      message.success(`Роль "${values.name}" создана`);
      setIsCreateRoleModalVisible(false);
      createRoleForm.resetFields();
      await loadRoles();

      // Открываем модальное окно редактирования прав для новой роли
      if (newRole) {
        openRoleModal(newRole as RoleRecord);
      }
    } catch (err) {
      console.error('Ошибка валидации:', err);
    }
  };

  // Колонки таблицы запросов
  const pendingColumns: ColumnsType<PendingRequest> = [
    {
      title: 'ФИО',
      dataIndex: 'full_name',
      key: 'full_name',
      width: 200,
      align: 'center',
      render: (text: string) => <div style={{ textAlign: 'left' }}>{text}</div>,
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      width: 220,
      align: 'center',
    },
    {
      title: 'Роль',
      dataIndex: 'role_code',
      key: 'role_code',
      width: 200,
      align: 'center',
      render: (_: string, record: PendingRequest) => {
        return (
          <Select
            style={{ width: '100%' }}
            value={selectedRoles[record.id] || record.role_code}
            onChange={(value) => handleRoleChangeInTable(record.id, value)}
          >
            {roles.map((role) => (
              <Select.Option key={role.code} value={role.code}>
                <Tag color={role.color || 'default'}>{role.name}</Tag>
              </Select.Option>
            ))}
          </Select>
        );
      },
    },
    {
      title: 'Дата регистрации',
      dataIndex: 'registration_date',
      key: 'registration_date',
      width: 150,
      align: 'center',
      render: (date: string) => dayjs(date).format('DD.MM.YYYY HH:mm'),
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 180,
      align: 'center',
      render: (_: unknown, record: PendingRequest) => (
        <Space size="small">
          <Popconfirm
            title="Одобрить пользователя?"
            description={`Пользователь ${record.full_name} получит доступ к системе`}
            onConfirm={() => approveRequest(record)}
            okText="Одобрить"
            cancelText="Отмена"
          >
            <Button type="primary" size="small" icon={<CheckOutlined />}>
              Одобрить
            </Button>
          </Popconfirm>
          <Popconfirm
            title="Отклонить запрос?"
            description="Пользователь будет удален из системы"
            onConfirm={() => rejectRequest(record)}
            okText="Отклонить"
            cancelText="Отмена"
            okType="danger"
          >
            <Button danger size="small" icon={<CloseOutlined />}>
              Отклонить
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // Колонки таблицы пользователей
  const usersColumns: ColumnsType<UserRecord> = [
    {
      title: 'ФИО',
      dataIndex: 'full_name',
      key: 'full_name',
      width: 310,
      align: 'center',
      render: (text: string) => <div style={{ textAlign: 'left' }}>{text}</div>,
    },
    {
      title: 'Роль',
      dataIndex: 'role_name',
      key: 'role_name',
      width: 140,
      align: 'center',
      render: (_: string, record: UserRecord) => {
        return <Tag color={record.role_color || 'default'}>{record.role_name}</Tag>;
      },
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      width: 200,
      align: 'center',
    },
    {
      title: 'Дата регистрации',
      dataIndex: 'registration_date',
      key: 'registration_date',
      width: 130,
      align: 'center',
      render: (date: string) => dayjs(date).format('DD.MM.YYYY'),
    },
    {
      title: 'Доступ',
      dataIndex: 'access_enabled',
      key: 'access_enabled',
      width: 120,
      align: 'center',
      render: (access_enabled: boolean, record: UserRecord) => (
        <Radio.Group
          value={access_enabled ? 'open' : 'closed'}
          onChange={(e) => {
            if ((e.target.value === 'open') !== access_enabled) {
              toggleAccess(record);
            }
          }}
          size="small"
        >
          <Radio.Button value="open">Открыт</Radio.Button>
          <Radio.Button value="closed">Закрыт</Radio.Button>
        </Radio.Group>
      ),
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 160,
      align: 'center',
      fixed: 'right',
      render: (_: unknown, record: UserRecord) => (
        <Space size="small">
          <Tooltip
            title="Редактировать"
            color={currentTheme === 'dark' ? '#1f1f1f' : '#fff'}
            overlayInnerStyle={{
              color: currentTheme === 'dark' ? '#fff' : '#000',
            }}
          >
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEditModal(record)}
              disabled={record.id === currentUser?.id}
              style={{ padding: '0 4px' }}
            />
          </Tooltip>
          <Popconfirm
            title="Удалить пользователя?"
            description={`Пользователь ${record.full_name} будет безвозвратно удален из системы.`}
            onConfirm={() => deleteUser(record)}
            okText="Удалить"
            cancelText="Отмена"
            okType="danger"
            disabled={record.id === currentUser?.id}
          >
            <Tooltip
              title={record.id === currentUser?.id ? "Нельзя удалить себя" : "Удалить пользователя"}
              color={currentTheme === 'dark' ? '#1f1f1f' : '#fff'}
              overlayInnerStyle={{
                color: currentTheme === 'dark' ? '#fff' : '#000',
              }}
            >
              <Button
                danger
                type="link"
                size="small"
                icon={<DeleteOutlined />}
                disabled={record.id === currentUser?.id}
                style={{ padding: '0 4px' }}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // Колонки таблицы ролей
  const rolesColumns: ColumnsType<RoleRecord> = [
    {
      title: 'Код роли',
      dataIndex: 'code',
      key: 'code',
      width: 120,
      align: 'center',
      render: (text: string) => <Text code>{text}</Text>,
    },
    {
      title: 'Название роли',
      dataIndex: 'name',
      key: 'name',
      width: 150,
      align: 'center',
      render: (text: string, record: RoleRecord) => {
        return <Tag color={record.color || 'default'}>{text}</Tag>;
      },
    },
    {
      title: 'Доступные страницы',
      dataIndex: 'allowed_pages',
      key: 'allowed_pages',
      width: 500,
      align: 'center',
      render: (pages: string[]) => {
        if (!pages || pages.length === 0) {
          return <Tag color="green">Полный доступ</Tag>;
        }

        const pageNames = pages.map(page => PAGE_LABELS[page] || page).join(', ');
        return (
          <Text
            type="secondary"
            style={{
              fontSize: 13,
              lineHeight: '20px',
              display: 'block',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              textAlign: 'center'
            }}
          >
            {pageNames}
          </Text>
        );
      },
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 150,
      align: 'center',
      fixed: 'right',
      render: (_: unknown, record: RoleRecord) => (
        <Space size="small">
          <Tooltip
            title="Редактировать права доступа"
            color={currentTheme === 'dark' ? '#1f1f1f' : '#fff'}
            overlayInnerStyle={{
              color: currentTheme === 'dark' ? '#fff' : '#000',
            }}
          >
            <span>
              <Tag
                color="blue"
                style={{ cursor: 'pointer', margin: 0 }}
                icon={<EditOutlined />}
                onClick={() => openRoleModal(record)}
              >
                Редактировать
              </Tag>
            </span>
          </Tooltip>

          <Tooltip
            title={record.is_system_role ? "Системные роли нельзя удалять" : "Удалить роль"}
            color={currentTheme === 'dark' ? '#1f1f1f' : '#fff'}
            overlayInnerStyle={{
              color: currentTheme === 'dark' ? '#fff' : '#000',
            }}
          >
            <Popconfirm
              title="Удалить роль?"
              description={
                <>
                  Роль &quot;{record.name}&quot; будет удалена.
                  <br />
                  {record.is_system_role && <span style={{ color: '#ff4d4f' }}>Системные роли нельзя удалять!</span>}
                </>
              }
              onConfirm={() => handleDeleteRole(record)}
              okText="Удалить"
              cancelText="Отмена"
              okType="danger"
              disabled={record.is_system_role}
            >
              <span>
                <Tag
                  color="red"
                  style={{
                    cursor: record.is_system_role ? 'not-allowed' : 'pointer',
                    margin: 0,
                    opacity: record.is_system_role ? 0.5 : 1
                  }}
                  icon={<DeleteOutlined />}
                >
                  Удалить
                </Tag>
              </span>
            </Popconfirm>
          </Tooltip>
        </Space>
      ),
    },
  ];

  useEffect(() => {
    if (hasAccess) {
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
  }, [activeTab, hasAccess]);

  // Загружаем роли при монтировании для использования в модальном окне редактирования пользователя
  useEffect(() => {
    if (hasAccess) {
      loadRoles();
    }
  }, [hasAccess]);

  // Если нет доступа
  if (!hasAccess) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <UserOutlined style={{ fontSize: 48, color: '#ccc', marginBottom: 16 }} />
          <h3>Доступ запрещен</h3>
          <p style={{ color: '#666' }}>
            У вас нет прав для управления пользователями.
            <br />
            Эта функция доступна только администраторам и руководителям.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <UserOutlined style={{ fontSize: 24, color: '#10b981' }} />
            <span>Управление пользователями</span>
          </div>
        }
      >
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          tabBarExtraContent={
            activeTab === 'tender-access' ? (
              <AutoComplete
                style={{ width: 300 }}
                options={tendersList.map(t => ({
                  value: t.title,
                  label: `№${t.tender_number} v${t.version} - ${t.title}`
                }))}
                value={tenderSearchText}
                onChange={setTenderSearchText}
                placeholder="Поиск по наименованию тендера"
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                allowClear
              />
            ) : null
          }
        >
          <TabPane
            tab={
              <span>
                Запросы на регистрацию
                {pendingRequests.length > 0 && (
                  <Tag color="orange" style={{ marginLeft: 8 }}>
                    {pendingRequests.length}
                  </Tag>
                )}
              </span>
            }
            key="pending"
          >
            <Table
              dataSource={pendingRequests}
              columns={pendingColumns}
              rowKey="id"
              loading={loading}
              pagination={{ pageSize: 10 }}
              locale={{
                emptyText: 'Нет новых запросов на регистрацию',
              }}
            />
          </TabPane>

          <TabPane tab="Все пользователи" key="all">
            <Table
              dataSource={users}
              columns={usersColumns}
              rowKey="id"
              loading={loading}
              pagination={{ pageSize: 10 }}
              scroll={{ x: 1200 }}
            />
          </TabPane>

          <TabPane tab="Роли" key="roles">
            <div style={{ marginBottom: 16 }}>
              <Button type="primary" onClick={openCreateRoleModal}>
                Создать роль
              </Button>
            </div>
            <Table
              dataSource={roles}
              columns={rolesColumns}
              rowKey="code"
              loading={loading}
              pagination={false}
              scroll={{ x: 900 }}
            />
          </TabPane>

          <TabPane tab="Доступ к тендерам" key="tender-access">
            <TenderAccessTab searchText={tenderSearchText} />
          </TabPane>
        </Tabs>
      </Card>

      {/* Модальное окно редактирования */}
      <Modal
        title={`Редактирование пользователя: ${editingUser?.full_name}`}
        open={isEditModalVisible}
        onOk={handleSaveEdit}
        onCancel={() => {
          setIsEditModalVisible(false);
          setEditingUser(null);
          form.resetFields();
        }}
        okText="Сохранить"
        cancelText="Отмена"
        width={700}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="full_name"
            label="ФИО"
            rules={[
              { required: true, message: 'Введите ФИО' },
              { min: 3, message: 'ФИО должно содержать минимум 3 символа' },
            ]}
          >
            <Input placeholder="Иванов Иван Иванович" />
          </Form.Item>

          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Введите email' },
              { type: 'email', message: 'Введите корректный email' },
            ]}
          >
            <Input placeholder="example@su10.ru" />
          </Form.Item>

          <Form.Item
            name="role_code"
            label="Роль"
            rules={[{ required: true, message: 'Выберите роль' }]}
          >
            <Select
              placeholder="Выберите роль"
              onChange={handleRoleChange}
              options={roles.map((role) => ({
                value: role.code,
                label: role.name,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Модальное окно редактирования прав роли */}
      <Modal
        title={`Редактирование прав доступа: ${editingRole?.name}`}
        open={isRoleModalVisible}
        onOk={handleSaveRole}
        onCancel={() => {
          setIsRoleModalVisible(false);
          setEditingRole(null);
          roleForm.resetFields();
        }}
        okText="Сохранить"
        cancelText="Отмена"
        width={700}
      >
        <Form form={roleForm} layout="vertical">
          {editingRole && editingRole.name === 'Разработчик' && (
            <Alert
              message="Полный доступ"
              description="Роль «Разработчик» имеет полный доступ ко всем страницам портала. Список страниц недоступен для редактирования."
              type="success"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          <Form.Item
            name="allowed_pages"
            label="Доступные страницы"
            tooltip="Если ничего не выбрано - полный доступ"
          >
            <Checkbox.Group
              style={{ width: '100%' }}
              disabled={!!editingRole && editingRole.name === 'Разработчик'}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {PAGES_STRUCTURE.map((group, groupIndex) => {
                  const groupPages = group.pages.filter((page) => ALL_PAGES.includes(page));

                  if (groupPages.length === 0) {
                    return null;
                  }

                  return (
                    <div key={groupIndex}>
                      {group.title && (
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            color: '#666',
                            marginBottom: 8,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}
                        >
                          {group.title}
                        </div>
                      )}
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          paddingLeft: group.title ? 12 : 0,
                        }}
                      >
                        {groupPages.map((page) => (
                          <Checkbox key={page} value={page}>
                            {PAGE_LABELS[page] || page}
                          </Checkbox>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Checkbox.Group>
          </Form.Item>

          <Alert
            message="Важно"
            description="После изменения прав роли, все пользователи с этой ролью автоматически получат обновленные права доступа. Пользователям необходимо выйти и снова войти в систему."
            type="warning"
            showIcon
          />
        </Form>
      </Modal>

      {/* Модальное окно создания роли */}
      <Modal
        title="Создание новой роли"
        open={isCreateRoleModalVisible}
        onOk={handleCreateRole}
        onCancel={() => {
          setIsCreateRoleModalVisible(false);
          createRoleForm.resetFields();
        }}
        okText="Создать"
        cancelText="Отмена"
        width={500}
      >
        <Form form={createRoleForm} layout="vertical">
          <Form.Item
            name="name"
            label="Название роли"
            rules={[
              { required: true, message: 'Введите название роли' },
              { min: 3, message: 'Название должно содержать минимум 3 символа' },
            ]}
          >
            <Input placeholder="Например: Главный инженер" />
          </Form.Item>

          <Alert
            message="Информация"
            description="После создания роли вы сможете настроить права доступа к страницам. Код роли будет сгенерирован автоматически на основе названия."
            type="info"
            showIcon
          />
        </Form>
      </Modal>
    </div>
  );
};

export default Users;
