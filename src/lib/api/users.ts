// User-write helpers with Go BFF / Supabase fallback.
import { apiFetch } from './client';

export interface MeResponse {
  id: string;
  email: string;
  full_name: string;
  role_code: string;
  role_name: string;
  role_color: string;
  access_status: string;
  access_enabled: boolean;
  allowed_pages: string[] | null;
}

/** GET /api/v1/me — current user's profile + role + access info. */
export async function getMe(): Promise<MeResponse> {
  return await apiFetch<MeResponse>('/api/v1/me', { cache: 'no-store' });
}

export interface RegisterUserInput {
  full_name: string;
  role_code: string;
  // Optional JSONB array of allowed page URLs — server defaults to the
  // role's allowed_pages when omitted, so callers can skip the pre-read.
  allowed_pages?: unknown;
}

/** Re-apply for access after rejection (sets users.access_status = 'pending'). */
export async function reapplyAccess(): Promise<void> {
  await apiFetch<undefined>('/api/v1/me/reapply-access', { method: 'POST' });
}

/**
 * Register a user in public.users right after Supabase Auth signup.
 * POST /api/v1/users/register. userID + email come from the verified JWT
 * (client cannot register under another user). The backend also inserts
 * a registration-request notification when access_status = 'pending'.
 */
export async function registerUser(input: RegisterUserInput): Promise<void> {
  await apiFetch<void>('/api/v1/users/register', {
    method: 'POST',
    body: JSON.stringify({
      full_name: input.full_name,
      role_code: input.role_code,
      ...(input.allowed_pages !== undefined ? { allowed_pages: input.allowed_pages } : {}),
    }),
  });
}
