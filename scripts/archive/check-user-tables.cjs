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
  const { data: authData } = await supabase.auth.admin.listUsers();
  const { data: publicUsers } = await supabase.from('users').select('id, email, access_status');

  console.log('Auth users:', authData?.users?.length || 0);
  console.log('Public users:', publicUsers?.length || 0);
  console.log('');

  // Проверяем конкретного пользователя
  const userId = '6c2a665a-0aae-4526-b127-75e1bd9e93ce';
  const authUser = authData?.users?.find(u => u.id === userId);
  const publicUser = publicUsers?.find(u => u.id === userId);

  console.log('Пользователь', userId);
  console.log('В auth.users:', authUser ? 'ДА (email: ' + authUser.email + ')' : 'НЕТ');
  console.log('В public.users:', publicUser ? 'ДА (status: ' + publicUser.access_status + ')' : 'НЕТ');
})();
