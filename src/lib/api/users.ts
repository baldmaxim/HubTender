// User-write helpers with Go BFF / Supabase fallback.
import { supabase } from '../supabase';
import { apiFetch } from './client';
import { isGoEnabled } from './featureFlags';

export interface RegisterUserInput {
  full_name: string;
  role_code: string;
  // JSONB array of allowed page URLs — pass as-is to either backend.
  allowed_pages: unknown;
}

/**
 * Register a user in public.users right after Supabase Auth signup.
 * Go path: POST /api/v1/users/register. userID and email come from JWT
 * (client cannot register under another user).
 * Supabase path: calls the register_user RPC.
 */
export async function registerUser(input: RegisterUserInput & { user_id: string; email: string }): Promise<void> {
  if (isGoEnabled('users')) {
    await apiFetch<void>('/api/v1/users/register', {
      method: 'POST',
      body: JSON.stringify({
        full_name: input.full_name,
        email: input.email,
        role_code: input.role_code,
        allowed_pages: input.allowed_pages,
      }),
    });
    return;
  }

  const { error } = await supabase.rpc('register_user', {
    p_user_id: input.user_id,
    p_full_name: input.full_name,
    p_email: input.email,
    p_role_code: input.role_code,
    p_allowed_pages: input.allowed_pages as never,
  });
  if (error) throw error;
}
