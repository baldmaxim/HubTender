import { createClient } from '@supabase/supabase-js';
import { AUTH_MODE } from '../auth/mode';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Supabase configuration is missing: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required.'
  );
}

// В app-mode авторизация полностью идёт через Go BFF (см. src/lib/auth/),
// supabase-js нужен только как HTTP-клиент для легаси PostgREST-фолбэков.
// Если оставить autoRefreshToken/persistSession включёнными, GoTrueClient
// будет фоном долбиться в /auth/v1/token с протухшим refresh-токеном из
// старой supabase-сессии в localStorage и сыпать 400-ми в консоль (а в
// худшем сценарии — реагировать на собственный SIGNED_OUT и крутить
// побочные эффекты в библиотеках, подписанных на supabase.auth).
const isAppAuth = AUTH_MODE === 'app';

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    autoRefreshToken: !isAppAuth,
    persistSession: !isAppAuth,
    detectSessionInUrl: !isAppAuth,
  },
  global: {
    headers: {
      'X-Client-Info': 'supabase-js-web',
    },
  },
  db: {
    schema: 'public',
  },
  realtime: {
    timeout: 30000,
  },
});
