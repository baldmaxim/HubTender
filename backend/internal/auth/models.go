package auth

import "time"

// LoginRequest is the JSON body for POST /api/v1/auth/login.
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
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
