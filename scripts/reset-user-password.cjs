// Скрипт для сброса пароля пользователя в auth.users
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Не найдены переменные окружения');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function resetPassword() {
  console.log('🔍 Проверка пользователей в auth.users...\n');

  try {
    // Получаем всех пользователей из auth.users
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) {
      console.error('❌ Ошибка доступа к auth.users:', authError.message);
      console.log('\n⚠️  Для сброса пароля нужен SERVICE_ROLE_KEY');
      console.log('   Добавьте в .env.local:');
      console.log('   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key\n');

      console.log('📋 Альтернативный способ - через Supabase Dashboard:');
      console.log('   1. Откройте https://supabase.com/dashboard');
      console.log('   2. Authentication → Users');
      console.log('   3. Найдите пользователя → Send password recovery\n');
      return;
    }

    if (authData.users.length === 0) {
      console.log('⚠️  Нет пользователей в auth.users!');
      console.log('   Создайте нового через форму регистрации: http://localhost:5185/register\n');
      return;
    }

    console.log(`✅ Найдено ${authData.users.length} пользователей в auth.users:\n`);

    // Получаем данные из public.users для дополнительной информации
    const { data: publicUsers } = await supabase
      .from('users')
      .select('id, email, full_name, role, password');

    authData.users.forEach((authUser, index) => {
      const publicUser = publicUsers?.find(u => u.id === authUser.id);

      console.log(`${index + 1}. ${authUser.email}`);
      console.log(`   ID: ${authUser.id}`);
      console.log(`   Создан: ${new Date(authUser.created_at).toLocaleString('ru-RU')}`);

      if (publicUser) {
        console.log(`   Имя: ${publicUser.full_name}`);
        console.log(`   Роль: ${publicUser.role}`);
        console.log(`   Пароль (справка): ${publicUser.password || 'не указан'}`);
      } else {
        console.log('   ⚠️  Нет в public.users (пользователь-"зомби")');
      }
      console.log('');
    });

    // Предлагаем сбросить пароль
    console.log('━'.repeat(80));
    console.log('\n🔧 Для сброса пароля пользователя:');
    console.log('\n1. Через Supabase Dashboard (рекомендуется):');
    console.log('   • https://supabase.com/dashboard → Authentication → Users');
    console.log('   • Найдите пользователя → "..." → Send password recovery email');
    console.log('   • Проверьте почту и следуйте инструкциям\n');

    console.log('2. Установить новый пароль напрямую (требует SERVICE_ROLE_KEY):');
    console.log('   • Укажите email и новый пароль в скрипте');
    console.log('   • Раскомментируйте код ниже и выполните скрипт заново\n');

    // Код для установки нового пароля (раскомментируйте и измените значения)
    /*
    const EMAIL_TO_UPDATE = 'your.email@example.com';
    const NEW_PASSWORD = 'your_new_password_123';

    console.log(`\n🔄 Устанавливаем новый пароль для ${EMAIL_TO_UPDATE}...`);

    const userToUpdate = authData.users.find(u => u.email === EMAIL_TO_UPDATE);
    if (!userToUpdate) {
      console.error(`❌ Пользователь с email ${EMAIL_TO_UPDATE} не найден`);
      return;
    }

    const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(
      userToUpdate.id,
      { password: NEW_PASSWORD }
    );

    if (updateError) {
      console.error('❌ Ошибка установки пароля:', updateError.message);
      return;
    }

    console.log('✅ Пароль успешно изменен!');
    console.log(`   Email: ${EMAIL_TO_UPDATE}`);
    console.log(`   Новый пароль: ${NEW_PASSWORD}`);
    console.log('\n🔓 Теперь вы можете войти с новым паролем\n');

    // Обновляем password в public.users для справки
    await supabase
      .from('users')
      .update({ password: NEW_PASSWORD })
      .eq('id', userToUpdate.id);

    console.log('✅ Пароль также обновлен в public.users (для справки)\n');
    */

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

resetPassword();
