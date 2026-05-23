package auth

import "errors"

// Domain-level errors. Handlers map most of these to a single generic 401
// "invalid credentials" to avoid leaking which check failed (account exists?
// password wrong? blocked?) — but the service layer needs the distinction
// to log / record auth events accurately.
var (
	// ErrInvalidCredentials is the catch-all "wrong email/password" signal.
	// Returned by Login when the email is unknown, the hash is unusable, or
	// bcrypt compare disagrees. Never expose the distinction to the client.
	ErrInvalidCredentials = errors.New("auth: invalid credentials")

	// ErrUserBlocked is returned when the user authenticated successfully
	// but their public.users row says access is denied (access_status != approved
	// or access_enabled = false). Mapped to 403 by the handler so the
	// frontend can route the user to the access-request screen.
	ErrUserBlocked = errors.New("auth: user blocked")

	// ErrAccountMissing is returned when auth.users has a row (so login succeeded)
	// but public.users does NOT — a half-provisioned state. Treated as blocked.
	ErrAccountMissing = errors.New("auth: public.users row missing")

	// ErrRefreshNotFound: token_hash lookup miss. Maps to 401.
	ErrRefreshNotFound = errors.New("auth: refresh token not found")

	// ErrRefreshExpired: expires_at <= now.
	ErrRefreshExpired = errors.New("auth: refresh token expired")

	// ErrRefreshRevoked: revoked_at IS NOT NULL, but the token was rotated
	// or explicitly revoked. Distinct from reuse because the family is still
	// live (somebody else just logged out / refreshed cleanly).
	ErrRefreshRevoked = errors.New("auth: refresh token revoked")

	// ErrRefreshReuse: the token presented was already rotated AND somebody
	// else is using a successor in the same family. This is the classic
	// reuse-detection signal; the service revokes the whole family on this.
	ErrRefreshReuse = errors.New("auth: refresh token reuse detected")

	// ErrEmailAlreadyExists: registration found an existing auth.users row
	// with the same case-insensitive email. Maps to 409 Conflict.
	ErrEmailAlreadyExists = errors.New("auth: email already registered")

	// ErrPasswordTooShort: registration policy minimum (6 chars, same as the
	// frontend form rule). Maps to 400 Bad Request.
	ErrPasswordTooShort = errors.New("auth: password too short")

	// ErrInvalidEmail: registration received an empty / malformed email.
	// Maps to 400 Bad Request.
	ErrInvalidEmail = errors.New("auth: invalid email")

	// ErrFullNameRequired: registration policy requires a non-empty full_name.
	ErrFullNameRequired = errors.New("auth: full_name required")

	// ErrResetTokenNotFound: reset-token hash lookup miss. Maps to 401 on
	// /reset-password. NOT distinguished from "already used / expired" by
	// the handler — same generic toast on the client.
	ErrResetTokenNotFound = errors.New("auth: reset token not found")

	// ErrResetTokenExpired: requested_at + TTL < now.
	ErrResetTokenExpired = errors.New("auth: reset token expired")

	// ErrResetTokenUsed: used_at IS NOT NULL — single-use enforcement.
	ErrResetTokenUsed = errors.New("auth: reset token already used")
)
