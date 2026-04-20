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

  console.log('=== Auth users (всего:', authData?.users?.length || 0, ') ===');
  authData?.users?.forEach(u => {
    const inPublic = publicUsers?.find(p => p.id === u.id);
    console.log(u.id, u.email, '→', inPublic ? `public (${inPublic.access_status})` : 'НЕТ в public');
  });

  console.log('\n=== Пользователи только в auth (НЕТ в public) ===');
  const missing = authData?.users?.filter(u => !publicUsers?.find(p => p.id === u.id)) || [];
  missing.forEach(u => console.log(u.id, u.email));
  console.log('Всего:', missing.length);
})();
