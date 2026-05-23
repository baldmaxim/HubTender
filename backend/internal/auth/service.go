package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// repo is the slice of Repository methods Service actually needs. Carved
// out as an interface so handler / service tests can swap in a fake.
type repo interface {
	GetAuthUserByEmail(ctx context.Context, email string) (*AuthUserRow, error)
	GetAuthUserByID(ctx context.Context, userID string) (*AuthUserRow, error)
	GetPublicUserByID(ctx context.Context, userID string) (*PublicUserRow, error)
	InsertRefreshToken(ctx context.Context, userID, tokenHash, tokenFamilyID string, issuedAt, expiresAt time.Time, sess SessionContext) (string, error)
	FindRefreshTokenByHash(ctx context.Context, tokenHash string) (*RefreshTokenRow, error)
	RevokeRefreshToken(ctx context.Context, id string) error
	RevokeTokenFamily(ctx context.Context, familyID string) error
	RotateRefreshToken(ctx context.Context, oldID, userID, newTokenHash, tokenFamilyID string, issuedAt, expiresAt time.Time, sess SessionContext) (string, error)
	LogAuthEvent(ctx context.Context, userID, eventType string, sess SessionContext, metadata map[string]any) error
	RegisterUser(ctx context.Context, in RegisterInput) (*RegisterResultDB, error)
}

// Service is the orchestration layer for the app-auth package — it knows
// the rules ("a blocked user cannot log in", "refresh reuse revokes the
// family") and stitches the issuer + password + repo together.
type Service struct {
	r      repo
	issuer *Issuer
}

// NewService wires a Service. The Issuer is the same one main.go feeds the
// JWKS handler — there is intentionally only one signing key in the
// process so JWKS clients converge on the kid we issue.
func NewService(r repo, iss *Issuer) *Service {
	return &Service{r: r, issuer: iss}
}

// Login implements POST /api/v1/auth/login.
//
// On any pre-token failure (unknown email, bcrypt mismatch, blocked user)
// the caller sees a single ErrInvalidCredentials / ErrUserBlocked — never
// "email not found" vs "password wrong", to avoid an account-enumeration
// oracle. The audit log records the real cause.
func (s *Service) Login(ctx context.Context, email, password string, sess SessionContext) (*AuthResult, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || password == "" {
		return nil, ErrInvalidCredentials
	}

	authRow, err := s.r.GetAuthUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			s.tryLogEvent(ctx, "", EventLoginFailed, sess, map[string]any{"reason": "unknown_email"})
		}
		return nil, err
	}
	if authRow.EncryptedPassword == "" {
		s.tryLogEvent(ctx, authRow.ID, EventLoginFailed, sess, map[string]any{"reason": "no_password_hash"})
		return nil, ErrInvalidCredentials
	}

	if err := ComparePassword(authRow.EncryptedPassword, password); err != nil {
		if errors.Is(err, ErrPasswordMismatch) {
			s.tryLogEvent(ctx, authRow.ID, EventLoginFailed, sess, map[string]any{"reason": "password_mismatch"})
			return nil, ErrInvalidCredentials
		}
		// Stored hash malformed — surface as generic invalid credentials but
		// log loudly so an oncaller can spot the corruption.
		log.Warn().Str("user_id", authRow.ID).Err(err).Msg("auth: bcrypt compare returned non-mismatch error")
		s.tryLogEvent(ctx, authRow.ID, EventLoginFailed, sess, map[string]any{"reason": "hash_malformed"})
		return nil, ErrInvalidCredentials
	}

	pub, err := s.r.GetPublicUserByID(ctx, authRow.ID)
	if err != nil {
		if errors.Is(err, ErrAccountMissing) {
			s.tryLogEvent(ctx, authRow.ID, EventLoginFailed, sess, map[string]any{"reason": "public_users_missing"})
			return nil, ErrUserBlocked
		}
		return nil, fmt.Errorf("authService.Login: load profile: %w", err)
	}
	if !accessAllowed(pub) {
		s.tryLogEvent(ctx, authRow.ID, EventLoginFailed, sess, map[string]any{
			"reason":         "access_blocked",
			"access_status":  pub.AccessStatus,
			"access_enabled": pub.AccessEnabled,
		})
		return nil, ErrUserBlocked
	}

	pair, err := s.issuePair(ctx, authRow.ID, authRow.Email, pub.RoleCode, sess)
	if err != nil {
		return nil, err
	}

	s.tryLogEvent(ctx, authRow.ID, EventLoginSuccess, sess, nil)

	return &AuthResult{
		AccessToken:      pair.access.Token,
		TokenType:        "Bearer",
		ExpiresAt:        pair.access.ExpiresAt,
		ExpiresIn:        int(s.issuer.AccessTTL().Seconds()),
		RefreshToken:     pair.refresh.Token,
		RefreshExpiresAt: pair.refresh.ExpiresAt,
		User:             toPayload(authRow, pub),
	}, nil
}

