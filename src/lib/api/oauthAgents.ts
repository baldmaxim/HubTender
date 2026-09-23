import { apiFetch } from './client';

export interface OAuthGrant {
  client_id: string;
  client_name: string;
  scopes: string[];
  granted_at: string;
  last_used_at?: string;
  revoked_at?: string;
}

export interface OAuthConsentInput {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: 'S256';
}

export async function approveOAuthConsent(input: OAuthConsentInput): Promise<string> {
  const response = await apiFetch<{ redirect_uri: string }>('/api/v1/oauth/authorize', {
    method: 'POST', body: JSON.stringify(input),
  });
  return response.redirect_uri;
}

export async function listOAuthGrants(): Promise<OAuthGrant[]> {
  return (await apiFetch<{ data: OAuthGrant[] }>('/api/v1/oauth/grants')).data ?? [];
}

export async function revokeOAuthGrant(clientId: string): Promise<void> {
  await apiFetch(`/api/v1/oauth/grants/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
}

