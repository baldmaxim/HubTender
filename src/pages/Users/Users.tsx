import React, { useState } from 'react';
import { Card, Tabs, Table, Button, Form, AutoComplete, message } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { canManageUsers } from '../../lib/supabase/types';
import {
  updateUserProfile,
  updateRoleAllowedPages,
  findRoleByCode,
  findRoleByName,
  createRole,
  type RoleRow,
} from '../../lib/api/userAdmin';
import { getErrorMessage } from '../../utils/errors';
import TenderAccessTab from './components/TenderAccessTab';
import { useUserAdmin } from './hooks/useUserAdmin';
import { buildPendingColumns } from './components/columns/pendingColumns';
import { buildUsersColumns } from './components/columns/usersColumns';
import { buildRolesColumns } from './components/columns/rolesColumns';
import { EditUserModal } from './components/EditUserModal';
import { EditRoleModal } from './components/EditRoleModal';
import { CreateRoleModal } from './components/CreateRoleModal';
import { PendingCards, UsersCards, RolesCards } from './components/UsersMobileCards';
import type { RoleRecord, UserRecord } from './types';

const Users: React.FC = () => {
  const { user: currentUser } = useAuth();
  const { theme: currentTheme } = useTheme();
  const { isPhone, isPhoneDevice } = useIsMobile();

  const hasAccess = !!(currentUser && canManageUsers(currentUser.role));

  const {
    activeTab,
    setActiveTab,
    pendingRequests,
    users,
    roles,
    tendersList,
    selectedRoles,
    loading,
    loadUsers,
    loadRoles,
    approveRequest,
    rejectRequest,
    deleteUser,
    toggleAccess,
    handleRoleChangeInTable,
    handleDeleteRole,
    syncUsersPagesFromRole,
    generateRoleCode,
    generateRandomColor,
  } = useUserAdmin(currentUser ? { id: currentUser.id } : null, hasAccess);

  const [form] = Form.useForm();
  const [roleForm] = Form.useForm();
  const [createRoleForm] = Form.useForm();
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [isRoleModalVisible, setIsRoleModalVisible] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRecord | null>(null);
  const [isCreateRoleModalVisible, setIsCreateRoleModalVisible] = useState(false);
  const [tenderSearchText, setTenderSearchText] = useState('');

  const openEditModal = (user: UserRecord) => {
    setEditingUser(user);
    form.setFieldsValue({ full_name: user.full_name, email: user.email, role_code: user.role_code });
    setIsEditModalVisible(true);
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    try {
      const values = await form.validateFields();
      const role = roles.find(r => r.code === values.role_code);
      if (!role) {
        message.error('Выбранная роль не найдена');
        return;
      }
      try {
        await updateUserProfile(editingUser.id, {
          full_name: values.full_name,
          email: values.email,
          role_code: values.role_code,
          allowed_pages: role.allowed_pages || [],
        });
      } catch (error) {
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

  const openRoleModal = (role: RoleRecord) => {
    setEditingRole(role);
    roleForm.setFieldsValue({ allowed_pages: role.allowed_pages || [] });
    setIsRoleModalVisible(true);
  };

  const handleSaveRole = async () => {
    if (!editingRole) return;
    try {
      const values = await roleForm.validateFields();
      try {
        await updateRoleAllowedPages(editingRole.code, values.allowed_pages || []);
      } catch (error) {
        console.error('Ошибка обновления роли:', error);
        message.error('Не удалось обновить роль');
        return;
      }
      message.success(`Права роли "${editingRole.name}" обновлены`);
      await syncUsersPagesFromRole(editingRole.code, values.allowed_pages || []);
      setIsRoleModalVisible(false);
      setEditingRole(null);
      roleForm.resetFields();
      loadRoles();
      loadUsers();
    } catch (err) {
      console.error('Ошибка валидации:', err);
    }
  };

  const handleCreateRole = async () => {
    try {
      const values = await createRoleForm.validateFields();
      const roleCode = generateRoleCode(values.name);

      let existingByCode: RoleRow | null;
      try {
        existingByCode = await findRoleByCode(roleCode);
      } catch (checkCodeError) {
        console.error('Ошибка проверки кода роли:', checkCodeError);
        message.error('Ошибка проверки роли');
        return;
      }
      if (existingByCode) {
        message.error('Роль с таким названием уже существует');
        return;
      }

      let existingByName: RoleRow | null;
      try {
        existingByName = await findRoleByName(values.name);
      } catch (checkNameError) {
        console.error('Ошибка проверки имени роли:', checkNameError);
        message.error('Ошибка проверки роли');
        return;
      }
      if (existingByName) {
        message.error('Роль с таким именем уже существует');
        return;
      }

      let newRole: RoleRow;
      try {
        newRole = await createRole({ code: roleCode, name: values.name, color: generateRandomColor() });
      } catch (error) {
        console.error('Ошибка создания роли:', error);
        message.error(`Не удалось создать роль: ${getErrorMessage(error)}`);
        return;
      }

      message.success(`Роль "${values.name}" создана`);
      setIsCreateRoleModalVisible(false);
      createRoleForm.resetFields();
      await loadRoles();
      if (newRole) {
        openRoleModal(newRole as RoleRecord);
      }
    } catch (err) {
      console.error('Ошибка валидации:', err);
    }
  };

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

  const pendingColumns = buildPendingColumns({
    roles,
    selectedRoles,
    onRoleChange: handleRoleChangeInTable,
    onApprove: approveRequest,
    onReject: rejectRequest,
  });
  const usersColumns = buildUsersColumns({
    currentUserId: currentUser?.id,
    currentTheme,
    onEdit: openEditModal,
    onDelete: deleteUser,
    onToggleAccess: toggleAccess,
  });
  const rolesColumns = buildRolesColumns({ currentTheme, onEditRole: openRoleModal, onDeleteRole: handleDeleteRole });

  const tabItems = [
    {
      key: 'pending',
      label: (
        <span>
          Запросы на регистрацию
          {pendingRequests.length > 0 && (
            <span style={{ marginLeft: 8, color: '#fa8c16', fontWeight: 600 }}>({pendingRequests.length})</span>
          )}
        </span>
      ),
      children: isPhoneDevice ? (
        <PendingCards data={pendingRequests} />
      ) : (
        <Table
          dataSource={pendingRequests}
          columns={pendingColumns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: 'Нет новых запросов на регистрацию' }}
        />
      ),
    },
    {
      key: 'all',
      label: 'Все пользователи',
      children: isPhoneDevice ? (
        <UsersCards data={users} />
      ) : (
        <Table dataSource={users} columns={usersColumns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} scroll={{ x: 1200 }} />
      ),
    },
    {
      key: 'roles',
      label: 'Роли',
      children: (
        <>
          {!isPhoneDevice && (
            <div style={{ marginBottom: 16 }}>
              <Button type="primary" onClick={() => { createRoleForm.resetFields(); setIsCreateRoleModalVisible(true); }}>
                Создать роль
              </Button>
            </div>
          )}
          {isPhoneDevice ? (
            <RolesCards data={roles} />
          ) : (
            <Table dataSource={roles} columns={rolesColumns} rowKey="code" loading={loading} pagination={false} scroll={{ x: 900 }} />
          )}
        </>
      ),
    },
    {
      key: 'tender-access',
      label: 'Доступ к тендерам',
      children: <TenderAccessTab searchText={tenderSearchText} />,
    },
  ];

  return (
    <div style={{ padding: isPhoneDevice ? 12 : 24 }}>
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
          items={tabItems}
          tabBarExtraContent={
            activeTab === 'tender-access' ? (
              <AutoComplete
                style={{ width: isPhoneDevice ? 160 : 300 }}
                options={tendersList.map(t => ({ value: t.title, label: `№${t.tender_number} v${t.version} - ${t.title}` }))}
                value={tenderSearchText}
                onChange={setTenderSearchText}
                placeholder="Поиск по тендеру"
                filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                allowClear
              />
            ) : null
          }
        />
      </Card>

      <EditUserModal
        open={isEditModalVisible}
        editingUser={editingUser}
        form={form}
        roles={roles}
        isPhone={isPhone}
        onOk={handleSaveEdit}
        onCancel={() => {
          setIsEditModalVisible(false);
          setEditingUser(null);
          form.resetFields();
        }}
      />

      <EditRoleModal
        open={isRoleModalVisible}
        editingRole={editingRole}
        form={roleForm}
        isPhone={isPhone}
        onOk={handleSaveRole}
        onCancel={() => {
          setIsRoleModalVisible(false);
          setEditingRole(null);
          roleForm.resetFields();
        }}
      />

      <CreateRoleModal
        open={isCreateRoleModalVisible}
        form={createRoleForm}
        isPhone={isPhone}
        onOk={handleCreateRole}
        onCancel={() => {
          setIsCreateRoleModalVisible(false);
          createRoleForm.resetFields();
        }}
      />
    </div>
  );
};

export default Users;
