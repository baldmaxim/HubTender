// Feature flags for Go BFF API.
// VITE_API_MODE=supabase|go|hybrid (default: supabase)
// Per-domain flags: VITE_API_<DOMAIN>_ENABLED=true overrides the global mode.

type ApiDomain =
  | 'references'
  | 'tenders'
  | 'positions'
  | 'boq'
  | 'markup'
  | 'commerce'
  | 'costs'
  | 'fi'
  | 'timeline'
  | 'projects'
  | 'notifications'
  | 'users';

const API_MODE = (import.meta.env.VITE_API_MODE ?? 'supabase') as 'supabase' | 'go' | 'hybrid';

const domainEnvKey = (domain: ApiDomain) =>
  `VITE_API_${domain.toUpperCase()}_ENABLED`;

// Returns true when the Go BFF should be used for this domain.
export function isGoEnabled(domain: ApiDomain): boolean {
  const envVal = import.meta.env[domainEnvKey(domain)];
  if (envVal !== undefined) return envVal === 'true';
  return API_MODE === 'go';
}

export const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? 'http://localhost:8080';
