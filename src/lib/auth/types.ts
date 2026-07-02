// Shared types for the frontend app-auth client. Matches the JSON shape
// emitted by the Go BFF /api/v1/auth/login + /refresh endpoints (see
// backend/internal/auth/models.go AuthResult / UserPayload).

export interface AppAuthUser {
  id: string;
  email: string;
  full_name: string;
  role_code: string;
  access_status: string;      // 'approved' | 'pending' | 'blocked' (text from public.users.access_status)
  access_enabled: boolean;
  allowed_pages: string[];
}

export interface AppSession {
  access_token: string;       // RS256 JWT
  refresh_token: string;      // opaque; may be empty on legacy local backends
  expires_at: number;         // Unix epoch seconds (UTC)
  refresh_expires_at: number; // Unix epoch seconds (UTC)
  token_type: 'Bearer';
  user: AppAuthUser;
}

// Server response shape — what /login and /refresh return.
export interface AuthResultPayload {
  access_token: string;
  token_type: 'Bearer';
  expires_at?: string;          // ISO 8601 UTC
  expires_in?: number;          // seconds
  refresh_token?: string;
  refresh_expires_at?: string;  // ISO 8601 UTC
  user?: AppAuthUser;
}

// Emitted via onAuthStateChange. Mirrors a subset of Supabase's auth-event
// names so AuthContext code can stay close to its current shape.
export type AppAuthEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED';

export interface AppAuthError extends Error {
  status?: number;
  code?: 'invalid_credentials' | 'access_blocked' | 'refresh_invalid' | 'network' | 'unknown';
}
