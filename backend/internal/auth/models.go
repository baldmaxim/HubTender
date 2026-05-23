package auth

import "time"

// LoginRequest is the JSON body for POST /api/v1/auth/login.
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// RegisterRequest is the JSON body for POST /api/v1/auth/register.
// Server-controlled: role_code, access_status, allowed_pages are NOT
// accepted from the client — they are pinned to the default sign-up
// role ("engineer") to prevent self-elevation. The first-user / privileged-
// role auto-approve carries over from the legacy register flow inside
// the repository.
type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	FullName string `json:"full_name"`
}

// ForgotPasswordRequest is the JSON body for POST /api/v1/auth/forgot-password.
type ForgotPasswordRequest struct {
	Email string `json:"email"`
}

// ForgotPasswordResult is the success-side response of /forgot-password.
// Always returns 200 with `success: true` (anti-enumeration). In non-prod
// environments where SMTP is not configured the response additionally
// carries a `reset_url` so the operator can complete the flow without an
// email round-trip. In production the field is always omitted.
type ForgotPasswordResult struct {
	Success  bool   `json:"success"`
	ResetURL string `json:"reset_url,omitempty"` // dev convenience only
}

// ResetPasswordRequest is the JSON body for POST /api/v1/auth/reset-password.
// Token is the plaintext value from the email link (we hash it before
// looking it up in app_auth.password_reset_tokens).
type ResetPasswordRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

// ChangePasswordRequest is the JSON body for POST /api/v1/auth/change-password.
// Authed route — the user id comes from the JWT, the current_password is
// re-verified against the live bcrypt hash before the change is committed.
type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// ResetTokenRow mirrors a row of app_auth.password_reset_tokens — used by
// the service's reuse / expiry checks.
type ResetTokenRow struct {
	ID          string
	UserID      string
	TokenHash   string
	RequestedAt time.Time
	ExpiresAt   time.Time
	UsedAt      *time.Time
}

// RegisterResult is the success-side response of /api/v1/auth/register.
// We deliberately do NOT return a session — fresh registrations land in
// access_status="pending" by default and must wait for admin approval
// before login. The frontend redirects to /login and surfaces the
// "request submitted, await approval" toast.
type RegisterResult struct {
	UserID       string `json:"user_id"`
	Email        string `json:"email"`
	AccessStatus string `json:"access_status"`
}

// RefreshRequest is the JSON body for POST /api/v1/auth/refresh.
type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// LogoutRequest is the JSON body for POST /api/v1/auth/logout.
// RefreshToken is optional — if omitted, the handler returns 204 without
// touching state (we cannot infer "current session" from the access token
// because it doesn't carry the refresh-token id).
type LogoutRequest struct {
	RefreshToken string `json:"refresh_token,omitempty"`
}

// UserPayload is the slice of the user profile returned alongside tokens.
// Shape matches the existing meResponse in handlers/me.go so the frontend
// can reuse its existing User type without a translation layer.
type UserPayload struct {
	ID            string   `json:"id"`
	Email         string   `json:"email"`
	FullName      string   `json:"full_name"`
	RoleCode      string   `json:"role_code"`
	AccessStatus  string   `json:"access_status"`
	AccessEnabled bool     `json:"access_enabled"`
	AllowedPages  []string `json:"allowed_pages"`
}

// AuthResult is the JSON body returned by /login and /refresh. The plaintext
// refresh_token leaves the server only once — here. The DB only ever sees
// its SHA-256 hash.
type AuthResult struct {
	AccessToken      string      `json:"access_token"`
	TokenType        string      `json:"token_type"`
	ExpiresAt        time.Time   `json:"expires_at"`
	ExpiresIn        int         `json:"expires_in"` // seconds, for OAuth-style clients
	RefreshToken     string      `json:"refresh_token"`
	RefreshExpiresAt time.Time   `json:"refresh_expires_at"`
	User             UserPayload `json:"user"`
}

// AuthUserRow is the projection of auth.users used by Login. We deliberately
// only pull what we need (id, email, encrypted_password) — the rest of the
// bridge table is irrelevant to the issuer.
type AuthUserRow struct {
	ID                string
	Email             string
	EncryptedPassword string // bcrypt; never log this
}

// PublicUserRow mirrors the public.users + roles projection used for the
// login response payload + access checks. Same shape the /me endpoint
// already returns, so the frontend gets a consistent UserPayload at login,
// refresh, and /auth/me.
type PublicUserRow struct {
	ID            string
	FullName      string
	RoleCode      string
	AccessStatus  string
	AccessEnabled bool
	AllowedPages  []string
}

// RefreshTokenRow is the in-Go shape of an app_auth.refresh_tokens row used
// by the rotation logic. Token hashes are never the raw token — see
// refresh_tokens.go HashRefreshToken.
type RefreshTokenRow struct {
	ID            string
	UserID        string
	TokenHash     string
	TokenFamilyID string
	IssuedAt      time.Time
	ExpiresAt     time.Time
	RevokedAt     *time.Time
	ReplacedBy    *string
}

// SessionContext bundles request-side metadata recorded alongside refresh
// tokens and auth_events. Both fields are best-effort; empty strings are OK.
type SessionContext struct {
	UserAgent string
	IPAddress string // text form; the repo casts to inet (NULL on empty)
}

// EventType enumerates the event_type strings written to app_auth.auth_events.
// Free-form text by schema, but we keep a closed enum here so log/grep stays
// consistent across the codebase.
const (
	EventLoginSuccess         = "login_success"
	EventLoginFailed          = "login_failed"
	EventRefreshRotated       = "refresh_rotated"
	EventRefreshReuseDetected = "refresh_reuse_detected"
	EventLogout               = "logout"
)