// Refresh implements POST /api/v1/auth/refresh.
//
// Reuse-detection rule:
//   - If FindRefreshTokenByHash returns a row whose revoked_at IS NOT NULL,
//     the same hash was already rotated AND somebody is replaying it. The
//     entire token_family_id is revoked (defensive); caller gets
//     ErrRefreshReuse.
//   - If revoked_at IS NULL and not expired, rotate atomically.
func (s *Service) Refresh(ctx context.Context, refreshToken string, sess SessionContext) (*AuthResult, error) {
	refreshToken = strings.TrimSpace(refreshToken)
	if refreshToken == "" {
		return nil, ErrRefreshNotFound
	}
	tokenHash := HashRefreshToken(refreshToken)

	row, err := s.r.FindRefreshTokenByHash(ctx, tokenHash)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()

	if row.RevokedAt != nil {
		// Reuse detected. Revoke the whole family to lock out the attacker
		// AND the legitimate user who already rotated to a successor token —
		// they re-login and get a fresh family.
		if err := s.r.RevokeTokenFamily(ctx, row.TokenFamilyID); err != nil {
			log.Error().Err(err).Str("family_id", row.TokenFamilyID).Msg("auth: failed to revoke token family on reuse")
		}
		s.tryLogEvent(ctx, row.UserID, EventRefreshReuseDetected, sess, map[string]any{
			"family_id": row.TokenFamilyID,
		})
		return nil, ErrRefreshReuse
	}
	if !row.ExpiresAt.After(now) {
		return nil, ErrRefreshExpired
	}

	// Load user profile fresh — access status may have flipped since the
	// last access token was issued.
	pub, err := s.r.GetPublicUserByID(ctx, row.UserID)
	if err != nil {
		if errors.Is(err, ErrAccountMissing) {
			return nil, ErrUserBlocked
		}
		return nil, fmt.Errorf("authService.Refresh: load profile: %w", err)
	}
	if !accessAllowed(pub) {
		return nil, ErrUserBlocked
	}

	// Resolve email for the new access-token claim. auth.users is the
	// authoritative source; if for any reason the row is gone (cascade
	// delete since the refresh token was issued), proceed with empty email.
	email := ""
	if au, err := s.lookupEmail(ctx, row.UserID); err == nil {
		email = au
	}

	// Mint new pair, rotate atomically.
	newAccess, err := s.issuer.IssueAccessToken(row.UserID, email, pub.RoleCode)
	if err != nil {
		return nil, fmt.Errorf("authService.Refresh: issue access: %w", err)
	}
	newRefresh, err := s.issuer.IssueRefreshToken()
	if err != nil {
		return nil, fmt.Errorf("authService.Refresh: issue refresh: %w", err)
	}
	newHash := HashRefreshToken(newRefresh.Token)

	if _, err := s.r.RotateRefreshToken(
		ctx,
		row.ID, row.UserID, newHash, row.TokenFamilyID,
		now, newRefresh.ExpiresAt, sess,
	); err != nil {
		return nil, fmt.Errorf("authService.Refresh: rotate: %w", err)
	}

	s.tryLogEvent(ctx, row.UserID, EventRefreshRotated, sess, map[string]any{
		"family_id": row.TokenFamilyID,
	})

	return &AuthResult{
		AccessToken:      newAccess.Token,
		TokenType:        "Bearer",
		ExpiresAt:        newAccess.ExpiresAt,
		ExpiresIn:        int(s.issuer.AccessTTL().Seconds()),
		RefreshToken:     newRefresh.Token,
		RefreshExpiresAt: newRefresh.ExpiresAt,
		User: UserPayload{
			ID:            pub.ID,
			Email:         email,
			FullName:      pub.FullName,
			RoleCode:      pub.RoleCode,
			AccessStatus:  pub.AccessStatus,
			AccessEnabled: pub.AccessEnabled,
			AllowedPages:  pub.AllowedPages,
		},
	}, nil
}

