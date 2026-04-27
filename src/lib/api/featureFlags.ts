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
  | 'users'
  | 'redistributions'
  | 'insurance'
  | 'positionFilters'
  | 'tenderRegistry';

const API_MODE = (import.meta.env.VITE_API_MODE ?? 'supabase') as 'supabase' | 'go' | 'hybrid';

const domainEnvKey = (domain: ApiDomain) =>
  `VITE_API_${domain.toUpperCase()}_ENABLED`;

// Returns true when the Go BFF should be used for this domain.
export function isGoEnabled(domain: ApiDomain): boolean {
  const envVal = import.meta.env[domainEnvKey(domain)];
  if (envVal !== undefined) return envVal === 'true';
  return API_MODE === 'go';
}

function resolveApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (envUrl) return envUrl;
  if (import.meta.env.PROD) {
    throw new Error('VITE_API_URL is required in production builds.');
  }
  return 'http://localhost:3005';
}

export const API_BASE_URL = resolveApiBaseUrl();

// Realtime: true → use native WS hub (Go BFF). Falsy → supabase.channel() direct.
export function isRealtimeEnabled(): boolean {
  return import.meta.env.VITE_API_REALTIME_ENABLED === 'true';
}
