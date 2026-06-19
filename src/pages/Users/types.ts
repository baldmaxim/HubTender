import type { AccessStatus } from '../../lib/supabase/types';

export interface PendingRequest {
  id: string;
  full_name: string;
  email: string;
  role_code: string;
  role_name?: string;
  role_color?: string;
  registration_date: string;
}

export interface UserRecord {
  id: string;
  full_name: string;
  email: string;
  role_code: string;
  role_name?: string;
  role_color?: string;
  access_status: AccessStatus;
  allowed_pages: string[] | null;
  registration_date: string;
  approved_by?: string;
  approved_at?: string;
  password: string | null;
  access_enabled: boolean;
}

export interface RoleRecord {
  code: string;
  name: string;
  allowed_pages: string[];
  is_system_role: boolean;
  color?: string;
  created_at: string;
  updated_at: string;
}