// Logout implements POST /api/v1/auth/logout.
//
// Always returns nil — clients must not learn whether the supplied token
// was known. If the token is empty, this is a no-op (the access JWT is
// still valid until it expires; that is by design for stateless JWTs).
func (s *Service) Logout(ctx context.Context, refreshToken string, sess SessionContext) error {
	refreshToken = strings.TrimSpace(refreshToken)
	if refreshToken == "" {
		return nil
	}
	tokenHash := HashRefreshToken(refreshToken)
	row, err := s.r.FindRefreshTokenByHash(ctx, tokenHash)
	if err != nil {
		// Token not found — treat as already-logged-out. Do NOT leak.
		return nil
	}
	if row.RevokedAt == nil {
		if err := s.r.RevokeRefreshToken(ctx, row.ID); err != nil {
			return fmt.Errorf("authService.Logout: revoke: %w", err)
		}
	}
	s.tryLogEvent(ctx, row.UserID, EventLogout, sess, map[string]any{
		"family_id": row.TokenFamilyID,
	})
	return nil
}

// Register implements POST /api/v1/auth/register.
//
// Validation:
//   - email: lowercased + trimmed; ErrInvalidEmail if empty (the handler
//     additionally enforces RFC-style format via go-playground/validator).
//   - full_name: trimmed; ErrFullNameRequired if empty after trim.
//   - password: minimum 6 chars (matches frontend Form rule); hashed via
//     auth.HashPassword (bcrypt cost 10, Supabase-compatible $2a$10$).
//
// The plaintext password is hashed inside this function and never logged.
// Only EventLoginFailed/Success-style events are recorded by the rest of
// the package; register itself doesn't emit an auth_event (it's a sign-up,
// not an authentication). The admin notification fan-out done by the repo
// surfaces the new request in the admin UI.
func (s *Service) Register(ctx context.Context, req RegisterRequest, sess SessionContext) (*RegisterResult, error) {
	_ = sess // currently unused; kept on the signature so future audit-trail can record IP / UA

	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" || !strings.Contains(email, "@") {
		return nil, ErrInvalidEmail
	}
	fullName := strings.TrimSpace(req.FullName)
	if fullName == "" {
		return nil, ErrFullNameRequired
	}
	if len(req.Password) < 6 {
		return nil, ErrPasswordTooShort
	}

	hash, err := HashPassword(req.Password)
	if err != nil {
		return nil, fmt.Errorf("authService.Register: hash: %w", err)
	}

	res, err := s.r.RegisterUser(ctx, RegisterInput{
		Email:        email,
		PasswordHash: hash,
		FullName:     fullName,
	})
	if err != nil {
		return nil, err
	}
	return &RegisterResult{
		UserID:       res.UserID,
		Email:        email,
		AccessStatus: res.AccessStatus,
	}, nil
}

