const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};

envContent.split(/\r?\n/).forEach(line => {
  line = line.trim();
  if (line && !line.startsWith('#')) {
    const equalIndex = line.indexOf('=');
    if (equalIndex > 0) {
      const key = line.substring(0, equalIndex).trim();
      const value = line.substring(equalIndex + 1).trim().replace(/^['\"]|['\"]$/g, '');
      envVars[key] = value;
    }
  }
});

const supabase = createClient(
  envVars.VITE_SUPABASE_URL,
  envVars.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const userId = '1da9a0f4-e777-4235-8c78-93d0da49d66d';

  // Получаем email из auth.users
  const { data: authData } = await supabase.auth.admin.listUsers();
  const authUser = authData?.users?.find(u => u.id === userId);

  if (!authUser) {
    console.log('Пользователь не найден в auth.users');
    return;
  }

  console.log('Email:', authUser.email);
  console.log('Создаём запись в public.users с blocked статусом...');

  const { data, error } = await supabase
    .from('users')
    .insert({
      id: userId,
      email: authUser.email,
      full_name: authUser.email.split('@')[0],
      role_code: 'engineer',
      access_status: 'blocked',
      access_enabled: false,
      allowed_pages: []
    })
    .select()
    .single();

  if (error) {
    console.error('Ошибка создания:', error);
  } else {
    console.log('✅ Запись создана:', data);
  }
})();
