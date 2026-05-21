# 31 — app_auth schema verify result

Timestamp (UTC): 2026-05-21T20:51:06.472Z
Target host: `rc1d-m4ubd0uem0j9gqqc.mdb.yandexcloud.net:6432/HubTender`

Status: **OK** (0 issues)

| Check | Status | Detail |
|---|---|---|
| `schema app_auth exists` | OK |  |
| `table app_auth.refresh_tokens` | OK | 11 columns |
| `app_auth.refresh_tokens.id` | OK |  |
| `app_auth.refresh_tokens.user_id` | OK |  |
| `app_auth.refresh_tokens.token_hash` | OK |  |
| `app_auth.refresh_tokens.token_family_id` | OK |  |
| `app_auth.refresh_tokens.issued_at` | OK |  |
| `app_auth.refresh_tokens.expires_at` | OK |  |
| `app_auth.refresh_tokens.revoked_at` | OK |  |
| `app_auth.refresh_tokens.replaced_by` | OK |  |
| `app_auth.refresh_tokens.user_agent` | OK |  |
| `app_auth.refresh_tokens.ip_address` | OK |  |
| `app_auth.refresh_tokens.created_at` | OK |  |
| `table app_auth.password_reset_tokens` | OK | 8 columns |
| `app_auth.password_reset_tokens.id` | OK |  |
| `app_auth.password_reset_tokens.user_id` | OK |  |
| `app_auth.password_reset_tokens.token_hash` | OK |  |
| `app_auth.password_reset_tokens.requested_at` | OK |  |
| `app_auth.password_reset_tokens.expires_at` | OK |  |
| `app_auth.password_reset_tokens.used_at` | OK |  |
| `app_auth.password_reset_tokens.user_agent` | OK |  |
| `app_auth.password_reset_tokens.ip_address` | OK |  |
| `table app_auth.auth_events` | OK | 7 columns |
| `app_auth.auth_events.id` | OK |  |
| `app_auth.auth_events.user_id` | OK |  |
| `app_auth.auth_events.event_type` | OK |  |
| `app_auth.auth_events.created_at` | OK |  |
| `app_auth.auth_events.ip_address` | OK |  |
| `app_auth.auth_events.user_agent` | OK |  |
| `app_auth.auth_events.metadata` | OK |  |
| `index app_auth.refresh_tokens.idx_app_auth_refresh_tokens_user_id` | OK |  |
| `index app_auth.refresh_tokens.idx_app_auth_refresh_tokens_token_family` | OK |  |
| `index app_auth.refresh_tokens.idx_app_auth_refresh_tokens_expires_at` | OK |  |
| `index app_auth.refresh_tokens.idx_app_auth_refresh_tokens_revoked_at` | OK |  |
| `index app_auth.password_reset_tokens.idx_app_auth_password_reset_tokens_user_id` | OK |  |
| `index app_auth.password_reset_tokens.idx_app_auth_password_reset_tokens_expires_at` | OK |  |
| `index app_auth.password_reset_tokens.idx_app_auth_password_reset_tokens_used_at` | OK |  |
| `auth.users.encrypted_password` | OK | text (NULL) |

Final status: APP_AUTH_SCHEMA_VERIFY_OK