// Me returns the public profile for the calling user (sourced from
// middleware-attached AuthUser.ID). Used by GET /api/v1/auth/me.
func (s *Service) Me(ctx context.Context, userID string) (*UserPayload, error) {
	if userID == "" {
		return nil, ErrInvalidCredentials
	}
	pub, err := s.r.GetPublicUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	email, _ := s.lookupEmail(ctx, userID)
	return &UserPayload{
		ID:            pub.ID,
		Email:         email,
		FullName:      pub.FullName,
		RoleCode:      pub.RoleCode,
		AccessStatus:  pub.AccessStatus,
		AccessEnabled: pub.AccessEnabled,
		AllowedPages:  pub.AllowedPages,
	}, nil
}

// Issuer exposes the underlying JWT issuer so the JWKS handler can grab the
// public key without us re-exporting it explicitly.
func (s *Service) Issuer() *Issuer { return s.issuer }

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// issuedPair is an internal carrier for the access + refresh token outputs
// of one issue+persist sequence.
type issuedPair struct {
	access  IssuedAccess
	refresh IssuedRefresh
}

// issuePair mints a fresh access + refresh token AND persists the refresh-
// token row under a brand new token_family_id. Used at Login (NOT refresh —
// refresh uses RotateRefreshToken to stay in the existing family).
func (s *Service) issuePair(ctx context.Context, userID, email, roleCode string, sess SessionContext) (issuedPair, error) {
	access, err := s.issuer.IssueAccessToken(userID, email, roleCode)
	if err != nil {
		return issuedPair{}, fmt.Errorf("authService.issuePair: access: %w", err)
	}
	refresh, err := s.issuer.IssueRefreshToken()
	if err != nil {
		return issuedPair{}, fmt.Errorf("authService.issuePair: refresh: %w", err)
	}
	familyID, err := NewFamilyID()
	if err != nil {
		return issuedPair{}, fmt.Errorf("authService.issuePair: family: %w", err)
	}
	if _, err := s.r.InsertRefreshToken(ctx,
		userID,
		HashRefreshToken(refresh.Token),
		familyID,
		time.Now().UTC(),
		refresh.ExpiresAt,
		sess,
	); err != nil {
		return issuedPair{}, fmt.Errorf("authService.issuePair: persist: %w", err)
	}
	return issuedPair{access: access, refresh: refresh}, nil
}

// lookupEmail re-reads auth.users.email for the given user. The login
// response carries this; Refresh needs it too because the access-token
// "email" claim must stay accurate even if the user changed emails.
func (s *Service) lookupEmail(ctx context.Context, userID string) (string, error) {
	row, err := s.r.GetAuthUserByID(ctx, userID)
	if err != nil {
		return "", err
	}
	return row.Email, nil
}

// tryLogEvent records an auth event and swallows the error after logging.
// We never want a logging failure to cascade into a denied login.
func (s *Service) tryLogEvent(ctx context.Context, userID, eventType string, sess SessionContext, metadata map[string]any) {
	if err := s.r.LogAuthEvent(ctx, userID, eventType, sess, metadata); err != nil {
		log.Warn().Err(err).Str("event_type", eventType).Msg("auth: failed to record auth event")
	}
}

// accessAllowed returns true when the user's row indicates they may sign in.
// Mirrors the frontend behaviour: access_enabled must be true AND status
// must be "approved". Any other state (pending, blocked, rejected, empty)
// fails.
func accessAllowed(p *PublicUserRow) bool {
	if !p.AccessEnabled {
		return false
	}
	return strings.EqualFold(p.AccessStatus, "approved")
}

func toPayload(authRow *AuthUserRow, pub *PublicUserRow) UserPayload {
	return UserPayload{
		ID:            pub.ID,
		Email:         authRow.Email,
		FullName:      pub.FullName,
		RoleCode:      pub.RoleCode,
		AccessStatus:  pub.AccessStatus,
		AccessEnabled: pub.AccessEnabled,
		AllowedPages:  pub.AllowedPages,
	}
}
