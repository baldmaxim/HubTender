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

// Клиент с service role (обходит RLS)
const serviceClient = createClient(
  envVars.VITE_SUPABASE_URL,
  envVars.SUPABASE_SERVICE_ROLE_KEY
);

// Клиент с anon key (проверяет RLS)
const anonClient = createClient(
  envVars.VITE_SUPABASE_URL,
  envVars.VITE_SUPABASE_PUBLISHABLE_KEY
);

(async () => {
  const userId = '1da9a0f4-e777-4235-8c78-93d0da49d66d';

  console.log('=== Проверка с service role key (обходит RLS) ===');
  const { data: serviceData, error: serviceError } = await serviceClient
    .from('users')
    .select('id, email, access_status')
    .eq('id', userId);

  console.log('Данные:', serviceData);
  console.log('Ошибка:', serviceError);

  console.log('\n=== Проверка с anon key (проверяет RLS) ===');
  const { data: anonData, error: anonError } = await anonClient
    .from('users')
    .select('id, email, access_status')
    .eq('id', userId);

  console.log('Данные:', anonData);
  console.log('Ошибка:', anonError);

  if (serviceData && serviceData.length > 0 && (!anonData || anonData.length === 0)) {
    console.log('\n⚠️ ПРОБЛЕМА: Запись есть, но RLS блокирует доступ!');
  }
})();
